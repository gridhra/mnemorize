// 文字起こしジョブの状態遷移と後処理のテスト。whisper-cli は起動せず、偽のアダプタに差し替える。
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AsrSegment } from '../adapters/asr-whisper-cli.ts'
import type { JobEvent } from './transcribe.ts'

// テスト用に独立した DB を使う（import より前に環境変数を決める必要がある）。
const tmp = mkdtempSync(join(tmpdir(), 'mnemorize-test-asr-'))
process.env.MNEMORIZE_DATA_DIR = tmp

const { getDb, resetDbCache } = await import('../db/connection.ts')
const {
  attachJobsToEntry,
  createJob,
  dismissJob,
  getJob,
  listJobs,
  postprocess,
  recoverStaleJobs,
  resetTranscribeState,
  retryJob,
  setAsrAdapter,
  subscribe,
  waitForIdle,
} = await import('./transcribe.ts')
const { createEntry, getEntry, listDay } = await import('./entries.ts')
const { parseWavHeader } = await import('../adapters/audio-files.ts')

/** 16kHz モノラル 16bit の無音 WAV を作る（中身は使わないのでヘッダが正しければよい）。 */
function makeWav(seconds = 1): Uint8Array {
  const sampleRate = 16000
  const samples = sampleRate * seconds
  const dataSize = samples * 2
  const buf = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buf)
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, dataSize, true)
  return new Uint8Array(buf)
}

/** 決めたセグメントを返すだけの偽アダプタ。失敗させたいときは error を渡す。 */
function fakeAdapter(segments: AsrSegment[], error?: string) {
  return {
    async transcribe(_wav: string, _opts: unknown, onSegment?: (s: AsrSegment) => void) {
      for (const s of segments) onSegment?.(s)
      if (error) throw new Error(error)
      return {
        text: segments.map((s) => s.text).join(''),
        segments,
        model: '/tmp/fake-model.bin',
        prompt: 'テスト',
      }
    },
  }
}

const seg = (text: string, from = 0, to = 1000): AsrSegment => ({ from_ms: from, to_ms: to, text })

beforeEach(() => {
  resetTranscribeState()
  const db = getDb()
  for (const t of ['review_logs', 'entry_revisions', 'transcription_jobs', 'attachments', 'schedule_state', 'entries']) {
    db.exec(`DELETE FROM ${t}`)
  }
  db.exec('DELETE FROM entry_fts')
  db.exec('DELETE FROM settings')
})

afterAll(() => {
  resetDbCache()
  rmSync(tmp, { recursive: true, force: true })
})

describe('WAV ヘッダの読み取り', () => {
  test('サンプルレートと長さが分かる', () => {
    const info = parseWavHeader(makeWav(2))
    expect(info.sampleRate).toBe(16000)
    expect(info.channels).toBe(1)
    expect(info.bitsPerSample).toBe(16)
    expect(info.durationSec).toBeCloseTo(2, 3)
  })
})

describe('後処理（定型ハルシネーション句の除去。要件 J4）', () => {
  const phrases = ['ご視聴ありがとうございました', 'チャンネル登録', 'you', 'Thank you.']

  test('前後の空白と句読点を除いた完全一致のセグメントを除き、警告を残す', () => {
    const r = postprocess(
      [seg('今日は本を読んだ。'), seg(' ご視聴ありがとうございました。'), seg('明日も読む。')],
      phrases,
    )
    expect(r.text).toBe('今日は本を読んだ。明日も読む。')
    expect(r.warnings).toHaveLength(1)
    expect(r.segments.filter((s) => s.removed)).toHaveLength(1)
    expect(r.empty).toBe(false)
  })

  test('文の一部に含まれるだけなら消さない', () => {
    const r = postprocess([seg('最後にご視聴ありがとうございましたと言われた。')], phrases)
    expect(r.text).toBe('最後にご視聴ありがとうございましたと言われた。')
    expect(r.warnings).toHaveLength(0)
  })

  test('全部が定型句なら「認識できなかった」扱いにする', () => {
    const r = postprocess([seg('you'), seg('Thank you.')], phrases)
    expect(r.empty).toBe(true)
  })

  test('日本語どうしの結合に空白を入れない', () => {
    const r = postprocess([seg('前半の文。'), seg('後半の文。')], [])
    expect(r.text).toBe('前半の文。後半の文。')
  })
})

describe('ジョブの状態遷移', () => {
  test('queued → done。記録は作られず、結果と音声はジョブに残る', async () => {
    setAsrAdapter(fakeAdapter([seg('今日は固有値の章を読んだ。'), seg('明日は演習をする。')]))
    const events: JobEvent[] = []
    const job = await createJob({ wav: makeWav(), dayDate: '2026-09-15' })
    expect(job.status).toBe('queued')
    subscribe(job.id, (e) => events.push(e))
    await waitForIdle()

    const done = getJob(job.id)
    expect(done.status).toBe('done')
    expect(done.raw_text).toBe('今日は固有値の章を読んだ。明日は演習をする。')
    expect(done.model).toBe('/tmp/fake-model.bin')
    // 記録は作らない。結果は done の出来事で画面の本文欄に流れ込み、
    // 利用者が手直しして保存したときに初めて記録になる。
    expect(done.entry_id).toBeNull()
    expect(listDay('2026-09-15')).toHaveLength(0)
    // 音声はまだどの記録のものでもない。
    expect(
      getDb().query('SELECT entry_id FROM attachments WHERE id = ?').get(done.audio_attachment_id),
    ).toEqual({ entry_id: null })

    const doneEvent = events.find((e) => e.type === 'done')
    expect(doneEvent).toBeDefined()
    expect(doneEvent?.type === 'done' && doneEvent.text).toBe(
      '今日は固有値の章を読んだ。明日は演習をする。',
    )
  })

  test('既存の記録の本文は、ジョブが終わっても勝手に書き換わらない', async () => {
    setAsrAdapter(fakeAdapter([seg('書き足すつもりの内容。')]))
    const entry = createEntry({ day_date: '2026-09-15', body_md: '最初の本文。' })
    const job = await createJob({ wav: makeWav(), dayDate: '2026-09-15' })
    await waitForIdle()
    expect(getJob(job.id).status).toBe('done')
    // 本文への反映は画面（編集中の本文欄）が行う。サーバーは触らない。
    expect(getEntry(entry.id).body_md).toBe('最初の本文。')
  })

  test('保存のときにジョブを記録へ結びつけると、音声がその記録に付く', async () => {
    setAsrAdapter(fakeAdapter([seg('録音した内容。')]))
    const job = await createJob({ wav: makeWav(), dayDate: '2026-09-15' })
    await waitForIdle()
    const entry = createEntry({ day_date: '2026-09-15', body_md: '手直しした本文。' })

    attachJobsToEntry([job.id], entry.id)

    expect(getJob(job.id).entry_id).toBe(entry.id)
    const after = getEntry(entry.id)
    expect(after.attachments).toHaveLength(1)
    expect(after.attachments[0]?.kind).toBe('audio')
  })

  test('別の記録に結びついたジョブを付け替えようとすると ValidationError', async () => {
    const { ValidationError } = await import('./errors.ts')
    setAsrAdapter(fakeAdapter([seg('一度きりの録音。')]))
    const job = await createJob({ wav: makeWav(), dayDate: '2026-09-15' })
    await waitForIdle()
    const first = createEntry({ day_date: '2026-09-15', body_md: '先に保存した記録。' })
    attachJobsToEntry([job.id], first.id)

    const second = createEntry({ day_date: '2026-09-15', body_md: 'あとの記録。' })
    expect(() => attachJobsToEntry([job.id], second.id)).toThrow(ValidationError)
    expect(getJob(job.id).entry_id).toBe(first.id)
  })

  test('全セグメントが定型句なら failed（音声を認識できませんでした）', async () => {
    setAsrAdapter(fakeAdapter([seg('ご視聴ありがとうございました')]))
    const job = await createJob({ wav: makeWav(), dayDate: '2026-09-15' })
    await waitForIdle()
    const after = getJob(job.id)
    expect(after.status).toBe('failed')
    expect(after.error).toBe('音声を認識できませんでした')
    expect(after.entry_id).toBeNull()
  })

  test('失敗 → 再試行で done になる', async () => {
    setAsrAdapter(fakeAdapter([], 'whisper-cli が失敗しました（終了コード 1）'))
    const job = await createJob({ wav: makeWav(), dayDate: '2026-09-15' })
    await waitForIdle()
    expect(getJob(job.id).status).toBe('failed')
    expect(listJobs('failed').map((j) => j.id)).toContain(job.id)

    setAsrAdapter(fakeAdapter([seg('やり直したら通った。')]))
    const retried = retryJob(job.id)
    expect(retried.status).toBe('queued')
    await waitForIdle()
    const done = getJob(job.id)
    expect(done.status).toBe('done')
    expect(done.error).toBeNull()
    expect(done.raw_text).toBe('やり直したら通った。')
  })

  test('完了したジョブの再試行は拒否する（本文欄への二重の流し込みを防ぐ）', async () => {
    const { ValidationError } = await import('./entries.ts')
    setAsrAdapter(fakeAdapter([seg('1 回だけ流れ込む。')]))
    const job = await createJob({ wav: makeWav(), dayDate: '2026-09-15' })
    await waitForIdle()
    expect(getJob(job.id).status).toBe('done')

    expect(() => retryJob(job.id)).toThrow(ValidationError)
    await waitForIdle()
  })

  test('failed なジョブを閉じると一覧から消える（再読み込みで復帰しない）', async () => {
    setAsrAdapter(fakeAdapter([], 'whisper-cli が失敗しました（終了コード 1）'))
    const job = await createJob({ wav: makeWav(), dayDate: '2026-09-15' })
    await waitForIdle()
    expect(getJob(job.id).status).toBe('failed')
    expect(listJobs('failed').map((j) => j.id)).toContain(job.id)

    const dismissed = dismissJob(job.id)
    expect(dismissed.dismissed_at).not.toBeNull()
    expect(listJobs('failed').map((j) => j.id)).not.toContain(job.id)
    expect(listJobs(['queued', 'running', 'failed']).map((j) => j.id)).not.toContain(job.id)
    // getJob（id 直指定）では引き続き読める（元の音声などを見返せるようにするため）。
    expect(getJob(job.id).status).toBe('failed')
  })

  test('queued / running / done のジョブは閉じられない', async () => {
    const { ValidationError } = await import('./entries.ts')
    setAsrAdapter(fakeAdapter([seg('完了した。')]))
    const job = await createJob({ wav: makeWav(), dayDate: '2026-09-15' })
    await waitForIdle()
    expect(getJob(job.id).status).toBe('done')
    expect(() => dismissJob(job.id)).toThrow(ValidationError)
  })

  test('一覧は status を複数指定でき、day_date で絞れる', async () => {
    setAsrAdapter(fakeAdapter([], 'whisper-cli が失敗しました（終了コード 1）'))
    const failedToday = await createJob({ wav: makeWav(), dayDate: '2026-09-15' })
    const failedOtherDay = await createJob({ wav: makeWav(), dayDate: '2026-09-16' })
    await waitForIdle()

    const ids = listJobs(['queued', 'running', 'failed'], '2026-09-15').map((j) => j.id)
    expect(ids).toContain(failedToday.id)
    expect(ids).not.toContain(failedOtherDay.id)

    // 完了したジョブは queued / running / failed の絞り込みに入らない。
    setAsrAdapter(fakeAdapter([seg('完了した。')]))
    const doneJob = await createJob({ wav: makeWav(), dayDate: '2026-09-15' })
    await waitForIdle()
    expect(getJob(doneJob.id).status).toBe('done')
    expect(listJobs(['queued', 'running', 'failed'], '2026-09-15').map((j) => j.id)).not.toContain(
      doneJob.id,
    )
  })

  test('WAV として読めないデータは ValidationError（400 になる）', async () => {
    const { ValidationError } = await import('./entries.ts')
    const notWav = new TextEncoder().encode('not-a-wav')
    await expect(createJob({ wav: notWav, dayDate: '2026-09-15' })).rejects.toThrow(ValidationError)
  })

  test('部分結果（セグメント）が購読者に届く', async () => {
    setAsrAdapter(fakeAdapter([seg('一つ目。'), seg('二つ目。')]))
    // 購読はジョブ作成の前には張れないので、作成直後に張って待つ。
    const events: JobEvent[] = []
    const job = await createJob({ wav: makeWav(), dayDate: '2026-09-15' })
    subscribe(job.id, (e) => events.push(e))
    await waitForIdle()
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  test('警告は warnings_json に残る', async () => {
    setAsrAdapter(fakeAdapter([seg('本当の内容。'), seg('チャンネル登録')]))
    const job = await createJob({ wav: makeWav(), dayDate: '2026-09-15' })
    await waitForIdle()
    const after = getJob(job.id)
    expect(after.status).toBe('done')
    expect(JSON.parse(after.warnings_json ?? '[]')).toHaveLength(1)
    // 定型句を除いたあとの文章が done の出来事で画面に届く。
    expect(after.raw_text).toBe('本当の内容。チャンネル登録')
  })
})

describe('再起動後の取り残し', () => {
  test('running のまま残ったジョブは failed に倒す', async () => {
    setAsrAdapter(fakeAdapter([seg('あ')]))
    const job = await createJob({ wav: makeWav(), dayDate: '2026-09-15' })
    await waitForIdle()
    getDb().query("UPDATE transcription_jobs SET status = 'running' WHERE id = ?").run(job.id)
    expect(recoverStaleJobs()).toBe(1)
    const after = getJob(job.id)
    expect(after.status).toBe('failed')
    expect(after.error).toContain('再起動')
  })
})
