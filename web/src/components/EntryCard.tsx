// その日の記録 1 件のカード。本文は読むためのもので、編集は操作ボタンから入る。
import { useEffect, useState } from 'preact/hooks'
import { api, type Entry, type ReviewLog, type Revision } from '../api.ts'
import { ja, formatJapaneseDate, formatJapaneseDateTime } from '../i18n/ja.ts'
import { renderMarkdown } from '../markdown.ts'
import { EntryEditor } from './EntryEditor.tsx'
import { Attachments } from './Attachments.tsx'
import { Lightbox } from './Lightbox.tsx'
import { Recorder } from './Recorder.tsx'

type Props = {
  entry: Entry
  /** 画面が表示している学習日（YYYY-MM-DD）。「あと何日後か」の計算に使う。 */
  today: string
  onChanged: (entry: Entry) => void
}

/** YYYY-MM-DD 同士の日数の差（to − from）。 */
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const a = new Date(fy ?? 1970, (fm ?? 1) - 1, fd ?? 1)
  const b = new Date(ty ?? 1970, (tm ?? 1) - 1, td ?? 1)
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

/** YYYY-MM-DD に日数を足す。 */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

/** 復習の履歴 1 行の文字列。評価の行と、手動操作（やり直し・終了・再開）の行を作り分ける。 */
function reviewLogLine(log: ReviewLog): string {
  const at = formatJapaneseDate((log.fsrs_instant ?? log.reviewed_at).slice(0, 10))
  if (log.kind === 'review' && log.rating !== null) {
    const result =
      log.rating === 1 ? ja.review.again : log.rating === 4 ? ja.review.easy : ja.review.good
    // 次回の期限＝この復習をした学習日＋この復習で決まった間隔（日）。
    const next = formatJapaneseDate(
      addDays((log.fsrs_instant ?? log.reviewed_at).slice(0, 10), log.scheduled_days ?? 0),
    )
    return ja.review.logItem(at, result, next)
  }
  const what =
    log.kind === 'reset'
      ? ja.review.logReset
      : log.kind === 'retire'
        ? ja.review.logRetire
        : ja.review.logUnretire
  return ja.review.logEvent(at, what)
}

export function EntryCard({ entry, today, onChanged }: Props) {
  const [editing, setEditing] = useState(false)
  const [revisions, setRevisions] = useState<Revision[] | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [logs, setLogs] = useState<ReviewLog[] | null>(null)
  const [logsOpen, setLogsOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [managingAttachments, setManagingAttachments] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  // 追記の録音を出したあと、文字起こしの終わりを待つためのジョブ id。
  const [appendJobId, setAppendJobId] = useState<string | null>(null)
  const images = entry.attachments.filter((a) => a.kind === 'image')

  // 追記の文字起こしが終わると本文がサーバー側で書き換わるので、終わったらカードを取り直す。
  useEffect(() => {
    if (!appendJobId) return
    let stopped = false
    const timer = setInterval(() => {
      void (async () => {
        try {
          const { job } = await api.transcription(appendJobId)
          if (stopped || job.status === 'queued' || job.status === 'running') return
          setAppendJobId(null)
          if (job.status === 'failed') {
            setError(job.error ?? ja.transcribe.failed)
            return
          }
          onChanged((await api.entry(entry.id)).entry)
        } catch (e) {
          setAppendJobId(null)
          setError(e instanceof Error ? e.message : ja.error.generic)
        }
      })()
    }, 1500)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [appendJobId, entry.id])

  async function toggleHistory() {
    if (historyOpen) {
      setHistoryOpen(false)
      return
    }
    setHistoryOpen(true)
    try {
      setRevisions((await api.revisions(entry.id)).revisions)
    } catch (e) {
      setError(e instanceof Error ? e.message : ja.error.generic)
    }
  }

  /** 「復習の記録」。開くたびに取り直す（評価したあとの状態をそのまま見せるため）。 */
  async function toggleReviewLogs() {
    if (logsOpen) {
      setLogsOpen(false)
      return
    }
    setLogsOpen(true)
    setLogs(null)
    try {
      setLogs((await api.reviewLogs(entry.id)).logs)
    } catch (e) {
      setError(e instanceof Error ? e.message : ja.error.generic)
    }
  }

  /** ある版の内容に戻す。履歴は消さず、いまの内容が新しい版として積まれる。 */
  async function revertTo(r: Revision) {
    if (!confirm(ja.entry.historyRevertConfirm)) return
    try {
      const res = await api.updateEntry(entry.id, { title: r.title, body_md: r.body_md })
      onChanged(res.entry)
      setRevisions((await api.revisions(entry.id)).revisions)
    } catch (e) {
      setError(e instanceof Error ? e.message : ja.error.generic)
    }
  }

  async function toggleRetire() {
    if (!entry.retired_at && !confirm(ja.entry.retireConfirm)) return
    try {
      const res = entry.retired_at ? await api.unretire(entry.id) : await api.retire(entry.id)
      onChanged(res.entry)
    } catch (e) {
      setError(e instanceof Error ? e.message : ja.error.generic)
    }
  }

  /** 復習の予定を最初からやり直す（編集フォームの同じチェックと同じ処理）。 */
  async function resetSchedule() {
    if (!confirm(ja.entry.resetScheduleConfirm)) return
    try {
      const res = await api.updateEntry(entry.id, { reset_schedule: true })
      onChanged(res.entry)
    } catch (e) {
      setError(e instanceof Error ? e.message : ja.error.generic)
    }
  }

  /** 復習の状態を 1 行で。終了・対象外・予定ありの 3 通り。 */
  function statusLine(): string {
    if (entry.retired_at) {
      return ja.entry.retiredLine(formatJapaneseDate(entry.retired_at.slice(0, 10)))
    }
    if (!entry.review_enabled) return ja.entry.notReviewed
    if (!entry.schedule) return ja.entry.notReviewed
    const due = entry.schedule.due.slice(0, 10)
    return ja.entry.scheduleLine(
      formatJapaneseDate(due),
      daysBetween(today, due),
      entry.schedule.reps + 1,
    )
  }

  return (
    <article class="card">
      <header class="card-head">
        <h2 class="card-title">{entry.headline}</h2>
      </header>
      <p class="status-line">{statusLine()}</p>

      {images.length > 0 && (
        <div class="thumbs">
          {images.map((a) => (
            <img
              key={a.id}
              class="thumb-img"
              src={`/files/${a.rel_path}`}
              alt=""
              loading="lazy"
              onClick={() => setLightbox(`/files/${a.rel_path}`)}
            />
          ))}
        </div>
      )}

      {editing ? (
        <EntryEditor
          initial={{
            title: entry.title ?? '',
            body_md: entry.body_md,
            review_enabled: entry.review_enabled === 1,
          }}
          submitLabel={ja.entry.save}
          showResetSchedule
          recorderSlot={
            <Recorder
              dayDate={entry.day_date}
              entryId={entry.id}
              onJobCreated={(jobId) => setAppendJobId(jobId)}
            />
          }
          onCancel={() => setEditing(false)}
          onSubmit={async (v) => {
            const res = await api.updateEntry(entry.id, {
              title: v.title.trim() === '' ? null : v.title,
              body_md: v.body_md,
              review_enabled: v.review_enabled,
              reset_schedule: v.reset_schedule,
            })
            onChanged(res.entry)
            setEditing(false)
          }}
        />
      ) : (
        <div class="card-body prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.body_md) }} />
      )}

      {/* 操作ボタンは常に同じ 4 つ・同じ順。使えないときは無効にして同じ位置に残す。 */}
      <footer class="card-actions">
        <button type="button" class="button ghost" disabled={editing} onClick={() => setEditing(true)}>
          {ja.entry.edit}
        </button>
        <button type="button" class="button ghost" onClick={() => void toggleReviewLogs()}>
          {ja.entry.reviewLog}
        </button>
        <button type="button" class="button ghost" onClick={() => void toggleHistory()}>
          {ja.entry.history}
        </button>
        <details class="more">
          <summary class="button ghost">{ja.entry.more}</summary>
          <div class="more-menu">
            <button
              type="button"
              class="button ghost"
              onClick={() => setManagingAttachments((v) => !v)}
            >
              {managingAttachments ? ja.attachments.manageClose : ja.attachments.manage}
            </button>
            <button type="button" class="button ghost" onClick={() => void toggleRetire()}>
              {entry.retired_at ? ja.entry.unretire : ja.entry.retire}
            </button>
            {!entry.retired_at && <small class="hint">{ja.entry.retireHint}</small>}
            <button type="button" class="button ghost" onClick={() => void resetSchedule()}>
              {ja.entry.resetScheduleAction}
            </button>
          </div>
        </details>
      </footer>

      {managingAttachments && (
        <Attachments
          entryId={entry.id}
          attachments={entry.attachments}
          onChanged={(attachments) => onChanged({ ...entry, attachments })}
        />
      )}

      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}

      {appendJobId && <p class="hint">{ja.entry.appendTranscribing}</p>}

      {logsOpen && (
        <div class="history reviewlog">
          {logs === null ? (
            <p class="muted">{ja.entry.reviewLogLoading}</p>
          ) : (
            <>
              <div class="reviewlog-state">
                {!entry.schedule || entry.schedule.reps === 0 ? (
                  <p class="muted">{ja.entry.reviewLogNever}</p>
                ) : (
                  <>
                    {entry.schedule.stability !== null && (
                      <p class="reviewlog-stat">
                        {ja.entry.reviewLogStability(Math.round(entry.schedule.stability))}
                        <small class="hint">{ja.entry.reviewLogStabilityHint}</small>
                      </p>
                    )}
                    {entry.retrievability !== null && (
                      <p class="reviewlog-stat">
                        {ja.entry.reviewLogRetrievability(Math.round(entry.retrievability * 100))}
                        <small class="hint">{ja.entry.reviewLogRetrievabilityHint}</small>
                      </p>
                    )}
                    <p class="reviewlog-stat">{ja.entry.reviewLogReps(entry.schedule.reps)}</p>
                    <p class="reviewlog-stat">{ja.entry.reviewLogLapses(entry.schedule.lapses)}</p>
                  </>
                )}
              </div>
              {logs.length > 0 && (
                <ul class="history-list">
                  {logs.map((log) => (
                    <li key={log.id} class="history-head">
                      {reviewLogLine(log)}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {historyOpen && (
        <div class="history">
          {revisions === null ? (
            <p class="muted">{ja.entry.historyLoading}</p>
          ) : revisions.length === 0 ? (
            <p class="muted">{ja.entry.historyEmpty}</p>
          ) : (
            <ul class="history-list">
              {revisions.map((r) => {
                // いまの本文と中身が同じ版は「戻す」ことがないので、札を出してボタンは無効にする。
                const isCurrent = r.body_md === entry.body_md && (r.title ?? '') === (entry.title ?? '')
                return (
                  <li key={r.id}>
                    <div class="history-head">
                      {ja.entry.historyItem(r.rev_no, formatJapaneseDateTime(r.created_at))}
                      {isCurrent && <span class="badge">{ja.entry.historyCurrent}</span>}
                      <button
                        type="button"
                        class="button ghost"
                        disabled={isCurrent}
                        onClick={() => void revertTo(r)}
                      >
                        {ja.entry.historyRevert}
                      </button>
                    </div>
                    <div class="history-body prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(r.body_md) }} />
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
      {error && <p class="error">{ja.error.prefix}{error}</p>}
    </article>
  )
}
