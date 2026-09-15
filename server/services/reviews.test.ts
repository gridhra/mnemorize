// 復習キューと評価の記録のテスト。DB を使うので一時ディレクトリに独立した DB を作る。
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = mkdtempSync(join(tmpdir(), 'mnemorize-reviews-test-'))
process.env.MNEMORIZE_DATA_DIR = tmp

const { getDb, resetDbCache } = await import('../db/connection.ts')
const { createEntry, getEntry, retireEntry, updateEntry } = await import('./entries.ts')
const { putSettings } = await import('./settings.ts')
const { listReviewLogs, submitReview, todayQueue, upcoming, undoLastReview } = await import('./reviews.ts')

/** 2026-09-15 を基準にした「n 日後の hour 時」。 */
function day(n: number, hour = 9): Date {
  return new Date(2026, 8, 15 + n, hour, 0, 0, 0)
}

beforeEach(() => {
  const db = getDb()
  for (const t of ['review_logs', 'entry_revisions', 'attachments', 'schedule_state', 'entries']) {
    db.exec(`DELETE FROM ${t}`)
  }
  db.exec('DELETE FROM entry_fts')
  db.exec('DELETE FROM settings')
})

afterAll(() => {
  resetDbCache()
  rmSync(tmp, { recursive: true, force: true })
})

describe('今日の復習キュー', () => {
  test('作った当日には出ず、翌日に出る（初回期限は作成翌日）', () => {
    createEntry({ body_md: 'FSRS の論文を読んだ' }, day(0, 14))
    expect(todayQueue(day(0, 20)).total_due).toBe(0)
    const q = todayQueue(day(1, 9))
    expect(q.date).toBe('2026-09-16')
    expect(q.total_due).toBe(1)
    expect(q.items[0]?.entry.body_md).toBe('FSRS の論文を読んだ')
    expect(q.items[0]?.schedule.state).toBe('New')
  })

  test('深夜 2 時は前日の学習日として扱われる（午前 4 時境界）', () => {
    createEntry({ body_md: '夜の記録' }, day(0, 14))
    // 9/16 02:00 はまだ学習日 9/15。窓の終わりは 9/16 04:00 なので、9/16 04:00 期限は入らない。
    expect(todayQueue(new Date(2026, 8, 16, 2, 0, 0)).total_due).toBe(0)
    expect(todayQueue(new Date(2026, 8, 16, 5, 0, 0)).total_due).toBe(1)
  })

  test('期限の古い順（＝超過が長い順）に並ぶ', () => {
    createEntry({ body_md: '古い方' }, day(0, 10))
    createEntry({ body_md: '新しい方' }, day(2, 10))
    const q = todayQueue(day(5))
    expect(q.items.map((i) => i.entry.body_md)).toEqual(['古い方', '新しい方'])
  })

  test('復習対象外・卒業済みは出ない', () => {
    createEntry({ body_md: '対象外', review_enabled: false }, day(0, 10))
    const retired = createEntry({ body_md: '卒業済み' }, day(0, 10))
    retireEntry(retired.id, day(0, 12))
    createEntry({ body_md: '現役' }, day(0, 10))
    const q = todayQueue(day(1))
    expect(q.total_due).toBe(1)
    expect(q.items[0]?.entry.body_md).toBe('現役')
  })

  test('1 日の上限で切り、残りは繰り越し件数として返す', () => {
    putSettings({ daily_review_limit: 2 })
    for (let i = 0; i < 5; i += 1) createEntry({ body_md: `記録 ${i}` }, day(0, 10))
    const q = todayQueue(day(1))
    expect(q.daily_limit).toBe(2)
    expect(q.items).toHaveLength(2)
    expect(q.total_due).toBe(5)
    expect(q.carried_over).toBe(3)
  })

  test('同じ学習日に評価した記録は、期限が来ていても再度出さない', () => {
    const a = createEntry({ body_md: 'あ' }, day(0, 10))
    createEntry({ body_md: 'い' }, day(0, 10))
    submitReview(a.id, 1, day(1, 9)) // 「思い出せなかった」＝翌日にまた期限が来る
    const q = todayQueue(day(1, 22))
    expect(q.total_due).toBe(1)
    expect(q.reviewed_today).toBe(1)
    expect(q.items[0]?.entry.body_md).toBe('い')
    // 翌日になればまた出る。
    expect(todayQueue(day(2, 9)).total_due).toBe(2)
  })

  test('次に期限が来る学習日とその件数を返す（今日の分は含めない）', () => {
    // 9/15 に 2 件、9/17 に 1 件作る。初回期限はそれぞれ作成翌日（9/16 と 9/18）。
    createEntry({ body_md: 'あ' }, day(0, 10))
    createEntry({ body_md: 'い' }, day(0, 10))
    createEntry({ body_md: 'う' }, day(2, 10))
    // 9/15 の時点：今日の期限は 0 件で、次は 9/16 に 2 件。
    const q0 = todayQueue(day(0, 20))
    expect(q0.total_due).toBe(0)
    expect(q0.next_due_date).toBe('2026-09-16')
    expect(q0.next_due_count).toBe(2)
    // 9/16 の時点：今日の 2 件は含めず、次は 9/18 の 1 件。
    const q1 = todayQueue(day(1, 9))
    expect(q1.total_due).toBe(2)
    expect(q1.next_due_date).toBe('2026-09-18')
    expect(q1.next_due_count).toBe(1)
  })

  test('復習を終えた記録は「次の復習」に数えない', () => {
    const a = createEntry({ body_md: 'あ' }, day(0, 10))
    const q0 = todayQueue(day(0, 20))
    expect(q0.next_due_count).toBe(1)
    retireEntry(a.id, day(0, 12))
    const q1 = todayQueue(day(0, 20))
    expect(q1.next_due_date).toBeNull()
    expect(q1.next_due_count).toBe(0)
  })

  test('3 つのボタンそれぞれの次回期限を予告する', () => {
    createEntry({ body_md: 'あ' }, day(0, 10))
    const item = todayQueue(day(1)).items[0]!
    expect(item.preview.again.date < item.preview.good.date).toBe(true)
    expect(item.preview.good.date < item.preview.easy.date).toBe(true)
    expect(item.preview.good.interval_days).toBe(3)
    expect(item.retrievability).toBeNull() // まだ一度も復習していない
  })
})

describe('評価の記録', () => {
  test('review_logs に 1 行積まれ、schedule_state が更新される', () => {
    const e = createEntry({ body_md: 'あ' }, day(0, 10))
    const res = submitReview(e.id, 3, day(1, 21))
    expect(res.interval_days).toBe(3)
    expect(res.next_due_date).toBe('2026-09-19')
    expect(res.schedule.state).toBe('Review')
    expect(res.schedule.reps).toBe(1)

    const logs = listReviewLogs(e.id)
    expect(logs).toHaveLength(1)
    const log = logs[0]!
    expect(log.kind).toBe('review')
    expect(log.rating).toBe(3)
    expect(log.algo).toBe('ts-fsrs@5.4.2 fsrs-6')
    expect(log.state_before).toBe('New')
    expect(log.reviewed_at.slice(0, 13)).toBe('2026-09-16T21') // 実時刻
    expect(log.fsrs_instant?.slice(0, 13)).toBe('2026-09-16T12') // 正規化した時刻
    expect(log.scheduled_days).toBe(3)

    const stored = getEntry(e.id).schedule!
    expect(stored.due).toBe(res.schedule.due)
    expect(stored.reps).toBe(1)
    expect(stored.stability).toBeCloseTo(2.3065, 3)
  })

  test('「思い出せなかった」は翌日に回る（当日中の再提示はしない）', () => {
    const e = createEntry({ body_md: 'あ' }, day(0, 10))
    const res = submitReview(e.id, 1, day(1, 9))
    expect(res.interval_days).toBe(1)
    expect(res.next_due_date).toBe('2026-09-17')
    expect(res.schedule.lapses).toBe(0) // 新規状態からの失敗は lapse に数えない
  })

  test('不正な評価値は ValidationError', async () => {
    const { ValidationError } = await import('./entries.ts')
    const e = createEntry({ body_md: 'あ' }, day(0, 10))
    // 2（Hard）は使わない（要件 S2）。
    expect(() => submitReview(e.id, 2 as 1, day(1))).toThrow(ValidationError)
  })

  test('存在しない記録への評価は NotFoundError', async () => {
    const { NotFoundError } = await import('./entries.ts')
    expect(() => submitReview('no-such-id', 3, day(1))).toThrow(NotFoundError)
  })

  test('最大間隔に達すると自動で卒業する（設定でオフにできる）', () => {
    const e = createEntry({ body_md: 'あ' }, day(0, 10))
    // 「余裕だった」を押し続けると 3 回で上限間隔に達する。
    let at = 1
    let res = submitReview(e.id, 4, day(at))
    for (let i = 0; i < 4 && !res.auto_retired; i += 1) {
      at += res.interval_days
      res = submitReview(e.id, 4, day(at))
    }
    expect(res.auto_retired).toBe(true)
    expect(getEntry(e.id).retired_at).not.toBeNull()
    expect(listReviewLogs(e.id).some((l) => l.kind === 'retire')).toBe(true)
  })
})

describe('取り消し', () => {
  test('直前の評価を消して、履歴から作り直した状態に戻る', () => {
    const e = createEntry({ body_md: 'あ' }, day(0, 10))
    const first = submitReview(e.id, 3, day(1))
    const second = submitReview(e.id, 3, day(4))
    expect(second.schedule.reps).toBe(2)

    const undone = undoLastReview(e.id)
    expect(undone.schedule.reps).toBe(1)
    expect(undone.schedule.due).toBe(first.schedule.due)
    expect(listReviewLogs(e.id).filter((l) => l.kind === 'review')).toHaveLength(1)
  })

  test('自動卒業の直後に取り消すと、卒業も一緒に取り消される', () => {
    const e = createEntry({ body_md: 'あ' }, day(0, 10))
    // 「余裕だった」を押し続けて最大間隔に達させる（自動卒業が働く）。
    let at = 1
    let res = submitReview(e.id, 4, day(at))
    for (let i = 0; i < 4 && !res.auto_retired; i += 1) {
      at += res.interval_days
      res = submitReview(e.id, 4, day(at))
    }
    expect(res.auto_retired).toBe(true)
    expect(getEntry(e.id).retired_at).not.toBeNull()

    const undone = undoLastReview(e.id)
    // 卒業が戻り、卒業ログも消えている（残ると記録が復習に二度と出てこない）。
    expect(undone.entry.retired_at).toBeNull()
    expect(getEntry(e.id).retired_at).toBeNull()
    expect(listReviewLogs(e.id).some((l) => l.kind === 'retire')).toBe(false)
  })

  test('自動卒業していない評価の取り消しでは、手で付けた卒業は残る', () => {
    const e = createEntry({ body_md: 'あ' }, day(0, 10))
    submitReview(e.id, 3, day(1))
    // 評価のあとに手で卒業させた場合、その卒業は取り消しの対象ではない。
    retireEntry(e.id, day(2))
    const before = listReviewLogs(e.id).filter((l) => l.kind === 'retire').length
    expect(before).toBe(1)
    submitReview(e.id, 3, day(3))
    undoLastReview(e.id)
    expect(getEntry(e.id).retired_at).not.toBeNull()
    expect(listReviewLogs(e.id).filter((l) => l.kind === 'retire')).toHaveLength(1)
  })

  test('評価が 1 件も無ければ NotFoundError', async () => {
    const { NotFoundError } = await import('./entries.ts')
    const e = createEntry({ body_md: 'あ' }, day(0, 10))
    expect(() => undoLastReview(e.id)).toThrow(NotFoundError)
  })
})

describe('予定のリセット（要件 S4）', () => {
  test('ふつうの加筆修正では予定も履歴も変わらない', () => {
    const e = createEntry({ body_md: 'あ' }, day(0, 10))
    const after = submitReview(e.id, 3, day(1))
    const edited = updateEntry(e.id, { body_md: 'あ（補足を足した）' }, day(1, 22))
    expect(edited.schedule?.due).toBe(after.schedule.due)
    expect(edited.schedule?.reps).toBe(1)
    expect(edited.schedule_reset_at).toBeNull()
  })

  test('reset_schedule=true で新規状態＋翌日期限に戻り、kind=reset が残る', () => {
    const e = createEntry({ body_md: 'あ' }, day(0, 10))
    submitReview(e.id, 3, day(1))
    submitReview(e.id, 3, day(4))
    const reset = updateEntry(e.id, { body_md: '書き直した', reset_schedule: true }, day(5, 10))
    expect(reset.schedule_reset_at).not.toBeNull()
    expect(reset.schedule?.state).toBe('New')
    expect(reset.schedule?.reps).toBe(0)
    expect(reset.schedule?.lapses).toBe(0)
    expect(reset.schedule?.due.slice(0, 13)).toBe('2026-09-21T04') // 9/20 の翌日 4:00
    // 過去の行は消さず、リセットの行が積まれる。
    const kinds = listReviewLogs(e.id).map((l) => l.kind)
    expect(kinds.filter((k) => k === 'review')).toHaveLength(2)
    expect(kinds).toContain('reset')
  })

  test('リセット後の再構築はリセット以降の評価だけを使う', () => {
    const e = createEntry({ body_md: 'あ' }, day(0, 10))
    submitReview(e.id, 3, day(1))
    submitReview(e.id, 3, day(4))
    updateEntry(e.id, { body_md: '書き直した', reset_schedule: true }, day(5, 10))
    const after = submitReview(e.id, 3, day(6))
    // リセット直後の新規状態から 1 回ぶんなので、初回と同じ 3 日になる。
    expect(after.interval_days).toBe(3)
    expect(after.schedule.reps).toBe(1)
    // 取り消すとリセット直後の新規状態に戻る（リセット前の履歴は使わない）。
    const undone = undoLastReview(e.id)
    expect(undone.schedule.state).toBe('New')
    expect(undone.schedule.reps).toBe(0)
  })
})

describe('検証用の時刻上書き', () => {
  test('MNEMORIZE_FAKE_NOW を設定すると clock.now() がその時刻を返す', async () => {
    const { now } = await import('../adapters/clock.ts')
    const saved = process.env.MNEMORIZE_FAKE_NOW
    try {
      process.env.MNEMORIZE_FAKE_NOW = '2026-09-16T09:00:00'
      expect(now().getDate()).toBe(16)
      expect(now().getHours()).toBe(9)
      process.env.MNEMORIZE_FAKE_NOW = 'これは時刻ではない'
      expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(5000)
    } finally {
      if (saved === undefined) delete process.env.MNEMORIZE_FAKE_NOW
      else process.env.MNEMORIZE_FAKE_NOW = saved
    }
  })
})

describe('これからの復習（upcoming）', () => {
  test('期限の学習日ごとにまとめ、件数と見出しを返す', () => {
    // 2 件とも 9/15 に作ると、初回期限はどちらも 9/16 の境界時刻。
    createEntry({ body_md: 'FSRS の論文を読んだ' }, day(0, 14))
    createEntry({ title: '散歩', body_md: '川沿いを歩いた' }, day(0, 15))
    // 1 件だけ 9/16 に評価すると、その記録の期限は先（9/19）へ動く。
    const q = todayQueue(day(1, 9))
    const first = q.items[0]!
    submitReview(first.entry.id, 3, day(1, 9))

    const days = upcoming('2026-09-16', '2026-09-30')
    // 評価しなかった 1 件は 9/16 のまま、評価した 1 件は 3 日後の 9/19。
    expect(days.map((d) => [d.date, d.count])).toEqual([
      ['2026-09-16', 1],
      ['2026-09-19', 1],
    ])
    const headlines = days.flatMap((d) => d.entries.map((e) => e.headline))
    expect(headlines.sort()).toEqual(['FSRS の論文を読んだ', '散歩'])
  })

  test('復習を終えた記録・復習しない記録・期間外は返さない', () => {
    const a = createEntry({ body_md: '終える記録' }, day(0, 14))
    createEntry({ body_md: '復習しない記録', review_enabled: false }, day(0, 14))
    createEntry({ body_md: '期間の中の記録' }, day(0, 14))
    retireEntry(a.id, day(0, 20))

    // 期限はいずれも 9/16。期間を 9/17 以降にすると 1 日も返らない。
    expect(upcoming('2026-09-17', '2026-09-30')).toEqual([])
    const days = upcoming('2026-09-16', '2026-09-16')
    expect(days).toHaveLength(1)
    expect(days[0]!.count).toBe(1)
    expect(days[0]!.entries[0]!.headline).toBe('期間の中の記録')
  })
})
