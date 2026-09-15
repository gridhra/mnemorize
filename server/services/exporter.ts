// Markdown / JSON 書き出し（要件 P2、J9）。
import { mkdir, copyFile, writeFile, rename, unlink } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { getDb, dataDir } from '../db/connection.ts'
import { headlineOf, type AttachmentRow, type EntryRow, type ScheduleRow } from './entries.ts'
import { getSettings } from './settings.ts'
import { calendarDate, now as clockNow, toLocalIso } from '../adapters/clock.ts'

export type ExportResult = {
  path: string
  files: string[]
  bytes: number
  /** 書き出せなかった画像など、途中で起きた問題の一覧（空なら問題なし）。 */
  warnings: string[]
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * 一時名に書いてから rename する（原子的な書き出し）。
 * 途中で失敗したときに、中途半端な内容のファイルが完成品の名前で残らないようにする。
 */
async function writeFileAtomic(filePath: string, text: string): Promise<void> {
  const tmpPath = `${filePath}.tmp-${Bun.randomUUIDv7()}`
  try {
    await writeFile(tmpPath, text, 'utf8')
    await rename(tmpPath, filePath)
  } catch (e) {
    await unlink(tmpPath).catch(() => {})
    throw e
  }
}

/** 書き出し先の起点ディレクトリ（`<データディレクトリ>/export`）。 */
export function exportRoot(): string {
  return join(dataDir(), 'export')
}

/** entry 1 件分の Markdown の節を組み立てる（見出し・本文・画像・末尾コメント）。 */
function renderEntrySection(entry: EntryRow, schedule: ScheduleRow | null, attachments: AttachmentRow[]): string {
  const title = entry.title && entry.title.trim() ? entry.title.trim() : headlineOf(null, entry.body_md)
  const heading = title.length > 0 ? title : '（無題）'
  let out = `## ${heading}\n\n${entry.body_md}\n\n`
  for (const a of attachments) {
    const ext = extname(a.rel_path)
    out += `![](../attachments/${a.id}${ext})\n`
  }
  if (attachments.length > 0) out += '\n'
  out += `<!-- mnemorize: id=${entry.id}, due=${schedule?.due ?? ''}, reps=${schedule?.reps ?? 0}, lapses=${schedule?.lapses ?? 0}, retired=${entry.retired_at ? 'true' : 'false'} -->\n\n`
  return out
}

/**
 * Markdown 書き出し。1 日 1 ファイル `export/YYYY/YYYY-MM-DD.md`。
 * 画像は `export/attachments/` へコピーし、`../attachments/…` の相対リンクにする。
 */
export async function exportMarkdown(): Promise<ExportResult> {
  const db = getDb()
  const root = exportRoot()
  const attachDir = join(root, 'attachments')
  await mkdir(attachDir, { recursive: true })

  const days = db
    .query<{ day_date: string }, []>('SELECT DISTINCT day_date FROM entries ORDER BY day_date')
    .all()

  const files: string[] = []
  const warnings: string[] = []
  let bytes = 0

  for (const { day_date } of days) {
    const entries = db
      .query<EntryRow, [string]>(
        `SELECT id, day_date, title, body_md, review_enabled, retired_at,
           created_at, updated_at, sort_order, schedule_reset_at
         FROM entries WHERE day_date = ? ORDER BY sort_order, created_at`,
      )
      .all(day_date)

    let md = `---\ndate: ${day_date}\n---\n\n`
    for (const entry of entries) {
      const schedule = db
        .query<ScheduleRow, [string]>('SELECT * FROM schedule_state WHERE entry_id = ?')
        .get(entry.id)
      const attachments = db
        .query<AttachmentRow, [string]>(
          `SELECT * FROM attachments WHERE entry_id = ? AND kind = 'image' ORDER BY created_at`,
        )
        .all(entry.id)
      // 画像が 1 つ欠けても書き出し全体を止めない。欠けたものは warnings に記録して飛ばす。
      const copied: AttachmentRow[] = []
      for (const a of attachments) {
        try {
          await copyFile(join(dataDir(), a.rel_path), join(attachDir, `${a.id}${extname(a.rel_path)}`))
          copied.push(a)
        } catch {
          warnings.push(`画像を書き出せませんでした（${day_date} / ${a.rel_path}）`)
        }
      }
      md += renderEntrySection(entry, schedule ?? null, copied)
    }

    const year = day_date.slice(0, 4)
    const dayDir = join(root, year)
    await mkdir(dayDir, { recursive: true })
    const filePath = join(dayDir, `${day_date}.md`)
    await writeFileAtomic(filePath, md)
    files.push(filePath)
    bytes += Buffer.byteLength(md, 'utf8')
  }

  return { path: root, files, bytes, warnings }
}

/** JSON 全量書き出し。1 ファイル `export/mnemorize-export-YYYYMMDD-HHmm.json`。 */
export async function exportJson(now: Date = clockNow()): Promise<ExportResult> {
  const db = getDb()
  const root = exportRoot()
  await mkdir(root, { recursive: true })

  const payload = {
    schema_version: 1,
    exported_at: toLocalIso(now),
    entries: db.query('SELECT * FROM entries').all(),
    entry_revisions: db.query('SELECT * FROM entry_revisions').all(),
    attachments: db.query('SELECT * FROM attachments').all(),
    review_logs: db.query('SELECT * FROM review_logs').all(),
    schedule_state: db.query('SELECT * FROM schedule_state').all(),
    settings: getSettings(),
  }

  const stamp = `${calendarDate(now).replace(/-/g, '')}-${pad(now.getHours())}${pad(now.getMinutes())}`
  const filePath = join(root, `mnemorize-export-${stamp}.json`)
  const text = JSON.stringify(payload, null, 2)
  await writeFileAtomic(filePath, text)

  return { path: root, files: [filePath], bytes: Buffer.byteLength(text, 'utf8'), warnings: [] }
}
