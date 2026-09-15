// YYYY-MM-DD の文字列どうしの計算。表示用の整形は i18n/ja.ts にある。
// ここは「学習日」を文字列のまま足し引きするだけで、時刻や境界時刻には触れない。

/** YYYY-MM-DD を Date（ローカルの 0 時）に直す。 */
function toDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

/** Date を YYYY-MM-DD に直す。 */
export function toDateString(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** n 日後（負の数なら n 日前）の YYYY-MM-DD。 */
export function addDays(date: string, n: number): string {
  const d = toDate(date)
  d.setDate(d.getDate() + n)
  return toDateString(d)
}

/** その日の曜日（0＝日曜）。 */
export function weekdayOf(date: string): number {
  return toDate(date).getDay()
}

/** YYYY-MM-DD の属する月（YYYY-MM）。 */
export function monthOf(date: string): string {
  return date.slice(0, 7)
}

/** n か月後（負の数なら n か月前）の YYYY-MM。 */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y ?? 1970, (m ?? 1) - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** その月の日付（YYYY-MM-DD）を 1 日から末日まで並べる。 */
export function daysOfMonth(ym: string): string[] {
  const [y, m] = ym.split('-').map(Number)
  const year = y ?? 1970
  const month = (m ?? 1) - 1
  const last = new Date(year, month + 1, 0).getDate()
  const out: string[] = []
  for (let i = 1; i <= last; i += 1) out.push(toDateString(new Date(year, month, i)))
  return out
}
