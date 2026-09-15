// 復習 1 件のカード（要件 R2）。
// 流れ：手がかりだけを見せる → ユーザーが思い出す →「開く」で本文と画像 → 3 段階の自己評価。
//
// 繰り返す操作は帯に固定する（操作の原則11c）。カードは 3 段で、上から
// 見出し行（見出しと、その右端の「復習を終える」）／内容（高さ固定・中だけスクロール）／
// 操作の帯。帯には、開く前は「思い出せたら開く」、開いた後は評価の 3 ボタンが出る。
// 内容の高さを固定してあるので、本文が長い記録でも短い記録でも帯の座標は同じで、
// 何十件も続けて評価するときに押す場所が動かない。
//
// 開く前の内容領域は「カードの表面」である。以前は 18rem の枠の真ん中に促しの一文が
// 1 つ浮くだけで空洞に見えたので、見出し（大きめ）・手がかりの 1 行・促しの一文を
// 縦に積んだ面にした（2026-09-15の指摘）。「復習を終える」は開閉で位置を変えない。
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

/**
 * 「書き足す」欄の高さを中身に合わせる。1 行から始めて、入ったぶんだけ伸ばす。
 * 高さは実行時にしか決まらないので、例外的に style を直に書く（06 文書 §9.3）。
 */
function grow(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

export function ReviewCard({ item, onRated, onRetired }: Props) {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [noteSaved, setNoteSaved] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const [body, setBody] = useState(item.entry.body_md)
  const openButton = useRef<HTMLButtonElement>(null)
  const noteInput = useRef<HTMLTextAreaElement>(null)
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
      // 空に戻したら高さも 1 行に戻す。
      if (noteInput.current) {
        noteInput.current.value = ''
        grow(noteInput.current)
      }
      setNoteSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : ja.error.generic)
    } finally {
      setSavingNote(false)
    }
  }

  /** 復習を終える。記録カードの「復習を再開する」で戻せるので確認は出さない（原則3）。 */
  async function retire() {
    if (busy) return
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
      {/* 見出し行。右端の「復習を終える」は評価の帯の外で、開閉しても位置が変わらない。 */}
      <header class="card-head review-head">
        <h2 class="card-title">{item.entry.headline}</h2>
        <button type="button" class="button toggle" disabled={busy} onClick={() => void retire()}>
          {ja.review.retire}
        </button>
      </header>

      {/* 内容領域。高さを固定し、中だけをスクロールさせる（下の帯を動かさないため）。 */}
      <div class="review-content">
        {!opened ? (
          /* カードの表面。見出し・手がかりの 1 行・促しの一文を縦に積んで中央に置く。 */
          <div class="review-face">
            <p class="review-face-cue">
              {ja.review.cueLine(
                formatJapaneseDate(item.entry.day_date),
                images.length,
                item.schedule.reps + 1,
              )}
            </p>
            <p class="review-face-prompt">{ja.review.recallPrompt}</p>
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

            {/*
              書き足す欄は本文を圧迫しないよう 1 行から始め、入力に応じて伸ばす。
              ラベルは placeholder に畳み、「書き足す」は同じ行の右に置く。
            */}
            <div class="review-note">
              <textarea
                class="textarea review-note-input"
                rows={1}
                ref={noteInput}
                value={note}
                aria-label={ja.review.appendLabel}
                placeholder={ja.review.appendLabel}
                onInput={(e) => {
                  const el = e.target as HTMLTextAreaElement
                  setNote(el.value)
                  grow(el)
                }}
                onKeyDown={(e) => {
                  if (ime.shouldIgnoreKey(e)) return
                  if (isSaveShortcut(e)) {
                    e.preventDefault()
                    void saveNote()
                  }
                }}
                {...ime.handlers}
              />
              <button
                type="button"
                class="button"
                disabled={savingNote || note.trim().length === 0}
                onClick={() => void saveNote()}
              >
                {savingNote ? ja.review.appendSaving : ja.review.appendSave}
              </button>
            </div>
            {noteSaved && <small class="hint review-note-saved">{ja.review.appendSaved}</small>}
          </>
        )}
      </div>

      {/* 操作の帯。開く前と開いた後で中身が入れ替わるだけで、座標は変わらない。 */}
      <div class="review-actionbar">
        {!opened ? (
          <button
            type="button"
            class="button primary review-open-button"
            ref={openButton}
            onClick={open}
          >
            {ja.review.open}
          </button>
        ) : (
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
        )}
        <small class="hint review-key-hint">{opened ? ja.review.keyHint : ja.review.openHint}</small>
      </div>

      {error && (
        <p class="error">
          {ja.error.prefix}
          {error}
        </p>
      )}
    </article>
  )
}
