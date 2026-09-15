import { describe, expect, test } from 'bun:test'
import { dueWindow, initialDue, isDateString, localDate, toLocalIso } from './clock.ts'

const at = (iso: string) => new Date(iso)

describe('localDate（午前 4 時境界の学習日）', () => {
  test('境界のちょうど 1 分前は前日', () => {
    expect(localDate(at('2026-09-15T03:59:00'), 4)).toBe('2026-09-14')
  })
  test('境界ちょうどは当日', () => {
    expect(localDate(at('2026-09-15T04:00:00'), 4)).toBe('2026-09-15')
  })
  test('昼はもちろん当日', () => {
    expect(localDate(at('2026-09-15T12:00:00'), 4)).toBe('2026-09-15')
  })
  test('深夜 1 時は前日扱い', () => {
    expect(localDate(at('2026-09-16T01:00:00'), 4)).toBe('2026-09-15')
  })
  test('月をまたぐ深夜', () => {
    expect(localDate(at('2026-10-01T02:30:00'), 4)).toBe('2026-09-30')
  })
  test('年をまたぐ深夜', () => {
    expect(localDate(at('2027-01-01T00:10:00'), 4)).toBe('2026-12-31')
  })
  test('境界 0 時なら暦日と一致', () => {
    expect(localDate(at('2026-09-16T01:00:00'), 0)).toBe('2026-09-16')
  })
})

describe('dueWindow', () => {
  test('窓は [当日境界, 翌日境界)', () => {
    const w = dueWindow(at('2026-09-15T23:00:00'), 4)
    expect(w.date).toBe('2026-09-15')
    expect(toLocalIso(w.start).slice(0, 16)).toBe('2026-09-15T04:00')
    expect(toLocalIso(w.end).slice(0, 16)).toBe('2026-09-16T04:00')
  })
  test('境界前は前日の窓', () => {
    const w = dueWindow(at('2026-09-15T02:00:00'), 4)
    expect(w.date).toBe('2026-09-14')
    expect(toLocalIso(w.end).slice(0, 16)).toBe('2026-09-15T04:00')
  })
  test('now は窓の中に入る', () => {
    const now = at('2026-09-15T03:00:00')
    const w = dueWindow(now, 4)
    expect(w.start.getTime()).toBeLessThanOrEqual(now.getTime())
    expect(w.end.getTime()).toBeGreaterThan(now.getTime())
  })
})

describe('initialDue（初回期限は翌日の境界）', () => {
  test('昼に作ると翌日 4:00', () => {
    expect(toLocalIso(initialDue(at('2026-09-15T14:00:00'), 4)).slice(0, 16)).toBe('2026-09-16T04:00')
  })
  test('深夜 2 時に作ると当日 4:00（学習日は前日なので翌境界は同じ暦日）', () => {
    expect(toLocalIso(initialDue(at('2026-09-15T02:00:00'), 4)).slice(0, 16)).toBe('2026-09-15T04:00')
  })
})

describe('その他', () => {
  test('toLocalIso はオフセット付き', () => {
    expect(toLocalIso(at('2026-09-15T04:00:00'))).toMatch(/^2026-09-15T04:00:00\.000[+-]\d{2}:\d{2}$/)
  })
  test('isDateString', () => {
    expect(isDateString('2026-09-15')).toBe(true)
    expect(isDateString('2026-9-15')).toBe(false)
    expect(isDateString(20260915)).toBe(false)
  })
})
