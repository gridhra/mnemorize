// その日の記録 1 件のカード。本文は読むためのもので、編集は操作の帯から入る。
//
// カードの作りは 4 段で固定してある（設計05 §3.4、操作の原則2・11）。
//   1. 見出し
//   2. 復習の状態 1 行
//   3. 操作の帯……左に「表示の切り替え」（本文／復習の記録／本文の履歴／画像）、
//      右に行為（「編集する」と、ほかの操作を開く「⋯」）。編集に入ると同じ座標が
//      「キャンセル」に変わり、その右が「保存する」になる。帯は内容の上にあるので、
//      中身がどれだけ伸び縮みしてもこの 2 つのボタンの座標は動かない。
//   4. 内容領域……切り替えで中身だけが差し替わる。下へ開いて周囲を押し広げない。
import { useEffect, useRef, useState } from 'preact/hooks'
import { api, type Entry, type ReviewLog, type Revision } from '../api.ts'
import { ja, formatJapaneseDate, formatJapaneseDateTime } from '../i18n/ja.ts'
import { renderMarkdown } from '../markdown.ts'
import { EntryEditor, type EditorControls } from './EntryEditor.tsx'
import { Attachments } from './Attachments.tsx'
import { Lightbox } from './Lightbox.tsx'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { MoreMenu } from './MoreMenu.tsx'
import { Segmented } from './Segmented.tsx'
import { editEntryDraftKey } from '../drafts.ts'

type Props = {
  entry: Entry
  /** 画面が表示している学習日（YYYY-MM-DD）。「あと何日後か」の計算に使う。 */
  today: string
  onChanged: (entry: Entry) => void
  /** 記録が削除されたときに呼ぶ。一覧から外し、復習の件数を取り直すのは呼び出し元の仕事。 */
  onDeleted?: (id: string) => void
}

/** 内容領域に出すもの。切り替えても何も起こらない（表示の切り替えであって行為ではない）。 */
type Tab = 'body' | 'reviewlog' | 'history' | 'images'

/** 確認ダイアログを出している操作。どちらも元に戻せないものだけ（操作の原則3）。 */
type Confirming = 'delete' | 'resetSchedule'

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

export function EntryCard({ entry, today, onChanged, onDeleted }: Props) {
  const [tab, setTab] = useState<Tab>('body')
  const [editing, setEditing] = useState(false)
  // 編集フォームの保存・中止。フォームの中ではなく操作の帯に置くので、外へ預かる。
  const [controls, setControls] = useState<EditorControls | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  // 「⋯」そのもの。メニューの項目を押したあと、フォーカスをここへ返す（操作の原則8）。
  const moreButton = useRef<HTMLButtonElement>(null)
  const [confirming, setConfirming] = useState<Confirming | null>(null)
  const [revisions, setRevisions] = useState<Revision[] | null>(null)
  const [logs, setLogs] = useState<ReviewLog[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 操作の結果を出す決まった場所（操作の原則4）。次の操作で消える。
  const [notice, setNotice] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const images = entry.attachments.filter((a) => a.kind === 'image')

  const tabs: { value: Tab; label: string }[] = [
    { value: 'body', label: ja.entry.tabBody },
    { value: 'reviewlog', label: ja.entry.tabReviewLog },
    { value: 'history', label: ja.entry.tabHistory },
    { value: 'images', label: ja.entry.tabImages },
  ]

  // 履歴と復習の記録は、その表示に切り替えたときに読む（開くたびに取り直す——
  // 評価や保存のあとの状態をそのまま見せるため）。
  useEffect(() => {
    let alive = true
    if (tab === 'history') {
      setRevisions(null)
      api
        .revisions(entry.id)
        .then((res) => alive && setRevisions(res.revisions))
        .catch((e) => alive && setError(e instanceof Error ? e.message : ja.error.generic))
    }
    if (tab === 'reviewlog') {
      setLogs(null)
      api
        .reviewLogs(entry.id)
        .then((res) => alive && setLogs(res.logs))
        .catch((e) => alive && setError(e instanceof Error ? e.message : ja.error.generic))
    }
    return () => {
      alive = false
    }
  }, [tab, entry.id, entry.body_md, entry.retired_at])

  /** ある版の内容に戻す。履歴は消さず、いまの内容が新しい版として積まれる＝戻せるので確認しない。 */
  async function revertTo(r: Revision) {
    setError(null)
    try {
      const res = await api.updateEntry(entry.id, { title: r.title, body_md: r.body_md })
      onChanged(res.entry)
      setNotice(ja.entry.historyReverted)
    } catch (e) {
      setError(e instanceof Error ? e.message : ja.error.generic)
    }
  }

  /**
   * 復習を終える／再開する。どちらも相手側の操作で戻せるので確認は出さず、
   * 画面を先に変えてから送る（楽観的更新。操作の原則5）。失敗したら元へ戻す。
   */
  async function toggleRetire() {
    const before = entry
    const retiring = !entry.retired_at
    setError(null)
    setNotice(null)
    // 仮の終了時刻は画面が見ている学習日にしておく（本物はサーバーの返事で置き換わる）。
    onChanged({ ...entry, retired_at: retiring ? `${today}T00:00:00` : null })
    try {
      const res = retiring ? await api.retire(entry.id) : await api.unretire(entry.id)
      onChanged(res.entry)
    } catch (e) {
      onChanged(before)
      setError(e instanceof Error ? e.message : ja.error.generic)
    }
  }

  /** 記録そのものを消す。本文・画像・録音・復習の記録も一緒に消え、元に戻せない。 */
  async function removeEntry() {
    setConfirming(null)
    try {
      await api.deleteEntry(entry.id)
      onDeleted?.(entry.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : ja.error.generic)
    }
  }

  /** 復習の予定を最初からやり直す（編集フォームの同じチェックと同じ処理）。 */
  async function resetSchedule() {
    setConfirming(null)
    try {
      const res = await api.updateEntry(entry.id, { reset_schedule: true })
      onChanged(res.entry)
      setNotice(ja.review.logReset)
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

  /**
   * メニューの項目を押したときの共通処理。閉じ、フォーカスを「⋯」へ返してから実行する。
   * 返しておかないと、続けて開く確認ダイアログが「閉じたあとの戻し先」を失う
   * （押した項目は閉じた時点で DOM から消えている）。
   */
  function fromMenu(run: () => void) {
    setMenuOpen(false)
    moreButton.current?.focus()
    run()
  }

  return (
    <article class="card entry-card">
      <header class="card-head">
        <h2 class="card-title">{entry.headline}</h2>
      </header>
      <p class="status-line">{statusLine()}</p>

      {/*
        操作の帯。左が表示の切り替え（名詞・セグメント）、右が行為（動詞・ボタン）。
        編集中は切り替えを無効にして位置だけ残す（消すと右の行為の座標が動く）。
      */}
      <div class="entry-toolbar">
        <Segmented
          label={ja.entry.tabsLabel}
          options={tabs}
          value={tab}
          onChange={setTab}
          disabled={editing}
        />
        <div class="entry-tools">
          {editing ? (
            <>
              <button
                type="button"
                class="button toggle"
                onClick={() => {
                  controls?.cancel()
                  setEditing(false)
                }}
              >
                {ja.entry.cancel}
              </button>
              <button
                type="button"
                class="button toggle primary"
                disabled={!controls?.canSave || controls?.saving}
                onClick={() => controls?.save()}
              >
                {controls?.saving ? ja.entry.saving : ja.entry.save}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                class="button toggle"
                onClick={() => {
                  setTab('body')
                  setNotice(null)
                  setEditing(true)
                }}
              >
                {ja.entry.edit}
              </button>
              <MoreMenu buttonRef={moreButton} open={menuOpen} onOpenChange={setMenuOpen}>
                <button
                  type="button"
                  role="menuitem"
                  class="menu-item"
                  onClick={() => fromMenu(() => setTab('images'))}
                >
                  {ja.attachments.manage}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class="menu-item"
                  onClick={() => fromMenu(() => void toggleRetire())}
                >
                  {/* 可逆性は、項目名が「復習を再開する」に変わることで示す（注釈は置かない）。 */}
                  {entry.retired_at ? ja.entry.unretire : ja.entry.retire}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class="menu-item"
                  onClick={() => fromMenu(() => setConfirming('resetSchedule'))}
                >
                  {ja.entry.resetScheduleAction}
                </button>
                {/*
                  ここから下は「記録そのものを消す」操作。上の「復習を終える」（予定を
                  止めるだけ）とは結果が違うので、区切り線で分けて最下部に置く。違いは
                  確認ダイアログの本文で述べる（メニューの項目は 1 行の動詞だけにする）。
                */}
                <hr class="more-menu-sep" />
                <button
                  type="button"
                  role="menuitem"
                  class="menu-item danger"
                  onClick={() => fromMenu(() => setConfirming('delete'))}
                >
                  {ja.entry.delete}
                </button>
              </MoreMenu>
            </>
          )}
        </div>
      </div>

      {notice && <p class="status-line entry-notice">{notice}</p>}
      {error && <p class="error">{ja.error.prefix}{error}</p>}

      <div class="card-panel" role="tabpanel">
        {editing ? (
          <EntryEditor
            initial={{
              // 見出し欄は空にせず、いまの見出しを入れて出す。明示の見出しが無い記録では
              // 本文の先頭1文から作った見出し（headline）を入れる。触らずに保存すれば
              // 「本文の先頭1文に追随する」ままになる（EntryEditor が同じ文字列を null に直す）。
              title: entry.title ?? entry.headline,
              body_md: entry.body_md,
              review_enabled: entry.review_enabled === 1,
            }}
            submitLabel={ja.entry.save}
            showResetSchedule
            editing
            draftKey={editEntryDraftKey(entry.id)}
            recorder={{ dayDate: entry.day_date }}
            onControls={setControls}
            onCancel={() => setEditing(false)}
            onSubmit={async (v) => {
              const res = await api.updateEntry(entry.id, {
                title: v.title,
                body_md: v.body_md,
                review_enabled: v.review_enabled,
                reset_schedule: v.reset_schedule,
                transcription_job_ids: v.transcription_job_ids,
              })
              onChanged(res.entry)
              setEditing(false)
            }}
          />
        ) : tab === 'body' ? (
          <>
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
            <div
              class="card-body prose"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.body_md) }}
            />
          </>
        ) : tab === 'images' ? (
          <Attachments
            entryId={entry.id}
            attachments={entry.attachments}
            onChanged={(attachments) => onChanged({ ...entry, attachments })}
          />
        ) : tab === 'reviewlog' ? (
          <div class="reviewlog">
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
        ) : revisions === null ? (
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
                      class="button"
                      disabled={isCurrent}
                      onClick={() => void revertTo(r)}
                    >
                      {ja.entry.historyRevert}
                    </button>
                  </div>
                  <div
                    class="history-body prose"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(r.body_md) }}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}

      {confirming === 'delete' && (
        <ConfirmDialog
          title={ja.entry.deleteDialogTitle}
          body={ja.entry.deleteDialogBody}
          confirmLabel={ja.entry.delete}
          danger
          onConfirm={() => void removeEntry()}
          onCancel={() => setConfirming(null)}
        />
      )}
      {confirming === 'resetSchedule' && (
        <ConfirmDialog
          title={ja.entry.resetScheduleDialogTitle}
          body={ja.entry.resetScheduleDialogBody}
          confirmLabel={ja.entry.resetScheduleAction}
          danger
          onConfirm={() => void resetSchedule()}
          onCancel={() => setConfirming(null)}
        />
      )}
    </article>
  )
}
