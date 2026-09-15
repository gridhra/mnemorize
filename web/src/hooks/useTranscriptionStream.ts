// 文字起こしの結果を、いま開いているフォームの本文欄に流し込むためのフック。
//
// 録音を止めるとサーバーに文字起こしジョブができる（記録は作られない）。このフックは
// そのジョブをサーバー送信イベント（SSE）で購読し、届いた文章を `onAppend` に渡す。
// 本文欄への書き込み方（空行を挟む・IME の変換中は待つ）は呼び出し元の仕事。
import { useEffect, useRef, useState } from 'preact/hooks'
import { api, type TranscriptionJob } from '../api.ts'

/** 画面に出すジョブ 1 件の状態。 */
export type JobView = {
  id: string
  /** waiting＝順番待ち、running＝認識中、done＝完了、failed＝失敗。 */
  status: 'waiting' | 'running' | 'done' | 'failed'
  error: string | null
  /** 定型句を除いたなどの注意。 */
  warnings: string[]
  /** ジョブを見始めてからの秒数（待ちの長さを見せるため）。 */
  elapsedSec: number
}

type Options = {
  /**
   * 文字起こしの文章が届いたときに呼ぶ。
   * `first` が true なら、その録音の最初のひとかたまり（本文の末尾に空行を挟んで足す）。
   * false なら同じ録音の続き（そのまま詰めて足す）。
   */
  onAppend: (text: string, first: boolean) => void
}

export type TranscriptionStream = {
  jobs: JobView[]
  /** この画面で録音してできたジョブを見始める。 */
  addJob: (jobId: string) => void
  /**
   * 下書きから復元したジョブを見始める。まだ終わっていなければ続きを本文欄に流すが、
   * 完了していた分は下書きの本文に入っているものとして、もう一度は流さない。
   */
  restoreJobs: (jobIds: string[]) => void
  /** 失敗したジョブをやり直す。 */
  retry: (jobId: string) => Promise<void>
  /** 保存に添える id（結びつける音声）。失敗したジョブも含める必要はないので done と進行中だけ。 */
  jobIdsForSave: () => string[]
  /** 保存・取りやめのあとに全部忘れる。 */
  clear: () => void
}

/** 1 件ぶんの購読の後始末に必要なもの。 */
type Subscription = { close: () => void }

export function useTranscriptionStream({ onAppend }: Options): TranscriptionStream {
  const [jobs, setJobs] = useState<JobView[]>([])
  // 購読とジョブごとの覚え書き。再描画のたびに作り直さないよう ref に持つ。
  const subscriptions = useRef(new Map<string, Subscription>())
  const startedAt = useRef(new Map<string, number>())
  /** その録音の文章を既に 1 度でも本文欄に流したか（続きは詰めて足すため）。 */
  const appended = useRef(new Map<string, boolean>())
  /** 下書きから復元したジョブ。完了の文章をまとめて流し直さない。 */
  const restored = useRef(new Set<string>())
  // onAppend は毎回新しい関数なので、最新のものを ref 経由で呼ぶ（購読は貼り直さない）。
  const appendRef = useRef(onAppend)
  appendRef.current = onAppend

  // 経過時間。決着していないジョブがあるあいだだけ動かす。
  const pending = jobs.some((j) => j.status === 'waiting' || j.status === 'running')
  useEffect(() => {
    if (!pending) return
    const timer = setInterval(() => {
      setJobs((cur) =>
        cur.map((j) =>
          j.status === 'waiting' || j.status === 'running'
            ? { ...j, elapsedSec: Math.floor((Date.now() - (startedAt.current.get(j.id) ?? Date.now())) / 1000) }
            : j,
        ),
      )
    }, 1000)
    return () => clearInterval(timer)
  }, [pending])

  // 画面から消えるときは購読をすべて閉じる。
  useEffect(() => {
    const open = subscriptions.current
    return () => {
      for (const s of open.values()) s.close()
      open.clear()
    }
  }, [])

  function patch(jobId: string, next: Partial<JobView>): void {
    setJobs((cur) => cur.map((j) => (j.id === jobId ? { ...j, ...next } : j)))
  }

  function append(jobId: string, text: string): void {
    if (text.trim().length === 0) return
    const first = !appended.current.get(jobId)
    appended.current.set(jobId, true)
    appendRef.current(text, first)
  }

  /** ジョブ 1 件の購読を貼る。既に貼っていれば貼り直す（再試行のとき）。 */
  function listen(jobId: string): void {
    subscriptions.current.get(jobId)?.close()
    const source = new EventSource(api.transcriptionEventsUrl(jobId))
    let closed = false
    const close = () => {
      if (closed) return
      closed = true
      source.close()
    }
    subscriptions.current.set(jobId, { close })

    /**
     * 完了。途中経過を 1 つも受け取っていなければ、完成した文章をまとめて流す
     * （購読する前に終わっていた場合。そのときだけ、定型句を除く前の文章になることがある）。
     */
    const finish = (text: string) => {
      close()
      if (!appended.current.get(jobId) && !restored.current.has(jobId)) append(jobId, text)
      patch(jobId, { status: 'done' })
    }

    source.addEventListener('status', (e) => {
      const job = (JSON.parse((e as MessageEvent).data).job ?? null) as TranscriptionJob | null
      if (!job) return
      if (job.status === 'done') {
        finish(job.raw_text ?? '')
      } else if (job.status === 'failed') {
        close()
        patch(jobId, { status: 'failed', error: job.error })
      } else {
        patch(jobId, { status: job.status === 'running' ? 'running' : 'waiting' })
      }
    })
    source.addEventListener('segment', (e) => {
      const data = JSON.parse((e as MessageEvent).data)
      patch(jobId, { status: 'running' })
      append(jobId, String(data.segment?.text ?? ''))
    })
    source.addEventListener('warning', (e) => {
      const data = JSON.parse((e as MessageEvent).data)
      const message = String(data.message ?? '')
      setJobs((cur) =>
        cur.map((j) => (j.id === jobId ? { ...j, warnings: [...j.warnings, message] } : j)),
      )
    })
    source.addEventListener('done', (e) => {
      finish(String(JSON.parse((e as MessageEvent).data).text ?? ''))
    })
    source.addEventListener('failed', (e) => {
      close()
      patch(jobId, { status: 'failed', error: String(JSON.parse((e as MessageEvent).data).error ?? '') })
    })
    source.onerror = () => {
      // 接続が切れたら状態を 1 回だけ問い合わせて決着をつける（完了直後の切断と区別するため）。
      close()
      api
        .transcription(jobId)
        .then(({ job }) => {
          if (job.status === 'done') finish(job.raw_text ?? '')
          else if (job.status === 'failed') patch(jobId, { status: 'failed', error: job.error })
          else listen(jobId) // まだ動いている。貼り直す。
        })
        .catch(() => patch(jobId, { status: 'failed', error: null }))
    }
  }

  function track(jobId: string): void {
    startedAt.current.set(jobId, Date.now())
    setJobs((cur) =>
      cur.some((j) => j.id === jobId)
        ? cur
        : [...cur, { id: jobId, status: 'waiting', error: null, warnings: [], elapsedSec: 0 }],
    )
    listen(jobId)
  }

  return {
    jobs,
    addJob: track,
    restoreJobs: (jobIds) => {
      for (const id of jobIds) {
        restored.current.add(id)
        track(id)
      }
    },
    retry: async (jobId) => {
      patch(jobId, { status: 'waiting', error: null, warnings: [] })
      startedAt.current.set(jobId, Date.now())
      // やり直したぶんは最初のひとかたまりとして本文欄に足す。
      appended.current.delete(jobId)
      restored.current.delete(jobId)
      await api.retryTranscription(jobId)
      listen(jobId)
    },
    jobIdsForSave: () => jobs.filter((j) => j.status !== 'failed').map((j) => j.id),
    clear: () => {
      for (const s of subscriptions.current.values()) s.close()
      subscriptions.current.clear()
      startedAt.current.clear()
      appended.current.clear()
      restored.current.clear()
      setJobs([])
    },
  }
}
