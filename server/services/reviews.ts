// 復習キューの取り出しと、評価の記録。スケジューラの計算は services/scheduler.ts に閉じてある。
import { getDb } from '../db/connection.ts'
import { dayStart, dueWindow, isDateString, localDate, now as clockNow, toLocalIso } from '../adapters/clock.ts'
import { NotFoundError, ValidationError, getEntry, headlineOf, type Entry } from './entries.ts'
import { boundaryHour, getSettings } from './settings.ts'
import {
  ALGO,
  RATINGS,
  createInitialState,
  previewNext,
  rebuildFromLogs,
  resetState,
  retrievability,
  scheduleNext,
  type ReviewRating,
  type ScheduleState,
} from './scheduler.ts'

export type ReviewLogRow = {
  id: string
  entry_id: string
  reviewed_at: string
  fsrs_instant: string | null
  rating: number | null
  state_before: string | null
  stability_before: number | null
  difficulty_before: number | null
  elapsed_days: number | null
  scheduled_days: number | null
  due_before: string | null
  algo: string | null
  kind: string
  note_md: string | null
}

/** 1 件ぶんの復習の予告：3 つのボタンそれぞれを押したときの次回期限。 */
export type ReviewPreview = {
  again: { due: string; date: string; interval_days: number }
  good: { due: string; date: string; interval_days: number }
  easy: { due: string; date: string; interval_days: number }
}

/** schedule_state を JSON で返すときの形（日時は ISO 8601 の文字列にする）。 */
export type SerializedSchedule = Omit<ScheduleState, 'due' | 'last_review'> & {
  due: string
  last_review: string | null
}

export type ReviewItem = {
  entry: Entry
  schedule: SerializedSchedule
  /** 今この瞬間に思い出せる確率の推定値（0〜1）。まだ一度も復習していなければ null。 */
  retrievability: number | null
  preview: ReviewPreview
}

export type TodayQueue = {
  /** 学習日（YYYY-MM-DD）。午前 4 時境界で決まる。 */
  date: string
  items: ReviewItem[]
  /** 今日の窓の終わりより前に期限が来ている件数（上限で切る前、当日評価済みを除く）。 */
  total_due: number
  /** 1 日の上限で今日は出さなかった件数（＝翌日以降に回る件数）。 */
  carried_over: number
  /** 今日すでに評価した件数。 */
  reviewed_today: number
  /** 1 日の提示上限（設定値）。 */
  daily_limit: number
  /**
   * 今日より後で、次に復習の期限が来る学習日（YYYY-MM-DD）。無ければ null。
   * 対象は復習に出す設定で、まだ復習を終えていない記録だけ。
   */
  next_due_date: string | null
  /** その学習日に期限が来る件数（next_due_date が null なら 0）。 */
  next_due_count: number
}

/** DB の 1 行をスケジューラの状態に直す。 */
function toState(row: {
  due: string
  state: string
  stability: number | null
  difficulty: number | null
  elapsed_days: number | null
  scheduled_days: number | null
  reps: number
  lapses: number
  last_review: string | null
}): ScheduleState {
  return {
    due: new Date(row.due),
    // enable_short_term: false なので New / Review しか現れない（scheduler.ts の規約 6）。
    state: row.state === 'New' ? 'New' : 'Review',
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days ?? 0,
    scheduled_days: row.scheduled_days ?? 0,
    reps: row.reps,
    lapses: row.lapses,
    last_review: row.last_review ? new Date(row.last_review) : null,
  }
}

function serializeState(s: ScheduleState): SerializedSchedule {
  return { ...s, due: toLocalIso(s.due), last_review: s.last_review ? toLocalIso(s.last_review) : null }
}

/** schedule_state を丸ごと書き換える。行が無ければ作る。 */
export function writeScheduleState(entryId: string, s: ScheduleState): void {
  getDb()
    .query(
      `INSERT INTO schedule_state (entry_id, due, state, stability, difficulty,
         elapsed_days, scheduled_days, reps, lapses, last_review, algo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entry_id) DO UPDATE SET
         due = excluded.due, state = excluded.state, stability = excluded.stability,
         difficulty = excluded.difficulty, elapsed_days = excluded.elapsed_days,
         scheduled_days = excluded.scheduled_days, reps = excluded.reps,
         lapses = excluded.lapses, last_review = excluded.last_review, algo = excluded.algo`,
    )
    .run(
      entryId,
      toLocalIso(s.due),
      s.state,
      s.stability,
      s.difficulty,
      s.elapsed_days,
      s.scheduled_days,
      s.reps,
      s.lapses,
      s.last_review ? toLocalIso(s.last_review) : null,
      s.state === 'New' ? null : ALGO,
    )
}

function limitOf(): number {
  const n = getSettings().daily_review_limit
  return Number.isInteger(n) && n > 0 ? n : 10
}

function previewOf(state: ScheduleState, at: Date, hour: number): ReviewPreview {
  const p = previewNext(state, at, hour)
  const one = (r: ReviewRating) => ({
    due: toLocalIso(p[r].due),
    date: localDate(p[r].due, hour),
    interval_days: p[r].interval_days,
  })
  return { again: one(1), good: one(3), easy: one(4) }
}

type QueueRow = {
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
}

/**
 * 今日の復習キュー（設計書 §9）。
 * 対象は `review_enabled=1 かつ retired_at IS NULL かつ 期限 < 今日の窓の終わり`。
 * 並びは期限の古い順（＝期限超過が長い順）。今日すでに評価した記録は出さない。
 */
export function todayQueue(at: Date = clockNow()): TodayQueue {
  const db = getDb()
  const hour = boundaryHour()
  const { start, end, date } = dueWindow(at, hour)
  const startIso = toLocalIso(start)
  const endIso = toLocalIso(end)
  const limit = limitOf()

  // 今日の窓の中で評価済みの記録は、同じ日に二度出さない。
  const reviewedToday = db
    .query<{ entry_id: string }, [string, string]>(
      `SELECT DISTINCT entry_id FROM review_logs
       WHERE kind = 'review' AND reviewed_at >= ? AND reviewed_at < ?`,
    )
    .all(startIso, endIso)
    .map((r) => r.entry_id)
  const reviewedSet = new Set(reviewedToday)

  const rows = db
    .query<QueueRow, [string]>(
      `SELECT s.entry_id, s.due, s.state, s.stability, s.difficulty, s.elapsed_days,
              s.scheduled_days, s.reps, s.lapses, s.last_review
         FROM schedule_state s
         JOIN entries e ON e.id = s.entry_id
        WHERE e.review_enabled = 1 AND e.retired_at IS NULL AND s.due < ?
        ORDER BY s.due ASC, e.created_at ASC`,
    )
    .all(endIso)
    .filter((r) => !reviewedSet.has(r.entry_id))

  const items = rows.slice(0, limit).map((row) => {
    const state = toState(row)
    return {
      entry: getEntry(row.entry_id),
      schedule: serializeState(state),
      retrievability: retrievability(state, at, hour),
      preview: previewOf(state, at, hour),
    }
  })

  // 今日の窓の終わり以降で、いちばん早く期限が来る学習日とその件数。
  // 画面の「次の復習は◯月◯日に N 件」に使う。
  const futureDues = db
    .query<{ due: string }, [string]>(
      `SELECT s.due
         FROM schedule_state s
         JOIN entries e ON e.id = s.entry_id
        WHERE e.review_enabled = 1 AND e.retired_at IS NULL AND s.due >= ?
        ORDER BY s.due ASC`,
    )
    .all(endIso)
  let nextDueDate: string | null = null
  let nextDueCount = 0
  for (const r of futureDues) {
    const d = localDate(new Date(r.due), hour)
    if (nextDueDate === null) nextDueDate = d
    if (d !== nextDueDate) break
    nextDueCount += 1
  }

  return {
    date,
    items,
    total_due: rows.length,
    carried_over: Math.max(0, rows.length - limit),
    reviewed_today: reviewedToday.length,
    daily_limit: limit,
    next_due_date: nextDueDate,
    next_due_count: nextDueCount,
  }
}

export type SubmitResult = {
  entry: Entry
  schedule: SerializedSchedule
  /** 次回期限の学習日（YYYY-MM-DD）。画面で「9月18日（金）」の形に整えて出す。 */
  next_due_date: string
  interval_days: number
  /** 自動卒業（要件 S6）が働いたか。 */
  auto_retired: boolean
}

/**
 * 評価を 1 件記録する（要件 S2・S3）。
 * review_logs への追記と schedule_state の更新を 1 トランザクションで行う。
 */
export function submitReview(
  entryId: string,
  rating: ReviewRating,
  at: Date = clockNow(),
): SubmitResult {
  const db = getDb()
  const hour = boundaryHour()
  if (!RATINGS.includes(rating)) {
    throw new ValidationError('評価は 1（思い出せなかった）3（思い出せた）4（余裕だった）のいずれかです')
  }
  const entry = getEntry(entryId) // 無ければ NotFoundError
  const row = db.query<QueueRow, [string]>('SELECT * FROM schedule_state WHERE entry_id = ?').get(entryId)
  // 予定の行が無い記録（過去の不整合など）は、作成時刻から作り直してから進める。
  const before = row ? toState(row) : createInitialState(new Date(entry.created_at), hour)
  const { state, log } = scheduleNext(before, rating, at, hour)

  // 間隔が上限（365 日）に達したら自動で卒業させる（要件 S6、設定で切れる）。
  // 上限ちょうどにならないことがある（評価順を守るための押し上げ）ので「以上」で見る。
  const autoRetire = getSettings().auto_retire === true && log.scheduled_days >= 365

  db.transaction(() => {
    db.query(
      `INSERT INTO review_logs (id, entry_id, reviewed_at, fsrs_instant, rating,
         state_before, stability_before, difficulty_before, elapsed_days, scheduled_days,
         due_before, algo, kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'review')`,
    ).run(
      Bun.randomUUIDv7(),
      entryId,
      toLocalIso(log.reviewed_at),
      toLocalIso(log.fsrs_instant),
      log.rating,
      log.state_before,
      log.stability_before,
      log.difficulty_before,
      log.elapsed_days,
      log.scheduled_days,
      toLocalIso(log.due_before),
      ALGO,
    )
    writeScheduleState(entryId, state)
    if (autoRetire) {
      const nowIso = toLocalIso(at)
      db.query('UPDATE entries SET retired_at = ?, updated_at = ? WHERE id = ?').run(nowIso, nowIso, entryId)
      db.query(
        `INSERT INTO review_logs (id, entry_id, reviewed_at, kind, state_before,
           stability_before, difficulty_before, due_before, algo)
         VALUES (?, ?, ?, 'retire', ?, ?, ?, ?, ?)`,
      ).run(
        Bun.randomUUIDv7(),
        entryId,
        nowIso,
        state.state,
        state.stability,
        state.difficulty,
        toLocalIso(state.due),
        ALGO,
      )
    }
  })()

  return {
    entry: getEntry(entryId),
    schedule: serializeState(state),
    next_due_date: localDate(state.due, hour),
    interval_days: log.scheduled_days,
    auto_retired: autoRetire,
  }
}

/**
 * 直前の評価を取り消す（押し間違えの救済）。
 * 最後の kind='review' の行を消し、残った履歴から状態を作り直す（要件 S3 の再計算）。
 */
export function undoLastReview(entryId: string): SubmitResult {
  const db = getDb()
  const hour = boundaryHour()
  const entry = getEntry(entryId)
  const last = db
    .query<ReviewLogRow, [string]>(
      `SELECT * FROM review_logs WHERE entry_id = ? AND kind = 'review'
        ORDER BY reviewed_at DESC, id DESC LIMIT 1`,
    )
    .get(entryId)
  if (!last) throw new NotFoundError('取り消せる評価がありません')

  // 取り消す評価と同時に積まれた自動卒業（kind='retire'）も一緒に戻す。
  // 卒業ログは submitReview の中で同じ時刻に積まれるので、消す評価以降の行を対象にする。
  const retireLogs = db
    .query<{ id: string }, [string, string]>(
      `SELECT id FROM review_logs WHERE entry_id = ? AND kind = 'retire' AND reviewed_at >= ?`,
    )
    .all(entryId, last.reviewed_at)

  let state: ScheduleState = createInitialState(new Date(entry.created_at), hour)
  db.transaction(() => {
    db.query('DELETE FROM review_logs WHERE id = ?').run(last.id)
    for (const r of retireLogs) db.query('DELETE FROM review_logs WHERE id = ?').run(r.id)
    if (retireLogs.length > 0) {
      db.query('UPDATE entries SET retired_at = NULL, updated_at = ? WHERE id = ?').run(
        toLocalIso(clockNow()),
        entryId,
      )
    }
    state = rebuildState(entryId, hour)
    writeScheduleState(entryId, state)
  })()

  return {
    entry: getEntry(entryId),
    schedule: serializeState(state),
    next_due_date: localDate(state.due, hour),
    interval_days: state.scheduled_days,
    auto_retired: false,
  }
}

/** 追記専用の履歴から状態を作り直す（リセット時刻より後の復習だけを使う）。 */
export function rebuildState(entryId: string, hour: number = boundaryHour()): ScheduleState {
  const entry = getEntry(entryId)
  const logs = getDb()
    .query<ReviewLogRow, [string]>(
      "SELECT * FROM review_logs WHERE entry_id = ? AND kind = 'review' ORDER BY reviewed_at ASC",
    )
    .all(entryId)
    .filter((l) => l.rating === 1 || l.rating === 3 || l.rating === 4)
    .map((l) => ({
      rating: l.rating as ReviewRating,
      reviewed_at: new Date(l.reviewed_at),
      kind: 'review',
    }))
  return rebuildFromLogs(
    logs,
    new Date(entry.created_at),
    entry.schedule_reset_at ? new Date(entry.schedule_reset_at) : null,
    hour,
  )
}

/**
 * 予定を最初からやり直す（要件 S4。編集画面の「内容を作り直したので最初から」）。
 * entries.schedule_reset_at を更新し、review_logs に kind='reset' を 1 行残し、
 * schedule_state を新規状態＋翌日期限に戻す。過去の行は消さない。
 * entries.ts の updateEntry から呼ばれる。
 */
export function resetSchedule(entryId: string, at: Date): void {
  const db = getDb()
  const hour = boundaryHour()
  const atIso = toLocalIso(at)
  const before = db.query<QueueRow, [string]>('SELECT * FROM schedule_state WHERE entry_id = ?').get(entryId)
  const next = resetState(at, hour)
  db.transaction(() => {
    db.query('UPDATE entries SET schedule_reset_at = ?, updated_at = ? WHERE id = ?').run(atIso, atIso, entryId)
    db.query(
      `INSERT INTO review_logs (id, entry_id, reviewed_at, kind, state_before,
         stability_before, difficulty_before, due_before, algo)
       VALUES (?, ?, ?, 'reset', ?, ?, ?, ?, ?)`,
    ).run(
      Bun.randomUUIDv7(),
      entryId,
      atIso,
      before?.state ?? null,
      before?.stability ?? null,
      before?.difficulty ?? null,
      before?.due ?? null,
      ALGO,
    )
    writeScheduleState(entryId, next)
  })()
}

/** 記録 1 件の復習履歴（新しい順）。画面には出していないが、確認と将来の表示のために置く。 */
export function listReviewLogs(entryId: string): ReviewLogRow[] {
  getEntry(entryId)
  return getDb()
    .query<ReviewLogRow, [string]>(
      'SELECT * FROM review_logs WHERE entry_id = ? ORDER BY reviewed_at DESC, id DESC',
    )
    .all(entryId)
}

/** 「これからの復習」の 1 日分：その学習日に期限が来る記録の件数と見出し。 */
export type UpcomingDay = {
  /** 学習日（YYYY-MM-DD）。 */
  date: string
  count: number
  entries: { id: string; headline: string }[]
}

/**
 * from..to（どちらも学習日 YYYY-MM-DD、両端を含む）に期限が来る記録を日ごとにまとめる。
 * 対象は復習に出す設定で、まだ復習を終えていない記録だけ。
 * 期限がどの学習日に属するかは境界時刻（既定は午前 4 時）で決める。
 * 1 件も無い日は返さない（画面で 0 件の日を出さないため）。
 */
export function upcoming(from: string, to: string): UpcomingDay[] {
  if (!isDateString(from) || !isDateString(to)) {
    throw new ValidationError('from と to は YYYY-MM-DD の形で指定してください')
  }
  const hour = boundaryHour()
  const start = dayStart(from, hour)
  const end = dayStart(to, hour)
  end.setDate(end.getDate() + 1) // to の学習日の終わり（＝翌日の境界時刻）まで含める
  if (end.getTime() <= start.getTime()) return []

  const rows = getDb()
    .query<{ id: string; title: string | null; body_md: string; due: string }, [string, string]>(
      `SELECT e.id, e.title, e.body_md, s.due
         FROM schedule_state s
         JOIN entries e ON e.id = s.entry_id
        WHERE e.review_enabled = 1 AND e.retired_at IS NULL AND s.due >= ? AND s.due < ?
        ORDER BY s.due ASC, e.created_at ASC`,
    )
    .all(toLocalIso(start), toLocalIso(end))

  const byDate = new Map<string, UpcomingDay>()
  for (const r of rows) {
    const date = localDate(new Date(r.due), hour)
    let day = byDate.get(date)
    if (!day) {
      day = { date, count: 0, entries: [] }
      byDate.set(date, day)
    }
    day.count += 1
    day.entries.push({ id: r.id, headline: headlineOf(r.title, r.body_md) })
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}
