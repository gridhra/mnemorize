// 「今日」画面。日付の移動と、その日の記録の一覧・作成・編集。
import { useEffect, useState } from 'preact/hooks'
import { api, type Entry } from '../api.ts'
import { ja, formatJapaneseDate } from '../i18n/ja.ts'
import { EntryCard } from '../components/EntryCard.tsx'
import { EntryEditor } from '../components/EntryEditor.tsx'
import { Recorder } from '../components/Recorder.tsx'
import { TranscribingCard } from '../components/TranscribingCard.tsx'

/** YYYY-MM-DD を offset 日ずらす。 */
function shift(date: string, offset: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
  dt.setDate(dt.getDate() + offset)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

type Props = { date: string; today: string; onDateChange: (date: string) => void }

export function Today({ date, today, onDateChange }: Props) {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 進行中の文字起こしジョブ。新しいものを先頭に出す（要件 C2）。
  const [jobIds, setJobIds] = useState<string[]>([])

  /** その日の一覧を取り直す。 */
  function reload() {
    api
      .day(date)
      .then((res) => setEntries(res.entries))
      .catch((e) => setError(e instanceof Error ? e.message : ja.error.generic))
  }

  useEffect(() => {
    let alive = true
    setEntries(null)
    api
      .day(date)
      .then((res) => {
        if (alive) setEntries(res.entries)
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : ja.error.generic))
    return () => {
      alive = false
    }
  }, [date])

  // この日の、まだ決着していない文字起こしジョブをサーバーから読む。
  // これが無いと、ブラウザ自身が始めた録音のジョブしかカードに出ない
  // （再読み込みしたあとや、別の経路で作られたジョブの失敗が画面から見えなくなる）。
  // 完了したジョブは本文に反映済みなので出さない。
  useEffect(() => {
    let alive = true
    setJobIds([])
    api
      .transcriptions({ status: ['queued', 'running', 'failed'], day_date: date })
      .then((res) => {
        if (alive) setJobIds(res.jobs.map((j) => j.id))
      })
      .catch(() => {
        // ジョブ一覧が読めなくても、その日の記録の表示は続ける。
      })
    return () => {
      alive = false
    }
  }, [date])

  return (
    <div class="page">
      <div class="daybar">
        <button type="button" class="button ghost" onClick={() => onDateChange(shift(date, -1))}>
          ← {ja.today.prevDay}
        </button>
        <h1 class="day-title">{formatJapaneseDate(date)}</h1>
        <button type="button" class="button ghost" onClick={() => onDateChange(shift(date, 1))}>
          {ja.today.nextDay} →
        </button>
        {date !== today && (
          <button type="button" class="button ghost" onClick={() => onDateChange(today)}>
            {ja.today.backToToday}
          </button>
        )}
      </div>

      {error && <p class="error">{ja.error.prefix}{error}</p>}

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
              onChanged={(updated) => setEntries((cur) => (cur ?? []).map((x) => (x.id === updated.id ? updated : x)))}
            />
          ))}
        </div>
      )}

      <section class="new-entry">
        <h2 class="section-title">{ja.today.newEntry}</h2>
        <EntryEditor
          key={date}
          initial={{ title: '', body_md: '', review_enabled: true }}
          submitLabel={ja.entry.create}
          showCaptureSlots
          recorderSlot={
            <Recorder
              dayDate={date}
              onJobCreated={(jobId) => setJobIds((cur) => (cur.includes(jobId) ? cur : [jobId, ...cur]))}
            />
          }
          onSubmit={async (v) => {
            const res = await api.createEntry({
              day_date: date,
              title: v.title.trim() === '' ? null : v.title,
              body_md: v.body_md,
              review_enabled: v.review_enabled,
            })
            setEntries((cur) => [...(cur ?? []), res.entry])
            // 画像添付（要件 C6）：新規作成中に落とされた画像は、記録が作られた後にアップロードする。
            return res.entry
          }}
        />
      </section>
    </div>
  )
}
