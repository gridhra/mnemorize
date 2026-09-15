// FSRS-6（ts-fsrs 5.4.2）の薄いラッパー。ここ以外から ts-fsrs を直接呼ばない。
//
// このファイルが守る規約（`docs/research/05-spike-fsrs.md` の実地検証で決めたもの。
// 由来のはっきりしない数値は書かない）：
//
// 1. 【復習時刻の正規化】ts-fsrs は前回からの経過日数を「UTC の暦日」で数える。日本時間では
//    UTC の日付の変わり目が 09:00 なので、「昨夜 22:00 に復習 → 今朝 07:00 に復習」が経過 0 日と
//    扱われ、間隔が 9 日から 3 日に縮む（実測）。対策として、ts-fsrs に渡す復習時刻はすべて
//    「その学習日（午前 4 時境界で決めた日付）の 12:00 ローカル」に揃える。12:00 なら UTC に
//    直しても同じ暦日に収まるため、学習日と UTC 暦日が 1 対 1 に対応する。
//    実時刻は review_logs.reviewed_at に、正規化した時刻は review_logs.fsrs_instant に両方残す。
// 2. 【初回期限】新規状態（State.New）では ts-fsrs は card.due を読まない（実装で確認済み）。
//    したがって作成時に due を「作成した学習日の翌日の境界時刻」に自分で書いてよく、
//    初回の計算結果は 1 ビットも変わらない（実測で一致を確認）。
// 3. 【fuzz の乱数】既定の seed 戦略（復習時刻・復習回数・記憶状態から決まる決定的な値）を
//    そのまま使う。`GenSeedStrategyWithCardId`（記録 ID を種にする方式）は使わない。
//    履歴からの再構築時に記録 ID が落ちて、次回期限が数日ずれるため（実測）。
// 4. 【リセット】`forget(card, now, true)` の結果は新規作成した記録と区別がつかない（実測）。
//    そのためリセットは新規状態の作り直しで表し、期限は規約 2 と同じく「翌日」に置く。
//    リセットの行は review_logs に kind='reset' として残すが、再構築では使わない
//    （ts-fsrs の reschedule は手動操作のログを既定で捨てるため、混ぜると扱いが分かりにくい）。
// 5. 【上限 365 日は不変条件ではない】実装が「思い出せなかった < 思い出せた < 余裕だった」の
//    順序を 1 日ずつ押し上げて強制するので、間隔が 366〜367 日になることがある。
//    「期限は必ず 365 日以内」を前提にしたコードを書かない。
// 6. 【状態は 2 つだけ】`enable_short_term: false` なので Learning / Relearning は現れない。
//    保存される state は 'New' と 'Review' のみ。
import {
  Rating,
  State,
  createEmptyCard,
  fsrs,
  type Card,
  type FSRSHistory,
  type Grade,
} from 'ts-fsrs'
import { DEFAULT_BOUNDARY_HOUR, dayStart, initialDue, localDate } from '../adapters/clock.ts'

/** ts-fsrs に渡す時刻の「時」。正午なら日本時間でも UTC 暦日が同じ日に収まる（規約 1）。 */
const FSRS_INSTANT_HOUR = 12

/** review_logs.algo と schedule_state.algo に入れる、計算に使った実装の名前。 */
export const ALGO = 'ts-fsrs@5.4.2 fsrs-6'

/**
 * スケジューラの設定。1 か所に固定する。
 * `fsrs()` は内部で `generatorParameters()` を呼ぶので、部分指定でよい。
 * w（21 個のパラメータ）は既定値のまま。seed 戦略は差し替えない（規約 3）。
 */
export const scheduler = fsrs({
  request_retention: 0.9, // 目標とする想起率（要件 S1）
  maximum_interval: 365, // 間隔の上限（日。要件 S1）
  enable_fuzz: true, // 同じ日に期限が集中しないよう間隔をばらつかせる
  enable_short_term: false, // 当日中の再提示をしない（要件 S1）
})

/** UI の 3 ボタンに対応する評価。ts-fsrs の値をそのまま使う。Hard(2) は使わない（要件 S2）。 */
export type ReviewRating = 1 | 3 | 4
export const RATING_AGAIN: ReviewRating = 1 // 思い出せなかった
export const RATING_GOOD: ReviewRating = 3 // 思い出せた
export const RATING_EASY: ReviewRating = 4 // 余裕だった
export const RATINGS: readonly ReviewRating[] = [RATING_AGAIN, RATING_GOOD, RATING_EASY]

export function isReviewRating(v: unknown): v is ReviewRating {
  return v === RATING_AGAIN || v === RATING_GOOD || v === RATING_EASY
}

/**
 * アプリが保存するスケジュール状態。schedule_state テーブルの 1 行と 1 対 1。
 * stability / difficulty が null なのは「まだ一度も復習していない（New）」の意味。
 */
export type ScheduleState = {
  due: Date
  state: 'New' | 'Review'
  stability: number | null
  difficulty: number | null
  elapsed_days: number
  scheduled_days: number
  reps: number
  lapses: number
  /** ts-fsrs に渡した正規化時刻（実時刻ではない）。 */
  last_review: Date | null
}

/** 復習 1 回分の、review_logs に残す値。*_before はすべて「その復習をする前」の値。 */
export type ReviewLogValues = {
  reviewed_at: Date
  fsrs_instant: Date
  rating: ReviewRating
  state_before: 'New' | 'Review'
  stability_before: number | null
  difficulty_before: number | null
  /** 前回の復習からの経過日数。前回がなければ 0。ts-fsrs の deprecated 列は使わず自前で計算する。 */
  elapsed_days: number
  /** この復習で決まった間隔（日）。 */
  scheduled_days: number
  due_before: Date
}

/** ts-fsrs に渡す正規化時刻＝その学習日の 12:00 ローカル（規約 1）。 */
export function normalizeReviewInstant(
  at: Date,
  boundaryHour: number = DEFAULT_BOUNDARY_HOUR,
): Date {
  return dayStart(localDate(at, boundaryHour), FSRS_INSTANT_HOUR)
}

function toCard(state: ScheduleState): Card {
  return {
    due: state.due,
    stability: state.stability ?? 0,
    difficulty: state.difficulty ?? 0,
    elapsed_days: state.elapsed_days,
    scheduled_days: state.scheduled_days,
    learning_steps: 0, // enable_short_term: false なので常に 0（規約 6）
    reps: state.reps,
    lapses: state.lapses,
    state: state.state === 'New' ? State.New : State.Review,
    ...(state.last_review ? { last_review: state.last_review } : {}),
  }
}

function fromCard(card: Card): ScheduleState {
  const isNew = card.state === State.New
  return {
    due: card.due,
    state: isNew ? 'New' : 'Review',
    stability: isNew ? null : card.stability,
    difficulty: isNew ? null : card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    last_review: card.last_review ?? null,
  }
}

/** 日数の差（切り捨て）。経過日数の記録用で、スケジューラの計算には使わない。 */
function diffDays(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

/**
 * 新規記録の初期状態。state は New、期限は「作成した学習日の翌日の境界時刻」（規約 2、要件 S5）。
 */
export function createInitialState(
  createdAt: Date,
  boundaryHour: number = DEFAULT_BOUNDARY_HOUR,
): ScheduleState {
  const card = createEmptyCard(createdAt)
  card.due = initialDue(createdAt, boundaryHour)
  return fromCard(card)
}

/**
 * 「最初からやり直す」（要件 S4）。`forget(card, now, true)` の結果は新規作成した記録と
 * 完全に一致することを実測で確認してあるので、新規状態を作り直すだけでよい（規約 4）。
 */
export function resetState(
  now: Date,
  boundaryHour: number = DEFAULT_BOUNDARY_HOUR,
): ScheduleState {
  return createInitialState(now, boundaryHour)
}

/**
 * 復習 1 回分を適用する。reviewedAt は実時刻でよい（内部で正規化する）。
 * 戻り値の log は review_logs にそのまま入れるための値。
 */
export function scheduleNext(
  state: ScheduleState,
  rating: ReviewRating,
  reviewedAt: Date,
  boundaryHour: number = DEFAULT_BOUNDARY_HOUR,
): { state: ScheduleState; log: ReviewLogValues } {
  const instant = normalizeReviewInstant(reviewedAt, boundaryHour)
  const { card } = scheduler.next(toCard(state), instant, rating as Grade)
  const next = fromCard(card)
  return {
    state: next,
    log: {
      reviewed_at: reviewedAt,
      fsrs_instant: instant,
      rating,
      state_before: state.state,
      stability_before: state.stability,
      difficulty_before: state.difficulty,
      elapsed_days: state.last_review ? diffDays(state.last_review, instant) : 0,
      scheduled_days: next.scheduled_days,
      due_before: state.due,
    },
  }
}

/** 3 つのボタンそれぞれの「次はいつになるか」。ボタンの下に出す予告表示に使う。 */
export function previewNext(
  state: ScheduleState,
  reviewedAt: Date,
  boundaryHour: number = DEFAULT_BOUNDARY_HOUR,
): Record<ReviewRating, { due: Date; interval_days: number }> {
  const instant = normalizeReviewInstant(reviewedAt, boundaryHour)
  const preview = scheduler.repeat(toCard(state), instant)
  const pick = (r: ReviewRating) => {
    const card = preview[r as Grade].card
    return { due: card.due, interval_days: card.scheduled_days }
  }
  return {
    [RATING_AGAIN]: pick(RATING_AGAIN),
    [RATING_GOOD]: pick(RATING_GOOD),
    [RATING_EASY]: pick(RATING_EASY),
  } as Record<ReviewRating, { due: Date; interval_days: number }>
}

/** 再構築に渡す復習 1 件。必要なのは評価と復習時刻の 2 つだけ（実測で確認済み）。 */
export type RebuildLog = { rating: ReviewRating; reviewed_at: Date; kind?: string }

/**
 * 追記専用の履歴から現在の状態を作り直す（要件 S3）。
 * resetAt を渡すと、その時刻より後の復習だけを使う（規約 4）。
 * kind が 'review' 以外の行（卒業・リセットなど）は無視する。
 */
export function rebuildFromLogs(
  logs: RebuildLog[],
  createdAt: Date,
  resetAt?: Date | null,
  boundaryHour: number = DEFAULT_BOUNDARY_HOUR,
): ScheduleState {
  // リセットしていれば「リセットした時刻」が、していなければ「作成時刻」が出発点になる。
  const origin = resetAt ?? createdAt
  const first = createInitialState(origin, boundaryHour)
  const used = logs
    .filter((l) => (l.kind ?? 'review') === 'review')
    .filter((l) => (resetAt ? l.reviewed_at.getTime() > resetAt.getTime() : true))
    .sort((a, b) => a.reviewed_at.getTime() - b.reviewed_at.getTime())
  if (used.length === 0) return first

  const history: FSRSHistory[] = used.map((l) => ({
    rating: l.rating as Grade,
    review: normalizeReviewInstant(l.reviewed_at, boundaryHour),
  }))
  const { collections } = scheduler.reschedule(toCard(first), history, {
    first_card: toCard(first),
    update_memory_state: true,
  })
  const last = collections[collections.length - 1]
  if (!last) return first
  return fromCard(last.card)
}

/** 今この瞬間に思い出せる確率の推定値（0〜1）。まだ復習していなければ null。 */
export function retrievability(
  state: ScheduleState,
  now: Date,
  boundaryHour: number = DEFAULT_BOUNDARY_HOUR,
): number | null {
  if (state.state === 'New' || !state.last_review) return null
  return scheduler.get_retrievability(
    toCard(state),
    normalizeReviewInstant(now, boundaryHour),
    false,
  )
}

/** ts-fsrs の Rating を使う側に見せるための再輸出（ルートの入力検証などで使う）。 */
export { Rating }
