// 記録（エントリ）の作成・更新・履歴・日付一覧。ルートは薄く、ロジックはここ。
import { getDb, dataDir } from '../db/connection.ts'
import { isDateString, localDate, now as clockNow, toLocalIso } from '../adapters/clock.ts'
import { boundaryHour } from './settings.ts'
import { createInitialState, retrievability } from './scheduler.ts'
import { resetSchedule, writeScheduleState } from './reviews.ts'
import { toState } from './schedule-state.ts'
import { deleteAttachmentFile } from '../adapters/files.ts'
import { attachJobsToEntry } from './transcribe.ts'

export type EntryRow = {
  id: string
  day_date: string
  title: string | null
  body_md: string
  review_enabled: number
  retired_at: string | null
  created_at: string
  updated_at: string
  sort_order: number
  schedule_reset_at: string | null
}

export type Entry = EntryRow & {
  /** タイトルが空のときの手がかり（本文先頭 1 文。要件 D4=B） */
  headline: string
  schedule: ScheduleRow | null
  /**
   * 今この瞬間に思い出せる確率の推定値（0〜1）。まだ一度も復習していなければ null。
   * 計算は services/scheduler.ts の `retrievability()` に任せる（キューと同じ関数）。
   */
  retrievability: number | null
  attachments: AttachmentRow[]
}

export type ScheduleRow = {
  entry_id: string
  due: string
  state: string
  stability: number | null
  difficulty: number | null
  elapsed_days: number | null
  scheduled_days: number | null
  reps: number
  lapses: number
  last_review: string | null
  algo: string | null
}

export type AttachmentRow = {
  id: string
  entry_id: string | null
  kind: string
  rel_path: string
  mime: string
  bytes: number
  sha256: string | null
  duration_sec: number | null
  created_at: string
}

export type RevisionRow = {
  id: string
  entry_id: string
  rev_no: number
  title: string | null
  body_md: string
  created_at: string
}

// エラー型は循環インポートを避けるため services/errors.ts にある。ここでは import かつ
// re-export して、既存の「entries.ts から ValidationError / NotFoundError を import する」
// 呼び出し側との互換を保つ（import を伴わない `export { X } from 'mod'` だけだと、
// このファイル自身のコードから NotFoundError / ValidationError を参照できない）。
import { ValidationError, NotFoundError } from './errors.ts'
export { ValidationError, NotFoundError }

const ENTRY_COLUMNS = `id, day_date, title, body_md, review_enabled, retired_at,
  created_at, updated_at, sort_order, schedule_reset_at`

/** 本文の先頭 1 文を手がかりとして取り出す（Markdown の記号は軽く落とす）。 */
export function headlineOf(title: string | null, bodyMd: string): string {
  if (title && title.trim().length > 0) return title.trim()
  const firstLine = bodyMd
    .split('\n')
    .map((l) => l.replace(/^\s*(#{1,6}|[-*+]|\d+\.)\s*/, '').trim())
    .find((l) => l.length > 0)
  if (!firstLine) return ''
  // 先頭 1 文を取り、末尾の句読点は落とす（見出しは文ではなく札なので点を残さない）。
  const sentence = (firstLine.split(/(?<=[。．.!?！？])/)[0] ?? firstLine).replace(
    /[。．.!?！？]+$/,
    '',
  )
  return sentence.length > 60 ? `${sentence.slice(0, 60)}…` : sentence
}

function decorate(row: EntryRow, now: Date = clockNow()): Entry {
  const db = getDb()
  const schedule = db
    .query<ScheduleRow, [string]>('SELECT * FROM schedule_state WHERE entry_id = ?')
    .get(row.id)
  const attachments = db
    .query<AttachmentRow, [string]>(
      'SELECT * FROM attachments WHERE entry_id = ? ORDER BY created_at',
    )
    .all(row.id)
  return {
    ...row,
    headline: headlineOf(row.title, row.body_md),
    schedule,
    retrievability: schedule ? retrievability(toState(schedule), now, boundaryHour()) : null,
    attachments,
  }
}

export function getEntry(id: string): Entry {
  const row = getDb()
    .query<EntryRow, [string]>(`SELECT ${ENTRY_COLUMNS} FROM entries WHERE id = ?`)
    .get(id)
  if (!row) throw new NotFoundError(`記録が見つかりません: ${id}`)
  return decorate(row)
}

/** その日の記録一覧（添付・予定を含む）。 */
export function listDay(date: string): Entry[] {
  if (!isDateString(date)) throw new ValidationError('日付は YYYY-MM-DD の形で指定してください')
  const rows = getDb()
    .query<EntryRow, [string]>(
      `SELECT ${ENTRY_COLUMNS} FROM entries WHERE day_date = ? ORDER BY sort_order, created_at`,
    )
    .all(date)
  return rows.map((r) => decorate(r))
}

/** 期間内の日ごとの件数（カレンダー表示用）。 */
export function listDayCounts(from: string, to: string): { day_date: string; count: number }[] {
  if (!isDateString(from) || !isDateString(to)) {
    throw new ValidationError('from と to は YYYY-MM-DD の形で指定してください')
  }
  return getDb()
    .query<{ day_date: string; count: number }, [string, string]>(
      `SELECT day_date, COUNT(*) AS count FROM entries
       WHERE day_date BETWEEN ? AND ? GROUP BY day_date ORDER BY day_date`,
    )
    .all(from, to)
}

export type CreateInput = {
  day_date?: string
  title?: string | null
  body_md?: string
  review_enabled?: boolean
  /**
   * この記録に結びつける文字起こしジョブの id。録音した音声の添付とジョブが、
   * ここで初めてこの記録のものになる（結びつけの中身は services/transcribe.ts）。
   */
  transcription_job_ids?: string[]
}

/** 記録を作る。同時に schedule_state を New・翌日の境界時刻で 1 行作る（要件 S5）。 */
export function createEntry(input: CreateInput, now: Date = clockNow()): Entry {
  const db = getDb()
  const hour = boundaryHour()
  const dayDate = input.day_date ?? localDate(now, hour)
  if (!isDateString(dayDate)) throw new ValidationError('day_date は YYYY-MM-DD の形で指定してください')
  const bodyMd = input.body_md ?? ''
  const title = input.title?.trim() ? input.title.trim() : null
  if (bodyMd.trim().length === 0 && !title) {
    throw new ValidationError('本文かタイトルのどちらかは必要です')
  }
  const id = Bun.randomUUIDv7()
  const nowIso = toLocalIso(now)
  const reviewEnabled = input.review_enabled === false ? 0 : 1

  db.transaction(() => {
    const nextOrder =
      db
        .query<{ v: number }, [string]>(
          'SELECT COALESCE(MAX(sort_order), -1) + 1 AS v FROM entries WHERE day_date = ?',
        )
        .get(dayDate)?.v ?? 0
    db.query(
      `INSERT INTO entries (id, day_date, title, body_md, review_enabled, created_at, updated_at, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, dayDate, title, bodyMd, reviewEnabled, nowIso, nowIso, nextOrder)
    // 初期状態はスケジューラのラッパーに決めさせる（state=New、期限は作成した学習日の翌日）。
    writeScheduleState(id, createInitialState(now, hour))
    // 結びつけが失敗（見つからない id・別の記録のジョブ）したら記録ごと作らない。
    attachJobsToEntry(input.transcription_job_ids ?? [], id)
  })()
  return getEntry(id)
}

export type UpdateInput = {
  title?: string | null
  body_md?: string
  review_enabled?: boolean
  /**
   * 「内容を作り直したので最初から」（要件 S4）。既定はオフ。
   * ふつうの加筆修正では復習の履歴も予定もリセットしない。
   */
  reset_schedule?: boolean
  /** 「録音して書き足す」で作った文字起こしジョブ。音声をこの記録に結びつける。 */
  transcription_job_ids?: string[]
}

/** 記録を更新する。本文かタイトルが変わるときは、更新前の全文を entry_revisions に積む。 */
export function updateEntry(id: string, input: UpdateInput, now: Date = clockNow()): Entry {
  const db = getDb()
  const before = db
    .query<EntryRow, [string]>(`SELECT ${ENTRY_COLUMNS} FROM entries WHERE id = ?`)
    .get(id)
  if (!before) throw new NotFoundError(`記録が見つかりません: ${id}`)

  const nextTitle =
    input.title === undefined ? before.title : input.title?.trim() ? input.title.trim() : null
  const nextBody = input.body_md === undefined ? before.body_md : input.body_md
  const nextReview =
    input.review_enabled === undefined ? before.review_enabled : input.review_enabled ? 1 : 0
  const textChanged = nextTitle !== before.title || nextBody !== before.body_md
  const nowIso = toLocalIso(now)

  db.transaction(() => {
    if (textChanged) {
      const revNo =
        (db
          .query<{ v: number }, [string]>(
            'SELECT COALESCE(MAX(rev_no), 0) + 1 AS v FROM entry_revisions WHERE entry_id = ?',
          )
          .get(id)?.v ?? 1)
      db.query(
        `INSERT INTO entry_revisions (id, entry_id, rev_no, title, body_md, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(Bun.randomUUIDv7(), id, revNo, before.title, before.body_md, nowIso)
    }
    db.query(
      'UPDATE entries SET title = ?, body_md = ?, review_enabled = ?, updated_at = ? WHERE id = ?',
    ).run(nextTitle, nextBody, nextReview, nowIso, id)
    attachJobsToEntry(input.transcription_job_ids ?? [], id)
  })()

  // 「最初からやり直す」が指定されたときだけ、予定を新規状態に戻す（要件 S4）。
  // 過去の復習履歴は消さず、kind='reset' の行を積んで、再構築ではそれ以降だけを使う。
  if (input.reset_schedule) resetSchedule(id, now)

  return getEntry(id)
}

/** 加筆修正の履歴（新しい順）。 */
export function listRevisions(id: string): RevisionRow[] {
  getEntry(id) // 存在確認
  return getDb()
    .query<RevisionRow, [string]>(
      'SELECT * FROM entry_revisions WHERE entry_id = ? ORDER BY rev_no DESC',
    )
    .all(id)
}

function appendLifecycleLog(entryId: string, kind: 'retire' | 'unretire', nowIso: string): void {
  const db = getDb()
  const schedule = db
    .query<ScheduleRow, [string]>('SELECT * FROM schedule_state WHERE entry_id = ?')
    .get(entryId)
  db.query(
    `INSERT INTO review_logs (id, entry_id, reviewed_at, kind,
       state_before, stability_before, difficulty_before, due_before)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    Bun.randomUUIDv7(),
    entryId,
    nowIso,
    kind,
    schedule?.state ?? null,
    schedule?.stability ?? null,
    schedule?.difficulty ?? null,
    schedule?.due ?? null,
  )
}

/** 卒業（もう復習しない）。日付ビューには残る（要件 R6）。 */
export function retireEntry(id: string, now: Date = clockNow()): Entry {
  const db = getDb()
  getEntry(id)
  const nowIso = toLocalIso(now)
  db.transaction(() => {
    db.query('UPDATE entries SET retired_at = ?, updated_at = ? WHERE id = ?').run(nowIso, nowIso, id)
    appendLifecycleLog(id, 'retire', nowIso)
  })()
  return getEntry(id)
}

/**
 * 記録そのものを削除する（不要な記録の掃除用。「復習を終える」とは別）。
 * まず DB の行を消し（review_logs・schedule_state・entry_revisions は ON DELETE CASCADE で entries と
 * 一緒に消える。transcription_jobs は ON DELETE SET NULL なので明示的に消す）、
 * その後に添付ファイルの実体を消す。行→ファイルの順にするのは、途中でファイル削除が失敗しても
 * DB 上は既に消えている一貫した状態にするため（添付単体の削除がファイル→行の順で、
 * 削除が半端に終わると DB に残った行がもう無いファイルを指す不整合を起こしうると指摘されたのを踏まえる）。
 */
export async function deleteEntry(id: string): Promise<void> {
  const db = getDb()
  const before = db
    .query<EntryRow, [string]>(`SELECT ${ENTRY_COLUMNS} FROM entries WHERE id = ?`)
    .get(id)
  if (!before) throw new NotFoundError(`記録が見つかりません: ${id}`)

  const attachments = db
    .query<AttachmentRow, [string]>('SELECT * FROM attachments WHERE entry_id = ?')
    .all(id)

  db.transaction(() => {
    db.query('DELETE FROM transcription_jobs WHERE entry_id = ?').run(id)
    db.query('DELETE FROM entries WHERE id = ?').run(id)
  })()

  for (const a of attachments) {
    // ファイルが既に無くても失敗にしない（adapters/files.ts の既存の関数に任せる）。
    await deleteAttachmentFile(dataDir(), a.rel_path)
  }
}

/** 卒業の取り消し。 */
export function unretireEntry(id: string, now: Date = clockNow()): Entry {
  const db = getDb()
  getEntry(id)
  const nowIso = toLocalIso(now)
  db.transaction(() => {
    db.query('UPDATE entries SET retired_at = NULL, updated_at = ? WHERE id = ?').run(nowIso, id)
    appendLifecycleLog(id, 'unretire', nowIso)
  })()
  return getEntry(id)
}
