// 書き出し（Markdown / JSON）とスナップショット作成。ロジックは services 側にある。
import { Hono } from 'hono'
import { exportJson, exportMarkdown } from '../services/exporter.ts'
import { createSnapshot } from '../services/snapshot.ts'
import { now as clockNow } from '../adapters/clock.ts'

const app = new Hono()

// 時刻は必ず clock アダプタから取る（MNEMORIZE_FAKE_NOW を効かせるため）。
app.get('/markdown', async (c) => c.json(await exportMarkdown()))
app.get('/json', async (c) => c.json(await exportJson(clockNow())))
app.post('/snapshot', async (c) => c.json(await createSnapshot(clockNow())))

export default app
