// 文字起こしの API。ロジックは services/transcribe.ts にある。
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { ValidationError } from '../services/entries.ts'
import { isDateString } from '../adapters/clock.ts'
import {
  createJob,
  getJob,
  listJobs,
  retryJob,
  subscribe,
  type JobEvent,
  type JobStatus,
} from '../services/transcribe.ts'

const app = new Hono()

const STATUSES: JobStatus[] = ['queued', 'running', 'done', 'failed']

/** multipart でも `audio/wav` の生ボディでも受ける。 */
async function readUpload(
  c: Context,
): Promise<{ wav: Uint8Array; entryId: string | null; dayDate: string | null }> {
  const contentType = c.req.header('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData()
    const file = form.get('audio') ?? form.get('file')
    if (!(file instanceof File)) throw new ValidationError('audio というファイル欄が必要です')
    const entryId = form.get('entry_id')
    const dayDate = form.get('day_date')
    return {
      wav: new Uint8Array(await file.arrayBuffer()),
      entryId: typeof entryId === 'string' && entryId.length > 0 ? entryId : null,
      dayDate: typeof dayDate === 'string' && dayDate.length > 0 ? dayDate : null,
    }
  }
  const buf = await c.req.arrayBuffer()
  const q = c.req.query()
  return {
    wav: new Uint8Array(buf),
    entryId: q.entry_id && q.entry_id.length > 0 ? q.entry_id : null,
    dayDate: q.day_date && q.day_date.length > 0 ? q.day_date : null,
  }
}

// 一覧（`?status=failed` で失敗したものだけ。再試行の入口に使う）。
// `/:id` より先に登録する（Hono は登録順に照合する）。
app.get('/', (c) => {
  // status は `?status=failed`、`?status=queued&status=running`、`?status=queued,running` のどれでも受ける。
  const raw = c.req.queries('status') ?? []
  const statuses = raw.flatMap((v) => v.split(',')).map((v) => v.trim()).filter((v) => v.length > 0)
  for (const s of statuses) {
    if (!STATUSES.includes(s as JobStatus)) {
      throw new ValidationError('status は queued / running / done / failed のいずれかです')
    }
  }
  const dayDate = c.req.query('day_date')
  if (dayDate !== undefined && !isDateString(dayDate)) {
    throw new ValidationError('day_date は YYYY-MM-DD の形で指定してください')
  }
  return c.json({ jobs: listJobs(statuses as JobStatus[], dayDate ?? null) })
})

app.post('/', async (c) => {
  const { wav, entryId, dayDate } = await readUpload(c)
  const job = await createJob({ wav, entryId, dayDate })
  return c.json({ job_id: job.id, job }, 202)
})


app.get('/:id', (c) => c.json({ job: getJob(c.req.param('id')) }))

app.post('/:id/retry', (c) => {
  const job = retryJob(c.req.param('id'))
  return c.json({ job_id: job.id, job }, 202)
})

// 進捗の配信（要件 C2）。segment / warning / done / failed を送る。
app.get('/:id/events', (c) => {
  const id = c.req.param('id')
  const job = getJob(id) // 無ければ 404
  return streamSSE(c, async (stream) => {
    const pending: JobEvent[] = []
    let notify: (() => void) | null = null
    let finished = false

    const unsubscribe = subscribe(id, (e) => {
      pending.push(e)
      if (e.type === 'done' || e.type === 'failed') finished = true
      notify?.()
    })

    // 画面を閉じられたら（接続が切れたら）ループを抜ける。
    // writeSSE が例外を投げるとは限らないので、切断そのものを見る。
    let aborted = false
    stream.onAbort(() => {
      aborted = true
      finished = true
      notify?.()
    })

    try {
      // まず今の状態を 1 通送る（購読前に終わっていた場合もここで分かる）。
      await stream.writeSSE({ event: 'status', data: JSON.stringify({ job }) })
      if (job.status === 'done' || job.status === 'failed') return

      while (!aborted && (!finished || pending.length > 0)) {
        while (pending.length > 0) {
          const e = pending.shift()
          if (!e) break
          await stream.writeSSE({ event: e.type, data: JSON.stringify(e) })
        }
        if (finished) break
        // 出来事が来るか 15 秒経つまで待つ。待ち終えたらタイマーは必ず解除する
        // （解除しないと 15 秒ぶんのタイマーが積み上がる）。
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            notify = null
            resolve()
          }, 15000)
          notify = () => {
            clearTimeout(timer)
            notify = null
            resolve()
          }
        })
        if (!aborted && !finished && pending.length === 0) {
          await stream.writeSSE({ event: 'ping', data: '{}' })
        }
      }
    } finally {
      unsubscribe()
    }
  })
})

export default app
