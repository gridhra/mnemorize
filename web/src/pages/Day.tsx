// 日の画面（`#/day/YYYY-MM-DD`）。1 日ぶんの記録を読み、過去の日と今日には書き足せる。
// まだ来ていない日は、その日に期限が来る復習の予定だけを読む（記録は作れない）。
import { useEffect, useRef, useState } from 'preact/hooks'
import { api, type Entry, type UpcomingDay } from '../api.ts'
import { ja, formatJapaneseDate } from '../i18n/ja.ts'
import { EntryCard } from '../components/EntryCard.tsx'
import { EntryEditor } from '../components/EntryEditor.tsx'
import { Recorder } from '../components/Recorder.tsx'
import { TranscribingCard } from '../components/TranscribingCard.tsx'
import { addDays, monthOf } from '../dates.ts'
import { formatRoute } from '../router.ts'
import { useReviewQueueRefresh } from '../queue-context.ts'
import { useTranscribingJobs } from '../hooks/useTranscribingJobs.ts'

type Props = {
  /** 表示する学習日（YYYY-MM-DD）。 */
  date: string
  /** 今日の学習日。過去・今日・未来の判定と、カードの「◯日後」の基準に使う。 */
  today: string
  /** 強調してスクロールする記録の id（検索結果やカレンダーからのリンク）。 */
  entryId?: string
}

/** 新しい順（作成時刻の降順）。 */
function newestFirst(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

export function Day({ date, today, entryId }: Props) {
  const isFuture = date > today
  const isToday = date === today
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [upcoming, setUpcoming] = useState<UpcomingDay | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const refreshDueCount = useReviewQueueRefresh()
  // 強調したカードへ一度だけスクロールする（同じ日を見ている間に何度も飛ばない）。
  const scrolledTo = useRef<string | null>(null)

  /** その日の一覧を取り直す。 */
  function reload() {
    api
      .day(date)
      .then((res) => setEntries(newestFirst(res.entries)))
      .catch((e) => setError(e instanceof Error ? e.message : ja.error.generic))
  }

  // 進行中の文字起こしジョブ（今日の画面と同じ扱い）。まだ来ていない日では読まない。
  const { jobIds, addJob, removeJob, onDone } = useTranscribingJobs(isFuture ? null : date, reload)

  useEffect(() => {
    let alive = true
    setError(null)
    setEntries(null)
    setUpcoming(undefined)
    scrolledTo.current = null

    if (isFuture) {
      api
        .reviewsUpcoming(date, date)
        .then((res) => alive && setUpcoming(res.days[0] ?? null))
        .catch((e) => alive && setError(e instanceof Error ? e.message : ja.error.generic))
      return () => {
        alive = false
      }
    }

    api
      .day(date)
      .then((res) => alive && setEntries(newestFirst(res.entries)))
      .catch((e) => alive && setError(e instanceof Error ? e.message : ja.error.generic))
    return () => {
      alive = false
    }
  }, [date, isFuture])

  // `?entry=<id>` で開かれたら、そのカードまでスクロールする。
  useEffect(() => {
    if (!entryId || entries === null || scrolledTo.current === entryId) return
    const el = document.getElementById(`entry-${entryId}`)
    if (!el) return
    scrolledTo.current = entryId
    el.scrollIntoView({ block: 'center' })
  }, [entryId, entries])

  return (
    <div class="page">
      {/* 移動の帯。月の画面（Calendar）と同じ構造・同じクラスで、
          「前へ・見出し・次へ・別の画面へ」の4つをこの順に置く。 */}
      <div class="daybar">
        <a class="button daybar-prev" href={formatRoute({ name: 'day', date: addDays(date, -1) })}>
          {ja.day.prevDay}
        </a>
        <h1 class="daybar-title">{formatJapaneseDate(date)}</h1>
        <a class="button daybar-next" href={formatRoute({ name: 'day', date: addDays(date, 1) })}>
          {ja.day.nextDay}
        </a>
        <a class="button daybar-jump" href={formatRoute({ name: 'calendar', ym: monthOf(date) })}>
          {ja.day.toCalendar}
        </a>
      </div>

      {/* 案内文は帯の直下に統一する（今日・未来のどちらも同じ位置。過去は何も出さない）。 */}
      {isToday && <p class="muted status-line">{ja.day.todayNotice}</p>}
      {isFuture && <p class="muted status-line">{ja.day.futureNotice}</p>}
      {/* 検索結果などから `?entry=<id>` で来たのに、その記録がこの日の一覧に無い
          （削除されている）とき。案内文と同じ位置に出す。 */}
      {entryId && entries !== null && !entries.some((e) => e.id === entryId) && (
        <p class="muted status-line">{ja.day.entryMissing}</p>
      )}

      {error && (
        <p class="error">
          {ja.error.prefix}
          {error}
        </p>
      )}

      {isFuture ? (
        <section class="section">
          <div class="section-head">
            <h2 class="section-title">{ja.day.futureSection}</h2>
          </div>
          {upcoming === undefined ? (
            <p class="muted">{ja.day.loading}</p>
          ) : upcoming === null ? (
            <p class="muted empty">{ja.day.futureEmpty}</p>
          ) : (
            <ul class="upcoming-entries">
              {upcoming.entries.map((e) => (
                <li key={e.id}>{e.headline}</li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section class="section">
          <div class="section-head">
            <h2 class="section-title">{ja.day.entrySection}</h2>
          </div>

          {jobIds.length > 0 && (
            <div class="cards">
              {jobIds.map((jobId) => (
                <TranscribingCard
                  key={jobId}
                  jobId={jobId}
                  onDone={() => onDone(jobId)}
                  onDismiss={removeJob}
                />
              ))}
            </div>
          )}

          {entries === null ? (
            <p class="muted">{ja.day.loading}</p>
          ) : entries.length === 0 ? (
            jobIds.length === 0 && <p class="muted empty">{ja.day.empty}</p>
          ) : (
            <div class="cards">
              {entries.map((e) => (
                <div
                  key={e.id}
                  id={`entry-${e.id}`}
                  class={e.id === entryId ? 'highlight' : undefined}
                >
                  <EntryCard
                    entry={e}
                    today={today}
                    onChanged={(updated) =>
                      setEntries((cur) => (cur ?? []).map((x) => (x.id === updated.id ? updated : x)))
                    }
                    onDeleted={(id) => {
                      setEntries((cur) => (cur ?? []).filter((x) => x.id !== id))
                      refreshDueCount()
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          <div class="new-entry">
            <h3 class="section-title">{ja.day.addHere}</h3>
            <EntryEditor
              key={date}
              initial={{ title: '', body_md: '', review_enabled: true }}
              submitLabel={ja.entry.create}
              showCaptureSlots
              recorderSlot={
                // この画面には復習カードが出ないので、録音は常に主操作＝塗りつぶし（設計05§6）。
                // 文字起こしのジョブは、いま見ている日（date）の記録として作る。
                <Recorder
                  dayDate={date}
                  primary
                  onJobCreated={addJob}
                />
              }
              onSubmit={async (v) => {
                const res = await api.createEntry({
                  day_date: date,
                  title: v.title.trim() === '' ? null : v.title,
                  body_md: v.body_md,
                  review_enabled: v.review_enabled,
                })
                setEntries((cur) => [res.entry, ...(cur ?? [])])
                refreshDueCount()
                return res.entry
              }}
            />
          </div>
        </section>
      )}
    </div>
  )
}
