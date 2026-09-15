// 復習キューと評価の記録。ロジックは services/reviews.ts にある。
import { Hono } from 'hono'
import { ValidationError } from '../services/entries.ts'
import { listReviewLogs, submitReview, todayQueue, undoLastReview } from '../services/reviews.ts'
import { isReviewRating } from '../services/scheduler.ts'

const app = new Hono()

/** 今日の復習キュー（上限適用後）と、繰り越し件数。 */
app.get('/today', (c) => c.json(todayQueue()))

/** 評価を記録する。`{entry_id, rating: 1|3|4}` */
app.post('/', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw new ValidationError('JSON の本文が読めません')
  }
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError('JSON オブジェクトを送ってください')
  }
  const { entry_id: entryId, rating } = body as { entry_id?: unknown; rating?: unknown }
  if (typeof entryId !== 'string' || entryId.length === 0) {
    throw new ValidationError('entry_id を指定してください')
  }
  if (!isReviewRating(rating)) {
    throw new ValidationError('rating は 1（思い出せなかった）3（思い出せた）4（余裕だった）のいずれかです')
  }
  return c.json(submitReview(entryId, rating))
})

/** 直前の評価の取り消し。 */
app.post('/:entry_id/undo', (c) => c.json(undoLastReview(c.req.param('entry_id'))))

/** 記録 1 件の復習履歴。 */
app.get('/:entry_id/logs', (c) => c.json({ logs: listReviewLogs(c.req.param('entry_id')) }))

export default app
