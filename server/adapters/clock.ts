// 時刻の境界。現在時刻と「学習日」（既定は午前 4 時境界）の計算だけをここに置く。
// 外界（システム時計・タイムゾーン）に触れるのはこのファイル。

/** 一日の境界時刻の既定値（要件 D10）。深夜 1 時の記録は前日扱いになる。 */
export const DEFAULT_BOUNDARY_HOUR = 4

/**
 * 現在時刻。システム時計を読むのはこの関数だけ。
 *
 * 環境変数 `MNEMORIZE_FAKE_NOW` に ISO 8601 の文字列（例 `2026-09-16T09:00:00`）を入れておくと、
 * その時刻を返す。「翌日になったら復習キューに出る」といった日付をまたぐ動作を、
 * 実際に一晩待たずに確かめるための検証用の仕組み。読めない文字列は無視して実時刻を返す。
 */
export function now(): Date {
  const fake = process.env.MNEMORIZE_FAKE_NOW
  if (fake && fake.length > 0) {
    const d = new Date(fake)
    if (!Number.isNaN(d.getTime())) return d
  }
  return new Date()
}

const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, '0')

/** ローカル日付を YYYY-MM-DD で返す（境界時刻は考慮しない素の暦日）。 */
export function calendarDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** ISO 8601（ローカルタイムゾーンのオフセット付き）文字列。例：2026-09-15T04:00:00+09:00 */
export function toLocalIso(d: Date): string {
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const tz = `${sign}${pad(Math.floor(Math.abs(offsetMin) / 60))}:${pad(Math.abs(offsetMin) % 60)}`
  return (
    `${calendarDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `.${pad(d.getMilliseconds(), 3)}${tz}`
  )
}

/** now が属する「学習日」の日付（YYYY-MM-DD）。境界時刻より前なら前日になる。 */
export function localDate(now: Date, boundaryHour: number = DEFAULT_BOUNDARY_HOUR): string {
  const shifted = new Date(now.getTime())
  shifted.setHours(shifted.getHours() - boundaryHour)
  return calendarDate(shifted)
}

/** YYYY-MM-DD の境界時刻ちょうどの Date（ローカル）。 */
export function dayStart(date: string, boundaryHour: number = DEFAULT_BOUNDARY_HOUR): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, boundaryHour, 0, 0, 0)
}

/** now が属する学習日の窓 [start, end)。end は翌日の境界時刻。 */
export function dueWindow(
  now: Date,
  boundaryHour: number = DEFAULT_BOUNDARY_HOUR,
): { start: Date; end: Date; date: string } {
  const date = localDate(now, boundaryHour)
  const start = dayStart(date, boundaryHour)
  const end = new Date(start.getTime())
  end.setDate(end.getDate() + 1)
  return { start, end, date }
}

/** 新規記録の初回期限：作成した学習日の翌日の境界時刻（要件 S5）。 */
export function initialDue(now: Date, boundaryHour: number = DEFAULT_BOUNDARY_HOUR): Date {
  return dueWindow(now, boundaryHour).end
}

/** YYYY-MM-DD の形かどうか（存在しない日付は弾かない最低限の検証）。 */
export function isDateString(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
}
