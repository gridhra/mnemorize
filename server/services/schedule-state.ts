// schedule_state テーブルの 1 行と、スケジューラ（services/scheduler.ts）が扱う状態との変換。
//
// services/entries.ts と services/reviews.ts の両方が要る変換で、この 2 つは互いを
// import している（循環）。どちらか一方に置くと循環の中でしか使えないので、
// 依存を持たないこのファイルに切り出して両方から import する。
import type { ScheduleState } from './scheduler.ts'

/** 変換に必要な列だけ。実際の行（entry_id や algo を持つ）はこれを満たす。 */
export type ScheduleStateRow = {
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

/** DB の 1 行をスケジューラの状態に直す。 */
export function toState(row: ScheduleStateRow): ScheduleState {
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
