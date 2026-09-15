// 日付ビュー。
import { Hono } from 'hono'
import { listDay, listDayCounts } from '../services/entries.ts'
import { localDate, now as clockNow } from '../adapters/clock.ts'
import { boundaryHour } from '../services/settings.ts'

const app = new Hono()

/** GET /api/days?from=&to=  期間内の日ごとの件数 */
app.get('/', (c) => {
  const from = c.req.query('from')
  const to = c.req.query('to')
  if (!from || !to) return c.json({ error: 'from と to が必要です' }, 400)
  return c.json({ days: listDayCounts(from, to) })
})

/** GET /api/days/:date  その日の記録一覧 */
app.get('/:date', (c) => {
  const date = c.req.param('date')
  const resolved = date === 'today' ? localDate(clockNow(), boundaryHour()) : date
  return c.json({ date: resolved, entries: listDay(resolved) })
})

export default app
