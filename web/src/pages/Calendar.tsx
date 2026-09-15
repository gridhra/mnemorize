// カレンダーの画面（`#/calendar/YYYY-MM`）。月のマス目と、これからの復習の予定。
// マスは日の画面（`#/day/YYYY-MM-DD`）へのリンク。
import { useEffect, useState } from 'preact/hooks'
import { api, type UpcomingDay } from '../api.ts'
import { ja, formatJapaneseDate } from '../i18n/ja.ts'
import { addDays, addMonths, daysOfMonth, monthOf, weekdayOf } from '../dates.ts'
import { formatRoute, navigate } from '../router.ts'

/** 「これからの復習」に出す日数。仮の値（設計文書 05 の §3.2）。 */
const UPCOMING_DAYS = 14

type Props = {
  /** 表示する月（YYYY-MM）。ハッシュに月が無いときは今月。 */
  ym?: string
  /** 今日の学習日（YYYY-MM-DD）。 */
  today: string
}

export function Calendar({ ym, today }: Props) {
  const month = ym ?? monthOf(today)
  const [entryCounts, setEntryCounts] = useState<Record<string, number> | null>(null)
  const [dueCounts, setDueCounts] = useState<Record<string, number> | null>(null)
  const [upcoming, setUpcoming] = useState<UpcomingDay[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const days = daysOfMonth(month)
  const first = days[0] ?? `${month}-01`
  const last = days[days.length - 1] ?? first

  // 月のマスに出す 2 つの数（記録の件数・復習の期限の件数）。
  useEffect(() => {
    let alive = true
    setEntryCounts(null)
    setDueCounts(null)
    api
      .dayCounts(first, last)
      .then((res) => {
        if (!alive) return
        const map: Record<string, number> = {}
        for (const d of res.days) map[d.day_date] = d.count
        setEntryCounts(map)
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : ja.error.generic))
    api
      .reviewsUpcoming(first, last)
      .then((res) => {
        if (!alive) return
        const map: Record<string, number> = {}
        for (const d of res.days) map[d.date] = d.count
        setDueCounts(map)
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : ja.error.generic))
    return () => {
      alive = false
    }
  }, [first, last])

  // 月とは別に、今日から 14 日分の予定を読む（月を移っても内容は変わらない）。
  useEffect(() => {
    let alive = true
    api
      .reviewsUpcoming(today, addDays(today, UPCOMING_DAYS - 1))
      .then((res) => alive && setUpcoming(res.days))
      .catch(() => {
        // 予定が読めなくても月のマス目は出す。
      })
    return () => {
      alive = false
    }
  }, [today])

  const [year, monthNo] = month.split('-').map(Number)
  const isThisMonth = month === monthOf(today)
  // 月曜始まりの 7 列。1 日の前に空きマスを詰める。
  const leading = (weekdayOf(first) + 6) % 7
  const cells: (string | null)[] = [...Array<null>(leading).fill(null), ...days]
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div class="page">
      <div class="daybar">
        <a class="button" href={formatRoute({ name: 'calendar', ym: addMonths(month, -1) })}>
          {ja.calendar.prevMonth}
        </a>
        <h1 class="daybar-title">{ja.calendar.monthLabel(year ?? 0, monthNo ?? 0)}</h1>
        <a class="button" href={formatRoute({ name: 'calendar', ym: addMonths(month, 1) })}>
          {ja.calendar.nextMonth}
        </a>
        <button
          type="button"
          class="button"
          disabled={isThisMonth}
          onClick={() => navigate({ name: 'calendar', ym: monthOf(today) })}
        >
          {ja.calendar.thisMonth}
        </button>
      </div>

      {error && (
        <p class="error">
          {ja.error.prefix}
          {error}
        </p>
      )}

      <div class="cal-grid" role="grid">
        {ja.calendar.weekdayHeads.map((w) => (
          <div key={w} class="cal-head">
            {w}
          </div>
        ))}
        {cells.map((date, i) =>
          date === null ? (
            <div key={`blank-${i}`} class="cal-cell cal-blank" aria-hidden="true" />
          ) : (
            <a
              key={date}
              class={`cal-cell${date === today ? ' cal-today' : ''}`}
              href={formatRoute({ name: 'day', date })}
            >
              <span class="cal-date">{Number(date.slice(8))}</span>
              <span class="cal-count">
                {entryCounts && entryCounts[date] ? ja.calendar.entryCount(entryCounts[date]) : ''}
              </span>
              <span class="cal-count cal-due">
                {dueCounts && dueCounts[date] ? ja.calendar.dueCount(dueCounts[date]) : ''}
              </span>
            </a>
          ),
        )}
      </div>

      <section class="section">
        <div class="section-head">
          <h2 class="section-title">{ja.calendar.upcomingTitle}</h2>
        </div>
        <p class="muted status-line">{ja.calendar.upcomingRange(UPCOMING_DAYS)}</p>
        {upcoming === null ? (
          <p class="muted">{ja.calendar.loading}</p>
        ) : upcoming.length === 0 ? (
          <p class="muted empty">{ja.calendar.upcomingEmpty(UPCOMING_DAYS)}</p>
        ) : (
          <ul class="upcoming">
            {upcoming.map((d) => (
              <li key={d.date}>
                <details class="upcoming-day">
                  <summary>{ja.calendar.upcomingDay(formatJapaneseDate(d.date), d.count)}</summary>
                  <ul class="upcoming-entries">
                    {d.entries.map((e) => (
                      <li key={e.id}>
                        <a href={formatRoute({ name: 'day', date: d.date, entry: e.id })}>
                          {e.headline}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
