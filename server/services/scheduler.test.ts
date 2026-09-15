// scheduler.ts のテスト。期待値は `docs/research/05-spike-fsrs.md` の実測表 (a)(c)(d) に対応する。
//
// 間隔の実数値がノートの表と一致しない点についての断り書き：
// ノートの検証は「毎回 09:00 に復習した時刻を、正規化せずそのまま ts-fsrs に渡す」条件で測った。
// 本番のラッパーは規約どおり時刻を「学習日の 12:00」に正規化してから渡す。fuzz（間隔の
// ばらつき）の乱数の種は復習時刻のミリ秒から作られるので、09:00 と 12:00ではばらつき方が変わる。
// その結果、間隔の列は 3・14・55 日（ノート）ではなく 3・16・68 日（このラッパー）になる。
// ずれているのは fuzz のぶんだけで、stability（安定度）と difficulty（難しさ）は
// ノートの実測値と小数 3 桁まで一致する。そこでこのテストでは、
// 「fuzz の影響を受けない値（stability・difficulty・失敗回数）」は実測値そのもので、
// 「間隔」は表が示している性質（伸び方・縮み方・遅延で伸びること）で確かめる。
import { describe, expect, test } from 'bun:test'
import {
  RATING_AGAIN,
  RATING_EASY,
  RATING_GOOD,
  createInitialState,
  normalizeReviewInstant,
  previewNext,
  rebuildFromLogs,
  resetState,
  retrievability,
  scheduleNext,
  type ReviewRating,
  type ScheduleState,
} from './scheduler.ts'

/** Day 0 を 2026-01-01 とした「Day n の 09:00」。検証ノートと同じ条件。 */
function day(n: number, hour = 9): Date {
  return new Date(2026, 0, 1 + n, hour, 0, 0, 0)
}

/** 作成日（Day 0）からの経過日数。期限を「Day いくつか」に読み替える。 */
function dayOf(d: Date): number {
  const base = new Date(2026, 0, 1, 0, 0, 0, 0)
  return Math.round((d.getTime() - base.getTime()) / 86_400_000)
}

/** 期限ちょうどに復習していく。戻り値は各回の間隔（日）。 */
function runAtDue(
  ratings: ReviewRating[],
  firstReviewDay = 1,
): { intervals: number[]; states: ScheduleState[]; days: number[] } {
  let state = createInitialState(day(0, 14))
  const intervals: number[] = []
  const states: ScheduleState[] = []
  const days: number[] = []
  let at = firstReviewDay
  for (const rating of ratings) {
    days.push(at)
    const res = scheduleNext(state, rating, day(at))
    state = res.state
    intervals.push(res.log.scheduled_days)
    states.push(state)
    at = dayOf(state.due)
  }
  return { intervals, states, days }
}

describe('初期状態', () => {
  test('新規記録は State.New・期限は作成した学習日の翌日 4:00', () => {
    const s = createInitialState(new Date('2026-09-15T14:00:00'))
    expect(s.state).toBe('New')
    expect(s.reps).toBe(0)
    expect(s.lapses).toBe(0)
    expect(s.stability).toBeNull()
    expect(s.difficulty).toBeNull()
    expect(s.last_review).toBeNull()
    expect(s.due.getFullYear()).toBe(2026)
    expect(s.due.getMonth()).toBe(8)
    expect(s.due.getDate()).toBe(16)
    expect(s.due.getHours()).toBe(4)
  })

  test('深夜 2 時の作成は前日の学習日なので期限は当日 4:00', () => {
    // 9/16 02:00 は学習日 9/15。その翌日の境界時刻は 9/16 04:00。
    const s = createInitialState(new Date('2026-09-16T02:00:00'))
    expect(s.due.getDate()).toBe(16)
    expect(s.due.getHours()).toBe(4)
  })
})

describe('復習時刻の正規化', () => {
  test('学習日の 12:00 に揃う。深夜 1 時は前日の 12:00 になる', () => {
    expect(normalizeReviewInstant(new Date('2026-01-01T22:00:00')).getHours()).toBe(12)
    expect(normalizeReviewInstant(new Date('2026-01-01T22:00:00')).getDate()).toBe(1)
    expect(normalizeReviewInstant(new Date('2026-01-02T07:00:00')).getDate()).toBe(2)
    const lateNight = normalizeReviewInstant(new Date('2026-01-03T01:00:00'))
    expect(lateNight.getDate()).toBe(2) // 午前 4 時境界により学習日は 1/2
    expect(lateNight.getHours()).toBe(12)
  })

  test('22:00 → 翌 07:00 が経過 1 日として扱われる（正規化しないと 0 日になる）', () => {
    // 検証ノート 1.8 の表：正規化しないと UTC 暦日が同じ日になり、間隔が 9 日から 3 日に縮む。
    let state = createInitialState(new Date(2026, 0, 1, 10, 0, 0))
    const first = scheduleNext(state, RATING_GOOD, new Date(2026, 0, 1, 22, 0, 0))
    state = first.state
    const second = scheduleNext(state, RATING_GOOD, new Date(2026, 0, 2, 7, 0, 0))
    expect(second.log.elapsed_days).toBe(1)
    // 経過 0 日なら初回と同じ 3 日に戻ってしまう。1 日ぶん進んでいれば必ずそれより長い。
    expect(second.log.scheduled_days).toBeGreaterThan(first.log.scheduled_days)
  })
})

describe('検証ノートの表 (a)：「思い出せた」を押し続ける', () => {
  test('初回は 3 日。以後は数倍ずつ伸び、5 回目までに上限 365 日の付近に達する', () => {
    const { intervals, states } = runAtDue(Array(6).fill(RATING_GOOD))
    expect(intervals[0]).toBe(3) // 2.5 日未満には fuzz がかからないので実数値で確かめられる
    // 1〜4 回目は前回の 3 倍以上に伸びる。
    for (let i = 1; i < 4; i += 1) expect(intervals[i]!).toBeGreaterThan(intervals[i - 1]! * 3)
    // 5 回目以降は上限 365 日の付近に貼り付く（fuzz と、評価の順序を守るための 1 日ずつの
    // 押し上げにより 340〜370 日にばらつく。365 日は不変条件ではない＝規約 5）。
    for (const iv of intervals.slice(4)) {
      expect(iv).toBeGreaterThan(340)
      expect(iv).toBeLessThan(370)
    }
    // 記憶状態はノートの実測値と一致する（fuzz の影響を受けない）。
    expect(states[0]!.stability).toBeCloseTo(2.3065, 3)
    expect(states[0]!.difficulty).toBeCloseTo(2.1181, 3)
    // difficulty は「思い出せた」では 1 回あたり 0.01 程度しか下がらない。
    expect(states.map((s) => Number(s.difficulty!.toFixed(3))).slice(0, 4)).toEqual([
      2.118, 2.111, 2.104, 2.097,
    ])
  })

  test('「余裕だった」は difficulty を下限 1 に落とし、3 回で上限間隔に達する', () => {
    const { intervals, states } = runAtDue([RATING_EASY, RATING_EASY, RATING_EASY])
    expect(states[0]!.difficulty).toBe(1)
    expect(states[0]!.stability).toBeCloseTo(8.2956, 3)
    expect(intervals[2]).toBeGreaterThan(340)
  })
})

describe('検証ノートの表 (c)：失敗のあとは間隔が縮み、3 回で戻る', () => {
  test('間隔が 10 分の 1 以下に縮み、difficulty が 7.39 に上がり lapses が 1 になる', () => {
    const { intervals, states } = runAtDue([
      RATING_GOOD,
      RATING_GOOD,
      RATING_GOOD,
      RATING_AGAIN,
      RATING_GOOD,
      RATING_GOOD,
      RATING_GOOD,
    ])
    const beforeLapse = states[2]!
    const afterLapse = states[3]!
    expect(afterLapse.lapses).toBe(1)
    // 失敗で安定度も間隔も一桁落ちる（ノートでは 55 日 → 3 日、安定度 56.96 → 3.18）。
    expect(intervals[3]!).toBeLessThan(intervals[2]! / 10)
    expect(afterLapse.stability!).toBeLessThan(beforeLapse.stability! / 10)
    // difficulty はノートの実測値と一致する（2.104 → 7.390）。
    expect(beforeLapse.difficulty).toBeCloseTo(2.104, 3)
    expect(afterLapse.difficulty).toBeCloseTo(7.39, 3)
    // 復帰は速く、3 回の「思い出せた」で失敗前の間隔の 7 割くらいまで戻る。
    expect(intervals[6]!).toBeGreaterThan(intervals[2]! * 0.7)
    // ただし difficulty は 7.35 付近に残り続ける（「余裕だった」を押さない限りほぼ戻らない）。
    expect(states[6]!.difficulty!).toBeGreaterThan(7.3)
  })
})

describe('検証ノートの表 (d)：遅れて押すと次回間隔は長くなる', () => {
  test('同じ「思い出せた」でも、7 日遅れて押したほうが次回間隔も安定度も大きくなる', () => {
    // 3 回目まで期限どおりに「思い出せた」を押した状態を作る。
    let state = createInitialState(day(0, 14))
    let at = 1
    for (let i = 0; i < 3; i += 1) {
      state = scheduleNext(state, RATING_GOOD, day(at)).state
      at = dayOf(state.due)
    }
    const onTime = scheduleNext(state, RATING_GOOD, day(at))
    const delayed = scheduleNext(state, RATING_GOOD, day(at + 7))
    // 遅れは罰ではなく報酬になる（低い想起可能性でも思い出せた、という情報が安定度を押し上げる）。
    expect(delayed.log.scheduled_days).toBeGreaterThan(onTime.log.scheduled_days)
    expect(delayed.state.stability!).toBeGreaterThan(onTime.state.stability!)
    // 遅延に対するペナルティをアプリ側で実装する必要はない（ノートの結論）。
    expect(retrievability(state, day(at + 7))!).toBeLessThan(retrievability(state, day(at))!)
  })
})

describe('3 ボタンの予告', () => {
  test('初回提示では 思い出せなかった 1 日 < 思い出せた 3 日 < 余裕だった（6 日以上）', () => {
    const s = createInitialState(day(0, 14))
    const p = previewNext(s, day(1))
    expect(p[RATING_AGAIN].interval_days).toBe(1)
    expect(p[RATING_GOOD].interval_days).toBe(3)
    // 「余裕だった」の初回は stability 約 8.3 日に fuzz（間隔のばらつき）がかかり、6〜11 日の範囲に散る。
    // 司令塔の結合確認（2026-09-15）で 6 日が観測されたため、「7 日より大きい」ではなく
    // 「思い出せた より長い」「6 日以上」という fuzz に依存しない性質で確かめる。
    expect(p[RATING_EASY].interval_days).toBeGreaterThan(p[RATING_GOOD].interval_days)
    expect(p[RATING_EASY].interval_days).toBeGreaterThanOrEqual(6)
    // 予告した「思い出せた」の期限は、実際に押したときの期限と一致する。
    const applied = scheduleNext(s, RATING_GOOD, day(1))
    expect(applied.state.due.getTime()).toBe(p[RATING_GOOD].due.getTime())
  })
})

describe('履歴からの再構築', () => {
  test('逐次計算と完全に一致する', () => {
    const createdAt = day(0, 14)
    const ratings: ReviewRating[] = [
      RATING_GOOD,
      RATING_GOOD,
      RATING_GOOD,
      RATING_AGAIN,
      RATING_GOOD,
      RATING_GOOD,
      RATING_EASY,
      RATING_GOOD,
    ]
    let state = createInitialState(createdAt)
    const logs: { rating: ReviewRating; reviewed_at: Date; kind: string }[] = []
    let at = 1
    for (const rating of ratings) {
      const reviewedAt = day(at)
      logs.push({ rating, reviewed_at: reviewedAt, kind: 'review' })
      state = scheduleNext(state, rating, reviewedAt).state
      at = dayOf(state.due)
    }
    const rebuilt = rebuildFromLogs(logs, createdAt)
    expect(rebuilt.due.getTime()).toBe(state.due.getTime())
    expect(rebuilt.stability).toBeCloseTo(state.stability!, 6)
    expect(rebuilt.difficulty).toBeCloseTo(state.difficulty!, 6)
    expect(rebuilt.reps).toBe(state.reps)
    expect(rebuilt.lapses).toBe(state.lapses)
    expect(rebuilt.state).toBe(state.state)
  })

  test('review 以外の行は無視し、リセット時刻より後の行だけを使う', () => {
    const createdAt = day(0, 14)
    const resetAt = day(20)
    const logs = [
      { rating: RATING_GOOD, reviewed_at: day(1), kind: 'review' }, // リセット前：無視
      { rating: RATING_GOOD, reviewed_at: day(5), kind: 'review' }, // リセット前：無視
      { rating: RATING_GOOD, reviewed_at: day(20), kind: 'reset' }, // 復習ではない：無視
      { rating: RATING_GOOD, reviewed_at: day(21), kind: 'review' },
    ]
    const rebuilt = rebuildFromLogs(logs, createdAt, resetAt)
    // リセット直後の状態から「思い出せた」1 回ぶんだけ進んだ結果と一致する。
    const expected = scheduleNext(resetState(resetAt), RATING_GOOD, day(21)).state
    expect(rebuilt.due.getTime()).toBe(expected.due.getTime())
    expect(rebuilt.reps).toBe(1)
  })

  test('復習が 1 件もなければ初期状態になる', () => {
    const createdAt = day(0, 14)
    const rebuilt = rebuildFromLogs([], createdAt)
    expect(rebuilt).toEqual(createInitialState(createdAt))
  })
})

describe('リセット', () => {
  test('リセット後の状態は、その時刻に新規作成した記録と同一', () => {
    let state = createInitialState(day(0, 14))
    for (const at of [1, 4, 18]) state = scheduleNext(state, RATING_GOOD, day(at)).state
    expect(state.reps).toBe(3)
    const reset = resetState(day(30))
    expect(reset).toEqual(createInitialState(day(30)))
    expect(reset.state).toBe('New')
    expect(reset.reps).toBe(0)
    expect(reset.lapses).toBe(0)
  })

  test('リセット後に「思い出せた」を押すと新規記録の初回と同じ 3 日になる', () => {
    const after = scheduleNext(resetState(day(30)), RATING_GOOD, day(31))
    expect(after.log.scheduled_days).toBe(3)
    expect(after.state.stability).toBeCloseTo(2.3065, 3)
  })
})

describe('想起可能性', () => {
  test('新規のうちは null、復習後は期限ちょうどで 0.9 前後', () => {
    const s = createInitialState(day(0, 14))
    expect(retrievability(s, day(1))).toBeNull()
    const after = scheduleNext(s, RATING_GOOD, day(1)).state
    const r = retrievability(after, after.due)!
    expect(r).toBeGreaterThan(0.85)
    expect(r).toBeLessThanOrEqual(1)
  })
})

describe('ログに残す値', () => {
  test('*_before は復習する前の値、scheduled_days はこの復習で決まった間隔', () => {
    const s = createInitialState(day(0, 14))
    const first = scheduleNext(s, RATING_GOOD, day(1, 21))
    expect(first.log.state_before).toBe('New')
    expect(first.log.stability_before).toBeNull()
    expect(first.log.due_before.getTime()).toBe(s.due.getTime())
    expect(first.log.reviewed_at.getHours()).toBe(21) // 実時刻はそのまま
    expect(first.log.fsrs_instant.getHours()).toBe(12) // 渡した時刻は正規化済み
    expect(first.log.scheduled_days).toBe(3)
    expect(first.log.elapsed_days).toBe(0)

    const second = scheduleNext(first.state, RATING_GOOD, day(4))
    expect(second.log.state_before).toBe('Review')
    expect(second.log.stability_before).toBeCloseTo(2.3065, 3)
    expect(second.log.elapsed_days).toBe(3)
  })
})
