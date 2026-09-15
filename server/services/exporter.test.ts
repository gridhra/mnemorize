import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = mkdtempSync(join(tmpdir(), 'mnemorize-export-test-'))
process.env.MNEMORIZE_DATA_DIR = tmp

const { getDb, resetDbCache } = await import('../db/connection.ts')
const { createEntry, retireEntry } = await import('./entries.ts')
const { addAttachment } = await import('./attachments.ts')
const { exportMarkdown, exportJson } = await import('./exporter.ts')

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
function pngFile(name = 'a.png'): File {
  const bytes = Uint8Array.from(atob(PNG_BASE64), (c) => c.charCodeAt(0))
  return new File([bytes], name, { type: 'image/png' })
}

beforeEach(() => {
  const db = getDb()
  for (const t of ['review_logs', 'entry_revisions', 'attachments', 'transcription_jobs', 'schedule_state', 'entries']) {
    db.exec(`DELETE FROM ${t}`)
  }
  db.exec('DELETE FROM entry_fts')
})

afterAll(() => {
  resetDbCache()
  rmSync(tmp, { recursive: true, force: true })
})

describe('Markdown 書き出し', () => {
  test('1 日 1 ファイルにタイトル・本文・画像リンク・末尾コメントが入る', async () => {
    const now = new Date('2026-09-15T10:00:00')
    const withImage = createEntry({ day_date: '2026-09-15', title: '朝の記録', body_md: 'FSRS の論文を読んだ。' }, now)
    await addAttachment(withImage.id, pngFile())
    const graduated = createEntry({ day_date: '2026-09-15', body_md: 'もう覚えた内容' }, now)
    retireEntry(graduated.id, now)

    const result = await exportMarkdown()
    expect(result.files).toHaveLength(1)
    const filePath = result.files[0]!
    expect(filePath.endsWith('/2026/2026-09-15.md')).toBe(true)

    const text = await Bun.file(filePath).text()
    expect(text.startsWith('---\ndate: 2026-09-15\n---')).toBe(true)
    expect(text).toContain('## 朝の記録')
    expect(text).toContain('FSRS の論文を読んだ。')
    expect(text).toMatch(/!\[\]\(\.\.\/attachments\/[^)]+\.png\)/)
    expect(text).toContain(`<!-- mnemorize: id=${withImage.id},`)
    expect(text).toContain('## もう覚えた内容')
    expect(text).toContain(`retired=true`)
    expect(text).toContain(`id=${withImage.id}`)
    expect(text).toMatch(new RegExp(`id=${graduated.id}.*retired=true`))

    // コピーされた画像が実在する
    const m = text.match(/!\[\]\(\.\.\/attachments\/([^)]+\.png)\)/)
    expect(m).not.toBeNull()
    const copied = join(filePath, '..', '..', 'attachments', m![1]!)
    expect(await Bun.file(copied).exists()).toBe(true)
  })
})

describe('画像が欠けているとき', () => {
  test('その画像だけ飛ばして書き出しを続け、warnings に残す', async () => {
    const now = new Date('2026-09-15T10:00:00')
    const entry = createEntry({ day_date: '2026-09-15', title: '画像つき', body_md: '本文' }, now)
    const attachment = await addAttachment(entry.id, pngFile(), now)
    // 実体だけを消す（添付を消したあと手でファイルを消した、同期の途中でファイルが無い、など）。
    await unlink(join(tmp, attachment.rel_path))

    const result = await exportMarkdown()
    // 500 にならず、最後まで書き出せる。
    expect(result.files).toHaveLength(1)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain(attachment.rel_path)

    const text = await Bun.file(result.files[0]!).text()
    // 欠けた画像へのリンクは出さない（開けないリンクを残さない）。
    expect(text).not.toContain('../attachments/')
    expect(text).toContain('## 画像つき')
  })

  test('書き出し中の一時ファイルが残らない', async () => {
    createEntry({ day_date: '2026-09-15', body_md: '原子的に書く' }, new Date('2026-09-15T10:00:00'))
    const result = await exportMarkdown()
    const dir = join(result.files[0]!, '..')
    expect(readdirSync(dir).filter((f) => f.includes('.tmp-'))).toHaveLength(0)
  })
})

describe('JSON 書き出し', () => {
  test('全テーブルが 1 ファイルに入る', async () => {
    createEntry({ day_date: '2026-09-15', body_md: 'JSON 書き出しテスト' })
    const result = await exportJson()
    expect(result.files).toHaveLength(1)
    const json = JSON.parse(await Bun.file(result.files[0]!).text())
    expect(json.schema_version).toBe(1)
    expect(Array.isArray(json.entries)).toBe(true)
    expect(json.entries.length).toBeGreaterThan(0)
    expect(Array.isArray(json.attachments)).toBe(true)
    expect(Array.isArray(json.review_logs)).toBe(true)
    expect(Array.isArray(json.schedule_state)).toBe(true)
    expect(typeof json.settings).toBe('object')
    expect(result.warnings).toEqual([])
  })
})
