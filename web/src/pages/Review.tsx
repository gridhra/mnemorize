// 「復習」画面（設計書 §7 の 2）。今日期限が来ている記録を 1 件ずつ出し、3 段階で自己評価する。
import { useEffect, useState } from 'preact/hooks'
import { api, type ReviewQueue } from '../api.ts'
import { ja, formatJapaneseDate } from '../i18n/ja.ts'
import { ReviewCard } from '../components/ReviewCard.tsx'

type Props = {
  /** 評価・卒業のあとにタブの残件数バッジを更新してもらうための知らせ。 */
  onQueueChanged?: () => void
}

export function Review({ onQueueChanged }: Props) {
  const [queue, setQueue] = useState<ReviewQueue | null>(null)
  const [index, setIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // 直前に評価した記録の id。取り消し（undo）できるのはこの 1 件だけ。
  const [undoableEntryId, setUndoableEntryId] = useState<string | null>(null)
  const [undoing, setUndoing] = useState(false)

  useEffect(() => {
    let alive = true
    api
      .reviewsToday()
      .then((q) => {
        if (!alive) return
        setQueue(q)
        setIndex(0)
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : ja.error.generic))
    return () => {
      alive = false
    }
  }, [])

  function advance(message: string | null, undoableId: string | null) {
    setNotice(message)
    setUndoableEntryId(undoableId)
    setIndex((i) => i + 1)
    onQueueChanged?.()
  }

  /** 直前の評価を取り消して、その記録をキューの先頭（次に出すカード）に戻す。 */
  async function undo() {
    if (!undoableEntryId || undoing) return
    setUndoing(true)
    setError(null)
    try {
      await api.undoReview(undoableEntryId)
      setIndex((i) => Math.max(0, i - 1))
      setNotice(ja.review.undone)
      setUndoableEntryId(null)
      onQueueChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : ja.error.generic)
    } finally {
      setUndoing(false)
    }
  }

  if (error) {
    return (
      <div class="page">
        <p class="error">
          {ja.error.prefix}
          {error}
        </p>
      </div>
    )
  }

  if (!queue) {
    return (
      <div class="page">
        <p class="muted">{ja.review.loading}</p>
      </div>
    )
  }

  const total = queue.items.length
  const current = queue.items[index]
  const done = Math.min(index, total)

  return (
    <div class="page">
      <div class="review-head">
        <h1 class="day-title">{ja.review.progress(done, total)}</h1>
        {queue.carried_over > 0 && (
          <span class="badge" title={ja.review.carriedOverHint}>
            {ja.review.carriedOver(queue.carried_over)}
          </span>
        )}
      </div>

      {(notice || undoableEntryId) && (
        <p class="muted review-notice">
          {notice}
          {undoableEntryId && (
            <button
              type="button"
              class="button ghost review-undo"
              disabled={undoing}
              onClick={() => void undo()}
            >
              {ja.review.undo}
            </button>
          )}
        </p>
      )}

      {total === 0 ? (
        <p class="muted empty">{ja.review.empty}</p>
      ) : current ? (
        <ReviewCard
          key={current.entry.id}
          item={current}
          onRated={(res) =>
            advance(
              res.auto_retired
                ? ja.review.autoRetired
                : ja.review.recorded(formatJapaneseDate(res.next_due_date)),
              current.entry.id,
            )
          }
          onRetired={() => advance(ja.review.retired, null)}
        />
      ) : (
        <div class="review-finished">
          <p class="empty">{ja.review.finished}</p>
          {queue.carried_over > 0 && (
            <p class="muted">{ja.review.finishedCarriedOver(queue.carried_over)}</p>
          )}
        </div>
      )}
    </div>
  )
}
