// 設定の取得と更新。
import { Hono } from 'hono'
import { getSettings, putSettings } from '../services/settings.ts'

const app = new Hono()

app.get('/', (c) => c.json({ settings: getSettings() }))

app.put('/', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'JSON の本文が読めません' }, 400)
  }
  if (typeof body !== 'object' || body === null) return c.json({ error: 'JSON オブジェクトを送ってください' }, 400)
  const patch = 'settings' in body ? (body as Record<string, unknown>).settings : body
  return c.json({ settings: putSettings(patch as Record<string, unknown>) })
})

export default app
