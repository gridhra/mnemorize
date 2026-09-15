// 全文検索。日本語には単語境界がないため FTS5 の trigram トークナイザを使う（要件 J6）。
// trigram は 3 文字以上しか索引しないので、2 文字以下の検索語は LIKE にフォールバックする。
import { getDb } from '../db/connection.ts'
import { headlineOf } from './entries.ts'

export type SearchHit = {
  entry_id: string
  day_date: string
  title: string | null
  headline: string
  excerpt: string
  matched_in: 'body' | 'title' | 'transcription'
}

/** FTS5 の検索式に渡すため、二重引用符で囲んだフレーズにする。 */
function asPhrase(q: string): string {
  return `"${q.replace(/"/g, '""')}"`
}

function excerptAround(text: string, needle: string, width = 40): string {
  const i = text.toLowerCase().indexOf(needle.toLowerCase())
  if (i < 0) return text.slice(0, width * 2)
  const start = Math.max(0, i - width)
  const end = Math.min(text.length, i + needle.length + width)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

export function search(rawQuery: string, limit = 50): SearchHit[] {
  const q = rawQuery.trim()
  if (q.length === 0) return []
  const db = getDb()

  type Raw = { entry_id: string; day_date: string; title: string | null; body_md: string; raw_text: string | null }
  let rows: Raw[]

  if (q.length >= 3) {
    rows = db
      .query<Raw, [string, number]>(
        `SELECT f.entry_id AS entry_id, e.day_date AS day_date, e.title AS title,
                e.body_md AS body_md, f.raw_text AS raw_text
           FROM entry_fts f
           JOIN entries e ON e.id = f.entry_id
          WHERE entry_fts MATCH ?
          ORDER BY e.day_date DESC, e.sort_order DESC
          LIMIT ?`,
      )
      .all(asPhrase(q), limit)
  } else {
    // 2 文字以下：trigram の索引が効かないので LIKE で走査する。
    const like = `%${q.replace(/([%_\\])/g, '\\$1')}%`
    rows = db
      .query<Raw, [string, string, string, number]>(
        `SELECT e.id AS entry_id, e.day_date AS day_date, e.title AS title,
                e.body_md AS body_md,
                (SELECT GROUP_CONCAT(raw_text, ' ') FROM transcription_jobs t WHERE t.entry_id = e.id) AS raw_text
           FROM entries e
          WHERE e.body_md LIKE ? ESCAPE '\\'
             OR COALESCE(e.title, '') LIKE ? ESCAPE '\\'
             OR EXISTS (SELECT 1 FROM transcription_jobs t
                         WHERE t.entry_id = e.id AND COALESCE(t.raw_text, '') LIKE ? ESCAPE '\\')
          ORDER BY e.day_date DESC, e.sort_order DESC
          LIMIT ?`,
      )
      .all(like, like, like, limit)
  }

  return rows.map((r) => {
    const inTitle = (r.title ?? '').toLowerCase().includes(q.toLowerCase())
    const inBody = r.body_md.toLowerCase().includes(q.toLowerCase())
    const source = inBody ? r.body_md : inTitle ? (r.title ?? '') : (r.raw_text ?? r.body_md)
    return {
      entry_id: r.entry_id,
      day_date: r.day_date,
      title: r.title,
      // 手がかり文の作り方は entries.ts の headlineOf 1 か所に寄せる
      // （別実装だと、同じ記録の見出しが検索結果と日付一覧で違って見える）。
      headline: headlineOf(r.title, r.body_md),
      excerpt: excerptAround(source, q),
      matched_in: inBody ? 'body' : inTitle ? 'title' : 'transcription',
    }
  })
}
