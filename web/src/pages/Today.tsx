// 「今日」画面。今日しか表示しない（日付の移動はカレンダーの画面で行う）。
// 上から：今日の日付 → 今日の復習 → 今日の記録（先頭が新規作成欄）。
import { useEffect, useState } from 'preact/hooks'
import { api, type Entry } from '../api.ts'
import { ja, formatJapaneseDate } from '../i18n/ja.ts'
import { EntryCard } from '../components/EntryCard.tsx'
import { EntryEditor } from '../components/EntryEditor.tsx'
import { Recorder } from '../components/Recorder.tsx'
import { ReviewSection } from '../components/ReviewSection.tsx'
import { TranscribingCard } from '../components/TranscribingCard.tsx'
import { useReviewQueueRefresh } from '../queue-context.ts'
import { useTranscribingJobs } from '../hooks/useTranscribingJobs.ts'

type Props = { today: string }

/** 新しい順（作成時刻の降順）。 */
function newestFirst(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

export function Today({ today }: Props) {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 復習カードを表示中か。表示中は「思い出せたら開く」が塗りつぶしの主操作なので、
  // 「録音して記録する」は枠線に落とす（塗りつぶしは画面に 1 つ。設計 05 §6）。
  const [reviewActive, setReviewActive] = useState(false)
  const refreshDueCount = useReviewQueueRefresh()

  /** その日の一覧を取り直す。 */
  function reload() {
    api
      .day(today)
      .then((res) => setEntries(newestFirst(res.entries)))
      .catch((e) => setError(e instanceof Error ? e.message : ja.error.generic))
  }

  // 進行中の文字起こしジョブ。新しいものを先頭に出す（要件 C2）。
  const { jobIds, addJob, removeJob, onDone } = useTranscribingJobs(today, reload)

  useEffect(() => {
    let alive = true
    setEntries(null)
    api
      .day(today)
      .then((res) => {
        if (alive) setEntries(newestFirst(res.entries))
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : ja.error.generic))
    return () => {
      alive = false
    }
  }, [today])

  return (
    <div class="page">
      <h1 class="day-title">{formatJapaneseDate(today)}</h1>

      {error && (
        <p class="error">
          {ja.error.prefix}
          {error}
        </p>
      )}

      <ReviewSection onActiveChange={setReviewActive} />

      <section class="section">
        <div class="section-head">
          <h2 class="section-title">{ja.today.recordSection}</h2>
        </div>

        <div class="new-entry">
          <EntryEditor
            key={today}
            initial={{ title: '', body_md: '', review_enabled: true }}
            submitLabel={ja.entry.create}
            showCaptureSlots
            recorderSlot={
              <Recorder
                dayDate={today}
                primary={!reviewActive}
                onJobCreated={addJob}
              />
            }
            onSubmit={async (v) => {
              const res = await api.createEntry({
                day_date: today,
                title: v.title.trim() === '' ? null : v.title,
                body_md: v.body_md,
                review_enabled: v.review_enabled,
              })
              setEntries((cur) => [res.entry, ...(cur ?? [])])
              refreshDueCount()
              // 画像添付（要件 C6）：新規作成中に落とされた画像は、記録が作られた後にアップロードする。
              return res.entry
            }}
          />
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
          <p class="muted">{ja.today.loading}</p>
        ) : entries.length === 0 ? (
          jobIds.length === 0 && <p class="muted empty">{ja.today.empty}</p>
        ) : (
          <div class="cards">
            {entries.map((e) => (
              <EntryCard
                key={e.id}
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
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
