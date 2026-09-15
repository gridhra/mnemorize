// 書き出し（Markdown / JSON）とスナップショット作成。ロジックは services 側にある。
import { Hono } from 'hono'
import { exportJson, exportMarkdown } from '../services/exporter.ts'
import { createSnapshot } from '../services/snapshot.ts'
import { now as clockNow } from '../adapters/clock.ts'
import { openInFinder } from '../adapters/finder.ts'
import { ValidationError } from '../services/entries.ts'

const app = new Hono()

// 時刻は必ず clock アダプタから取る（MNEMORIZE_FAKE_NOW を効かせるため）。
app.get('/markdown', async (c) => c.json(await exportMarkdown()))
app.get('/json', async (c) => c.json(await exportJson(clockNow())))
app.post('/snapshot', async (c) => c.json(await createSnapshot(clockNow())))

// 設定画面「Finder で開く」。データ置き場配下のパスだけ許可する（finder アダプタ側で検証）。
app.post('/open', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw new ValidationError('JSON の本文が読めません')
  }
  const path = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).path : undefined
  if (typeof path !== 'string' || path.length === 0) {
    throw new ValidationError('path を文字列で指定してください')
  }
  await openInFinder(path)
  return c.json({ ok: true })
})

export default app
