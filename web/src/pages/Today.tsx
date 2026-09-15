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

type Props = { today: string }

/** 新しい順（作成時刻の降順）。 */
function newestFirst(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

export function Today({ today }: Props) {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 進行中の文字起こしジョブ。新しいものを先頭に出す（要件 C2）。
  const [jobIds, setJobIds] = useState<string[]>([])
  const refreshDueCount = useReviewQueueRefresh()

  /** その日の一覧を取り直す。 */
  function reload() {
    api
      .day(today)
      .then((res) => setEntries(newestFirst(res.entries)))
      .catch((e) => setError(e instanceof Error ? e.message : ja.error.generic))
  }

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

  // この日の、まだ決着していない文字起こしジョブをサーバーから読む。
  // これが無いと、ブラウザ自身が始めた録音のジョブしかカードに出ない
  // （再読み込みしたあとや、別の経路で作られたジョブの失敗が画面から見えなくなる）。
  useEffect(() => {
    let alive = true
    setJobIds([])
    api
      .transcriptions({ status: ['queued', 'running', 'failed'], day_date: today })
      .then((res) => {
        if (alive) setJobIds(res.jobs.map((j) => j.id))
      })
      .catch(() => {
        // ジョブ一覧が読めなくても、その日の記録の表示は続ける。
      })
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

      <ReviewSection />

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
                primary
                onJobCreated={(jobId) => setJobIds((cur) => (cur.includes(jobId) ? cur : [jobId, ...cur]))}
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
                onDone={() => {
                  setJobIds((cur) => cur.filter((id) => id !== jobId))
                  reload()
                }}
                onDismiss={(id) => setJobIds((cur) => cur.filter((x) => x !== id))}
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
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
