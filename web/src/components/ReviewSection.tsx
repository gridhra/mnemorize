// 「今日の復習」の節（今日画面の中）。期限が来た記録を 1 件ずつ出し、3 段階で自己評価する。
// 旧「復習」タブ（pages/Review.tsx）のロジックをここへ移した。
import { useEffect, useState } from 'preact/hooks'
import { api, type ReviewQueue } from '../api.ts'
import { ja, formatJapaneseDate } from '../i18n/ja.ts'
import { addDays } from '../dates.ts'
import { useReviewQueueRefresh } from '../queue-context.ts'
import { ReviewCard } from './ReviewCard.tsx'

/** 「次の復習」の予告（次に期限が来る学習日と、その日の件数）。無ければ null。 */
type NextDue = { date: string; count: number }

export function ReviewSection() {
  const [queue, setQueue] = useState<ReviewQueue | null>(null)
  const [index, setIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // 直前に評価した記録の id。取り消し（undo）できるのはこの 1 件だけ。
  const [undoableEntryId, setUndoableEntryId] = useState<string | null>(null)
  const [undoing, setUndoing] = useState(false)
  // 記録が全体で 1 件も無いか。初回の案内を出すかどうかの判断にだけ使う。
  const [noEntriesAtAll, setNoEntriesAtAll] = useState(false)
  // 「次の復習は◯月◯日にN件」の予告。評価・取り消しのたびに取り直す
  // （queue.next_due_date/next_due_count は最初に取得した時点のままなので、そのつど古くなる）。
  const [nextDue, setNextDue] = useState<NextDue | null>(null)
  const refreshDueCount = useReviewQueueRefresh()

  useEffect(() => {
    let alive = true
    api
      .reviewsToday()
      .then((q) => {
        if (!alive) return
        setQueue(q)
        setIndex(0)
        setNextDue(q.next_due_date ? { date: q.next_due_date, count: q.next_due_count } : null)
        // 復習が今日も先にも無いときだけ、記録が 1 件も無いかを確かめる（初回の案内のため）。
        if (q.items.length === 0 && q.next_due_date === null) {
          api
            .dayCounts('2000-01-01', q.date)
            .then((res) => alive && setNoEntriesAtAll(res.days.length === 0))
            .catch(() => {
              // 数えられなくても復習の節は出す。
            })
        }
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : ja.error.generic))
    return () => {
      alive = false
    }
  }, [])

  /** 「次の復習」の予告を取り直す（評価・取り消しのたびに呼ぶ）。キュー全体は取り直さない。 */
  async function refreshNextDue(today: string) {
    try {
      const { days } = await api.reviewsUpcoming(addDays(today, 1), addDays(today, 60))
      const first = days[0]
      setNextDue(first ? { date: first.date, count: first.count } : null)
    } catch {
      // 予告が更新できなくても復習そのものは続けられる。
    }
  }

  function advance(message: string | null, undoableId: string | null) {
    setNotice(message)
    setUndoableEntryId(undoableId)
    setIndex((i) => i + 1)
    refreshDueCount()
    if (queue) void refreshNextDue(queue.date)
  }

  /** 直前の評価を取り消して、その記録をキューの先頭（次に出すカード）に戻す。 */
  async function undo() {
    if (!undoableEntryId || undoing || !queue) return
    setUndoing(true)
    setError(null)
    try {
      await api.undoReview(undoableEntryId)
      const back = Math.max(0, index - 1)
      setNotice(ja.review.undone)
      setUndoableEntryId(null)
      // 取り消した記録を同じ位置に戻す。キューを丸ごと差し替えると、今日すでに評価した分が
      // 抜けて並びがずれるので、並びは保ったまま、各記録の予告（3 ボタンの次回日）だけを
      // 取り直した値で置き換える。
      const fresh = await api.reviewsToday()
      setQueue((prev) =>
        prev
          ? {
              ...fresh,
              items: prev.items.map((it) => fresh.items.find((n) => n.entry.id === it.entry.id) ?? it),
            }
          : fresh,
      )
      setIndex(back)
      await refreshNextDue(queue.date)
      refreshDueCount()
    } catch (e) {
      setError(e instanceof Error ? e.message : ja.error.generic)
    } finally {
      setUndoing(false)
    }
  }

  const total = queue?.items.length ?? 0
  const current = queue?.items[index]
  const done = Math.min(index, total)

  return (
    <section class="section">
      <div class="section-head">
        <h2 class="section-title">{ja.today.reviewSection}</h2>
        {queue && total > 0 && <span class="section-count">{ja.review.progress(done, total)}</span>}
      </div>

      {error && (
        <p class="error">
          {ja.error.prefix}
          {error}
        </p>
      )}

      {!queue ? (
        <p class="muted">{ja.review.loading}</p>
      ) : (
        <>
          {queue.carried_over > 0 && (
            <p class="muted">{ja.review.carriedOverLine(queue.carried_over, queue.daily_limit)}</p>
          )}

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
            <>
              <p class="muted empty">
                {/* 今日すでに評価した分があれば「終わりました」、無ければ「ありません」。再読み込み後も同じ文になる */}
                {queue && queue.reviewed_today > 0
                  ? nextDue
                    ? ja.review.finishedWithNext(formatJapaneseDate(nextDue.date), nextDue.count)
                    : ja.review.finished
                  : nextDue
                    ? ja.review.emptyWithNext(formatJapaneseDate(nextDue.date), nextDue.count)
                    : ja.review.empty}
              </p>
              {noEntriesAtAll && <p class="muted">{ja.review.firstTimeHint}</p>}
            </>
          ) : current ? (
            <ReviewCard
              key={current.entry.id}
              item={current}
              onRated={(res) =>
                advance(
                  res.auto_retired
                    ? ja.review.autoRetired
                    : ja.review.recorded(
                        formatJapaneseDate(res.next_due_date),
                        res.interval_days,
                      ),
                  current.entry.id,
                )
              }
              onRetired={() => advance(ja.review.retired, null)}
            />
          ) : (
            <p class="muted empty">
              {nextDue
                ? ja.review.finishedWithNext(formatJapaneseDate(nextDue.date), nextDue.count)
                : ja.review.finished}
            </p>
          )}
        </>
      )}
    </section>
  )
}
