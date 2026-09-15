// 記録の作成・更新・履歴・卒業。ロジックは services/entries.ts にある。
import { Hono } from 'hono'
import {
  ValidationError,
  createEntry,
  deleteEntry,
  getEntry,
  listRevisions,
  retireEntry,
  unretireEntry,
  updateEntry,
} from '../services/entries.ts'

const app = new Hono()

async function jsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw new ValidationError('JSON の本文が読めません')
  }
  if (typeof body !== 'object' || body === null) throw new ValidationError('JSON オブジェクトを送ってください')
  return body as Record<string, unknown>
}

app.post('/', async (c) => {
  const body = await jsonBody(c)
  const entry = createEntry({
    day_date: body.day_date as string | undefined,
    title: (body.title as string | null | undefined) ?? undefined,
    body_md: (body.body_md as string | undefined) ?? '',
    review_enabled: body.review_enabled as boolean | undefined,
  })
  return c.json({ entry }, 201)
})

app.get('/:id', (c) => c.json({ entry: getEntry(c.req.param('id')) }))

app.patch('/:id', async (c) => {
  const body = await jsonBody(c)
  const entry = updateEntry(c.req.param('id'), {
    title: 'title' in body ? (body.title as string | null) : undefined,
    body_md: 'body_md' in body ? String(body.body_md ?? '') : undefined,
    review_enabled: body.review_enabled as boolean | undefined,
    reset_schedule: body.reset_schedule as boolean | undefined,
  })
  return c.json({ entry })
})

app.get('/:id/revisions', (c) => c.json({ revisions: listRevisions(c.req.param('id')) }))

app.delete('/:id', async (c) => {
  await deleteEntry(c.req.param('id'))
  return c.json({ ok: true })
})

app.post('/:id/retire', (c) => c.json({ entry: retireEntry(c.req.param('id')) }))
app.post('/:id/unretire', (c) => c.json({ entry: unretireEntry(c.req.param('id')) }))

export default app
