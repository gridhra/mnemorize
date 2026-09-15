// 復習 1 件のカード（要件 R2）。
// 流れ：手がかりだけを見せる → ユーザーが思い出す →「開く」で本文と画像 → 3 段階の自己評価。
import { useEffect, useRef, useState } from 'preact/hooks'
import { api, type ReviewItem, type ReviewRating } from '../api.ts'
import { ja, formatJapaneseDate } from '../i18n/ja.ts'
import { renderMarkdown } from '../markdown.ts'
import { isSaveShortcut, useIme } from '../hooks/ime.ts'

type Props = {
  item: ReviewItem
  /** 評価を記録し終えたら呼ぶ。次のカードへ進む。 */
  onRated: (result: { next_due_date: string; interval_days: number; auto_retired: boolean }) => void
  /** もう復習しないことにしたら呼ぶ。キューから外す。 */
  onRetired: () => void
}

/** 「9月18日（金）」の形。予告の日付は学習日（YYYY-MM-DD）で来る。 */
const jpDate = (date: string) => formatJapaneseDate(date)

export function ReviewCard({ item, onRated, onRetired }: Props) {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [noteSaved, setNoteSaved] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const [body, setBody] = useState(item.entry.body_md)
  const openButton = useRef<HTMLButtonElement>(null)
  // キーボード処理は window に 1 つだけ付けるので、最新の状態は ref で見る
  // （state を依存配列に入れると、開いた直後の打鍵が古い処理関数に届くことがある）。
  const openedRef = useRef(false)
  const busyRef = useRef(false)
  const ime = useIme()

  function open() {
    openedRef.current = true
    setOpened(true)
  }

  // 次のカードに移ったら、必ず「閉じた」状態から始める。
  useEffect(() => {
    openedRef.current = false
    setOpened(false)
    setNote('')
    setNoteSaved(false)
    setError(null)
    setBody(item.entry.body_md)
    openButton.current?.focus()
  }, [item.entry.id])

  async function rate(rating: ReviewRating) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await api.submitReview(item.entry.id, rating)
      onRated({
        next_due_date: res.next_due_date,
        interval_days: res.interval_days,
        auto_retired: res.auto_retired,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : ja.error.generic)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function saveNote() {
    if (savingNote || note.trim().length === 0) return
    setSavingNote(true)
    setError(null)
    try {
      // 追記は本文の末尾に足す。ふつうの加筆修正なので復習の履歴はリセットしない（要件 R5）。
      const next = `${body.replace(/\s+$/, '')}\n\n${note.trim()}`
      const res = await api.updateEntry(item.entry.id, { body_md: next })
      setBody(res.entry.body_md)
      setNote('')
      setNoteSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : ja.error.generic)
    } finally {
      setSavingNote(false)
    }
  }

  async function retire() {
    if (busy) return
    if (!confirm(ja.review.retireConfirm)) return
    setBusy(true)
    try {
      await api.retire(item.entry.id)
      onRetired()
    } catch (e) {
      setError(e instanceof Error ? e.message : ja.error.generic)
    } finally {
      setBusy(false)
    }
  }

  // キーボード：1 / 2 / 3 で評価、Space または Enter で「開く」。
  // 入力欄にフォーカスがあるときと、日本語 IME の変換中は無効（要件 J5）。
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (ime.shouldIgnoreKey(e)) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (!openedRef.current) {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          open()
        }
        return
      }
      if (e.key === '1') {
        e.preventDefault()
        void rate(1)
      } else if (e.key === '2') {
        e.preventDefault()
        void rate(3)
      } else if (e.key === '3') {
        e.preventDefault()
        void rate(4)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [item.entry.id])

  const images = item.entry.attachments.filter((a) => a.kind === 'image')

  const buttons: {
    rating: ReviewRating
    label: string
    criterion: string
    date: string
    days: number
    key: string
  }[] = [
    {
      rating: 1,
      label: ja.review.again,
      criterion: ja.review.againCriterion,
      date: item.preview.again.date,
      days: item.preview.again.interval_days,
      key: '1',
    },
    {
      rating: 3,
      label: ja.review.good,
      criterion: ja.review.goodCriterion,
      date: item.preview.good.date,
      days: item.preview.good.interval_days,
      key: '2',
    },
    {
      rating: 4,
      label: ja.review.easy,
      criterion: ja.review.easyCriterion,
      date: item.preview.easy.date,
      days: item.preview.easy.interval_days,
      key: '3',
    },
  ]

  return (
    <article class="card review-card">
      <header class="card-head">
        <h2 class="card-title">{item.entry.headline}</h2>
      </header>
      <p class="status-line review-cue">
        {ja.review.cueLine(
          formatJapaneseDate(item.entry.day_date),
          images.length,
          item.schedule.reps + 1,
        )}
      </p>

      {!opened ? (
        <div class="review-open">
          <p class="muted review-recall-prompt">{ja.review.recallPrompt}</p>
          <button
            type="button"
            class="button primary review-open-button"
            ref={openButton}
            onClick={open}
          >
            {ja.review.open}
          </button>
          <small class="hint">{ja.review.openHint}</small>
        </div>
      ) : (
        <>
          <div class="card-body prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />

          {images.length > 0 && (
            <div class="review-images">
              {images.map((a) => (
                <img key={a.id} src={`/files/${a.rel_path}`} alt="" loading="lazy" />
              ))}
            </div>
          )}

          <label class="field review-note">
            <span class="field-label">{ja.review.appendLabel}</span>
            <textarea
              class="textarea"
              rows={3}
              value={note}
              placeholder={ja.review.appendPlaceholder}
              onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
              onKeyDown={(e) => {
                if (ime.shouldIgnoreKey(e)) return
                if (isSaveShortcut(e)) {
                  e.preventDefault()
                  void saveNote()
                }
              }}
              {...ime.handlers}
            />
            <div class="review-note-actions">
              {noteSaved && <small class="hint">{ja.review.appendSaved}</small>}
              <span class="spacer" />
              <button
                type="button"
                class="button ghost"
                disabled={savingNote || note.trim().length === 0}
                onClick={() => void saveNote()}
              >
                {savingNote ? ja.review.appendSaving : ja.review.appendSave}
              </button>
            </div>
          </label>

          <div class="rating-grid">
            {buttons.map((b) => (
              <button
                key={b.rating}
                type="button"
                class="button rating-button"
                disabled={busy}
                onClick={() => void rate(b.rating)}
              >
                <span class="rating-label">
                  <span class="rating-key">{b.key}</span>
                  {b.label}
                </span>
                <small class="rating-criterion">{b.criterion}</small>
                <small class="rating-next">{ja.review.nextPreview(jpDate(b.date), b.days)}</small>
              </button>
            ))}
          </div>
          <small class="hint">{ja.review.keyHint}</small>
        </>
      )}

      <footer class="card-actions">
        <button type="button" class="button ghost" disabled={busy} onClick={() => void retire()}>
          {ja.review.retire}
        </button>
      </footer>
      {error && (
        <p class="error">
          {ja.error.prefix}
          {error}
        </p>
      )}
    </article>
  )
}
