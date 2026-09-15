// 全文検索。
import { Hono } from 'hono'
import { search } from '../services/search.ts'

const app = new Hono()

app.get('/', (c) => {
  const q = c.req.query('q') ?? ''
  return c.json({ q, hits: search(q) })
})

export default app
