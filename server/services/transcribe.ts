// 文字起こしジョブの管理。キュー（同時実行 1）、進捗の配信、後処理、記録への反映。
// 外界に触れる処理は adapters/asr-whisper-cli.ts と adapters/audio-files.ts に閉じ込めてある。
import { getDb } from '../db/connection.ts'
import { now as clockNow, toLocalIso, localDate } from '../adapters/clock.ts'
import {
  attachAudioToEntry,
  findAudio,
  saveAudio,
  WavParseError,
} from '../adapters/audio-files.ts'
import {
  joinSegmentTexts,
  whisperCliAdapter,
  type AsrAdapter,
  type AsrSegment,
} from '../adapters/asr-whisper-cli.ts'
import { boundaryHour, getSettings } from './settings.ts'
import { ValidationError, NotFoundError, createEntry, getEntry, updateEntry } from './entries.ts'

export type JobStatus = 'queued' | 'running' | 'done' | 'failed'

export type JobRow = {
  id: string
  entry_id: string | null
  audio_attachment_id: string | null
  status: JobStatus
  raw_text: string | null
  segments_json: string | null
  model: string | null
  prompt: string | null
  error: string | null
  created_at: string
  finished_at: string | null
  warnings_json: string | null
  day_date: string | null
  dismissed_at: string | null
}

/** 後処理まで済んだセグメント。removed が true のものは本文に入れていない。 */
export type StoredSegment = AsrSegment & { removed?: boolean }

/** 画面に流す出来事。SSE の event 名と同じ。 */
export type JobEvent =
  | { type: 'segment'; job_id: string; segment: AsrSegment }
  | { type: 'warning'; job_id: string; message: string }
  | { type: 'done'; job_id: string; entry_id: string | null; text: string }
  | { type: 'failed'; job_id: string; error: string }

const JOB_COLUMNS = `id, entry_id, audio_attachment_id, status, raw_text, segments_json,
  model, prompt, error, created_at, finished_at, warnings_json, day_date, dismissed_at`

// ---- 進捗の配信（メモリ内。プロセスが生きている間だけ） ----

const listeners = new Map<string, Set<(e: JobEvent) => void>>()

/** ジョブの出来事を受け取る。戻り値を呼ぶと購読をやめる。 */
export function subscribe(jobId: string, fn: (e: JobEvent) => void): () => void {
  let set = listeners.get(jobId)
  if (!set) {
    set = new Set()
    listeners.set(jobId, set)
  }
  const mySet = set
  mySet.add(fn)
  return () => {
    mySet.delete(fn)
    // 自分が入っていた集合が今も登録中のものであるときだけ片づける。
    // 作り直された別の集合（新しい購読者）を巻き込んで消さないため。
    if (mySet.size === 0 && listeners.get(jobId) === mySet) listeners.delete(jobId)
  }
}

function emit(event: JobEvent): void {
  for (const fn of listeners.get(event.job_id) ?? []) {
    try {
      fn(event)
    } catch {
      // 購読側の失敗でジョブを止めない
    }
  }
}

// ---- 後処理（要件 J4） ----

/** 比較用に前後の空白と句読点・記号を落とす。 */
function normalizeForMatch(text: string): string {
  return text
    .replace(/[\s。、．，.,!?！？「」『』…‥・:;：；"'`]+/g, '')
    .trim()
    .toLowerCase()
}

export type PostprocessResult = {
  kept: AsrSegment[]
  segments: StoredSegment[]
  text: string
  warnings: string[]
  /** 全部が定型句で、残った本文が無い */
  empty: boolean
}

/**
 * 定型ハルシネーション句（無音で出やすい「ご視聴ありがとうございました」等）を除去する。
 * 「前後の空白と句読点を除いた完全一致」だけを消す。部分一致では消さない
 * （本当に話した文の中に出てきた場合まで消してしまわないように）。
 */
export function postprocess(segments: AsrSegment[], phrases: string[]): PostprocessResult {
  const targets = phrases.map(normalizeForMatch).filter((p) => p.length > 0)
  const kept: AsrSegment[] = []
  const stored: StoredSegment[] = []
  const removedTexts: string[] = []
  for (const seg of segments) {
    const removed = targets.includes(normalizeForMatch(seg.text))
    stored.push(removed ? { ...seg, removed: true } : { ...seg })
    if (removed) removedTexts.push(seg.text.trim())
    else kept.push(seg)
  }
  const warnings =
    removedTexts.length > 0
      ? [`定型句とみなして ${removedTexts.length} 件のセグメントを除きました：${removedTexts.join(' / ')}`]
      : []
  const text = joinSegmentTexts(kept)
  return { kept, segments: stored, text, warnings, empty: text.trim().length === 0 }
}

// ---- ジョブの記録 ----

function rowOf(id: string): JobRow | null {
  return getDb()
    .query<JobRow, [string]>(`SELECT ${JOB_COLUMNS} FROM transcription_jobs WHERE id = ?`)
    .get(id)
}

export function getJob(id: string): JobRow {
  ensureRecovered()
  const row = rowOf(id)
  if (!row) throw new NotFoundError(`文字起こしジョブが見つかりません: ${id}`)
  return row
}

/**
 * ジョブの一覧。
 * `status` は 1 つでも複数でも指定できる（画面は queued / running / failed をまとめて引く）。
 * `dayDate` を渡すと、その学習日のジョブだけに絞る。
 */
export function listJobs(
  status?: JobStatus | JobStatus[],
  dayDate?: string | null,
): JobRow[] {
  ensureRecovered()
  const db = getDb()
  const statuses = status === undefined ? [] : Array.isArray(status) ? status : [status]
  // 閉じた（dismissed）失敗ジョブは常に除く。
  const where: string[] = ['dismissed_at IS NULL']
  const params: string[] = []
  let hasExplicitFilter = false
  if (statuses.length > 0) {
    where.push(`status IN (${statuses.map(() => '?').join(', ')})`)
    params.push(...statuses)
    hasExplicitFilter = true
  }
  if (dayDate) {
    where.push('day_date = ?')
    params.push(dayDate)
    hasExplicitFilter = true
  }
  const clause = `WHERE ${where.join(' AND ')}`
  // 絞り込みなしの全件は多くなりうるので、そのときだけ 50 件で頭打ちにする。
  const limit = hasExplicitFilter ? '' : 'LIMIT 50'
  return db
    .query<JobRow, string[]>(
      `SELECT ${JOB_COLUMNS} FROM transcription_jobs ${clause} ORDER BY created_at DESC ${limit}`,
    )
    .all(...params)
}

// ---- キュー（同時実行 1） ----

const queue: string[] = []
let running = false
/** テストから差し替えられるようにしてある。既定は whisper-cli を呼ぶ本物。 */
let adapter: AsrAdapter = whisperCliAdapter

export function setAsrAdapter(next: AsrAdapter): void {
  adapter = next
}

/** テスト用：キューと購読を空にする。 */
export function resetTranscribeState(): void {
  queue.length = 0
  running = false
  listeners.clear()
  recovered = false
  adapter = whisperCliAdapter
}

let recovered = false

/**
 * サーバー再起動で running のまま取り残されたジョブを failed に倒す。
 * 実行中だったプロセスは再起動で消えているので、そのままでは永久に動かない。
 */
export function recoverStaleJobs(): number {
  const db = getDb()
  const stale = db
    .query<{ id: string }, []>("SELECT id FROM transcription_jobs WHERE status = 'running'")
    .all()
  for (const row of stale) {
    db.query('UPDATE transcription_jobs SET status = ?, error = ?, finished_at = ? WHERE id = ?').run(
      'failed',
      'サーバーが再起動したため中断されました。再試行してください。',
      toLocalIso(clockNow()),
      row.id,
    )
  }
  return stale.length
}

/** 最初にジョブへ触れたときに 1 度だけ取り残しの後始末をする（関数宣言なので上の参照でも使える）。 */
function ensureRecovered(): void {
  if (recovered) return
  recovered = true
  recoverStaleJobs()
}

export type CreateJobInput = {
  /** 録音した WAV の中身 */
  wav: Uint8Array
  /** 既存の記録に追記する場合その id */
  entryId?: string | null
  /** 記録をこれから作る場合の学習日 */
  dayDate?: string | null
}

/** WAV を保存してジョブを queued で作り、キューに載せる。すぐ返る（202 相当）。 */
export async function createJob(input: CreateJobInput, now: Date = clockNow()): Promise<JobRow> {
  ensureRecovered()
  if (!input.wav || input.wav.byteLength === 0) {
    throw new ValidationError('音声データが空です')
  }
  if (input.entryId) getEntry(input.entryId) // 存在しなければ 404
  // WAV として読めない入力は「入力の誤り」（400）として返す。
  // WavParseError のままだと 500（サーバー内部エラー）になり、原因が利用者に伝わらない。
  let saved
  try {
    saved = await saveAudio(input.wav, { entryId: input.entryId ?? null, now })
  } catch (e) {
    if (e instanceof WavParseError) {
      throw new ValidationError(`WAV 形式の音声を送ってください（${e.message}）`)
    }
    throw e
  }
  const id = Bun.randomUUIDv7()
  const dayDate = input.dayDate ?? localDate(now, boundaryHour())
  getDb()
    .query(
      `INSERT INTO transcription_jobs (id, entry_id, audio_attachment_id, status, created_at, day_date)
       VALUES (?, ?, ?, 'queued', ?, ?)`,
    )
    .run(id, input.entryId ?? null, saved.attachmentId, toLocalIso(now), dayDate)
  queue.push(id)
  // 呼び出し元に queued の状態を返してから動かす（202 を返してから走らせる）。
  queueMicrotask(() => void pump())
  return getJob(id)
}

/**
 * 失敗したジョブを画面から閉じる（永続的に一覧から除く）。
 * `failed` 以外（queued / running / done）は状態が変わり得るので閉じられない。
 */
export function dismissJob(id: string, now: Date = clockNow()): JobRow {
  ensureRecovered()
  const job = getJob(id)
  if (job.status !== 'failed') {
    throw new ValidationError('失敗した文字起こしだけ閉じられます')
  }
  getDb()
    .query('UPDATE transcription_jobs SET dismissed_at = ? WHERE id = ?')
    .run(toLocalIso(now), id)
  return getJob(id)
}

/** 失敗したジョブを保存済みの WAV でやり直す（要件 C4）。 */
export function retryJob(id: string): JobRow {
  ensureRecovered()
  const job = getJob(id)
  if (job.status === 'queued' || job.status === 'running') return job
  // 完了済みのジョブは再試行しない。もう一度走らせると同じ文章が本文に二重で追記される。
  if (job.status === 'done') {
    throw new ValidationError('この文字起こしは完了しています。再試行はできません')
  }
  if (!job.audio_attachment_id || !findAudio(job.audio_attachment_id)) {
    throw new ValidationError('元の音声ファイルが見つからないため再試行できません')
  }
  getDb()
    .query(
      "UPDATE transcription_jobs SET status = 'queued', error = NULL, finished_at = NULL WHERE id = ?",
    )
    .run(id)
  queue.push(id)
  // 呼び出し元に queued の状態を返してから動かす（202 を返してから走らせる）。
  queueMicrotask(() => void pump())
  return getJob(id)
}

/** キューを 1 件ずつ処理する。同時実行はしない（M4 でも同時に走らせると遅くなる）。 */
async function pump(): Promise<void> {
  if (running) return
  running = true
  try {
    while (queue.length > 0) {
      const id = queue.shift()
      if (!id) continue
      await runJob(id)
    }
  } finally {
    running = false
  }
}

/** 現在の処理が終わるまで待つ（テストと停止処理で使う）。 */
export async function waitForIdle(): Promise<void> {
  // pump はマイクロタスクで動くので、空になるまで様子を見る。
  while (running || queue.length > 0) {
    await new Promise((r) => setTimeout(r, 5))
  }
}

async function runJob(id: string): Promise<void> {
  const db = getDb()
  const job = rowOf(id)
  if (!job || job.status !== 'queued') return
  const audio = job.audio_attachment_id ? findAudio(job.audio_attachment_id) : null
  if (!audio) {
    finishFailed(id, '音声ファイルが見つかりません')
    return
  }
  db.query("UPDATE transcription_jobs SET status = 'running', error = NULL WHERE id = ?").run(id)

  try {
    const result = await adapter.transcribe(audio.abs_path, {}, (segment) => {
      emit({ type: 'segment', job_id: id, segment })
    })
    const settings = getSettings()
    const phrases = Array.isArray(settings.hallucination_phrases)
      ? settings.hallucination_phrases
      : []
    const post = postprocess(result.segments, phrases)
    for (const w of post.warnings) emit({ type: 'warning', job_id: id, message: w })

    if (post.empty) {
      finishFailed(id, '音声を認識できませんでした', {
        rawText: result.text,
        segments: post.segments,
        warnings: post.warnings,
        model: result.model,
        prompt: result.prompt,
      })
      return
    }

    // 本文への反映とジョブ完了の記録を 1 つのトランザクションにまとめる。
    // 別々に確定すると、間で失敗したときに「本文は書かれたのにジョブは失敗」となり、
    // 再試行で同じ文章がもう一度追記されてしまう。
    const now = toLocalIso(clockNow())
    let entryId = ''
    db.transaction(() => {
      entryId = applyToEntry(job, post.text)
      db.query(
        `UPDATE transcription_jobs
            SET status = 'done', raw_text = ?, segments_json = ?, warnings_json = ?,
                model = ?, prompt = ?, entry_id = ?, error = NULL, finished_at = ?
          WHERE id = ?`,
      ).run(
        result.text,
        JSON.stringify(post.segments),
        post.warnings.length > 0 ? JSON.stringify(post.warnings) : null,
        result.model,
        result.prompt,
        entryId,
        now,
        id,
      )
      if (job.audio_attachment_id) attachAudioToEntry(job.audio_attachment_id, entryId)
    })()
    emit({ type: 'done', job_id: id, entry_id: entryId, text: post.text })
  } catch (e) {
    finishFailed(id, e instanceof Error ? e.message : String(e))
  }
}

/** 記録に反映する。既存の記録があれば本文末尾に空行を挟んで追記、無ければ新しく作る。 */
function applyToEntry(job: JobRow, text: string): string {
  if (job.entry_id) {
    const current = getEntry(job.entry_id)
    const body =
      current.body_md.trim().length > 0 ? `${current.body_md.replace(/\s+$/, '')}\n\n${text}` : text
    updateEntry(job.entry_id, { body_md: body })
    return job.entry_id
  }
  const entry = createEntry({ day_date: job.day_date ?? undefined, body_md: text })
  return entry.id
}

function finishFailed(
  id: string,
  message: string,
  extra?: {
    rawText?: string
    segments?: StoredSegment[]
    warnings?: string[]
    model?: string
    prompt?: string
  },
): void {
  getDb()
    .query(
      `UPDATE transcription_jobs
          SET status = 'failed', error = ?, finished_at = ?,
              raw_text = COALESCE(?, raw_text), segments_json = COALESCE(?, segments_json),
              warnings_json = COALESCE(?, warnings_json),
              model = COALESCE(?, model), prompt = COALESCE(?, prompt)
        WHERE id = ?`,
    )
    .run(
      message,
      toLocalIso(clockNow()),
      extra?.rawText ?? null,
      extra?.segments ? JSON.stringify(extra.segments) : null,
      extra?.warnings && extra.warnings.length > 0 ? JSON.stringify(extra.warnings) : null,
      extra?.model ?? null,
      extra?.prompt ?? null,
      id,
    )
  emit({ type: 'failed', job_id: id, error: message })
}
