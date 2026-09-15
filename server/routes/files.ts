// 添付・音声の配信。データディレクトリの中でも attachments/ と audio/ の 2 つだけを出す。
// 書き出し（export/）やスナップショット（snapshots/）、データベース本体は配信しない。
import { Hono } from 'hono'
import { join, normalize } from 'node:path'
import { dataDir } from '../db/connection.ts'

const app = new Hono()

/** 配信してよい接頭辞。添付の rel_path は必ずこのどちらかで始まる。 */
const ALLOWED_PREFIXES = ['attachments/', 'audio/']

app.get('/*', async (c) => {
  const raw = c.req.path.replace(/^\/files\/?/, '')
  let rel: string
  try {
    rel = decodeURIComponent(raw)
  } catch {
    // `%ff` のような壊れたパーセント符号。入力の誤りなので 400 にする。
    return c.json({ error: 'ファイルの指定が正しくありません' }, 400)
  }
  const root = normalize(dataDir())
  const abs = normalize(join(root, rel))
  // 上位ディレクトリへの脱出を防ぐ
  if (!abs.startsWith(`${root}/`)) return c.json({ error: 'アクセスできません' }, 403)
  // 添付と音声の置き場だけを配信する。それ以外は「無い」ものとして扱う。
  const relFromRoot = abs.slice(root.length + 1)
  if (!ALLOWED_PREFIXES.some((p) => relFromRoot.startsWith(p))) {
    return c.json({ error: '見つかりません' }, 404)
  }
  const file = Bun.file(abs)
  if (!(await file.exists())) return c.json({ error: '見つかりません' }, 404)
  return new Response(file)
})

export default app
