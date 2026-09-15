// 起動。ポートとデータディレクトリを解決し、DB を初期化してから待ち受ける。
import { createApp } from './app.ts'
import { dataDir, dbPath, getDb } from './db/connection.ts'

const port = Number(process.env.MNEMORIZE_PORT ?? 8790)
const serveStaticWeb = process.env.MNEMORIZE_SERVE_STATIC === '1'

getDb() // ディレクトリ作成とマイグレーションをここで済ませる

const app = createApp({ serveStaticWeb })

export default { port, fetch: app.fetch }

console.log(`[mnemorize] データディレクトリ: ${dataDir()}`)
console.log(`[mnemorize] DB: ${dbPath()}`)
console.log(`[mnemorize] http://localhost:${port}${serveStaticWeb ? '' : '/api/health'}`)
