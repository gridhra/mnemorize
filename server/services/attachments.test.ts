import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = mkdtempSync(join(tmpdir(), 'mnemorize-attach-test-'))
process.env.MNEMORIZE_DATA_DIR = tmp

const { getDb, resetDbCache, dataDir } = await import('../db/connection.ts')
const { createEntry, NotFoundError, ValidationError } = await import('./entries.ts')
const { addAttachment, deleteAttachment, MAX_ATTACHMENT_BYTES } = await import('./attachments.ts')

// 1x1 の透明 PNG。
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

describe('画像添付', () => {
  test('追加するとファイルが保存され、行が返る', async () => {
    const e = createEntry({ body_md: 'ノートの写真' })
    const a = await addAttachment(e.id, pngFile())
    expect(a.entry_id).toBe(e.id)
    expect(a.kind).toBe('image')
    expect(a.mime).toBe('image/png')
    expect(a.sha256).not.toBeNull()
    const abs = join(dataDir(), a.rel_path)
    expect(await Bun.file(abs).exists()).toBe(true)
  })

  test('同じ記録に同じ画像を 2 回添付すると重複せず既存の行を返す', async () => {
    const e = createEntry({ body_md: '重複テスト' })
    const first = await addAttachment(e.id, pngFile())
    const second = await addAttachment(e.id, pngFile('b.png'))
    expect(second.id).toBe(first.id)
    const rows = getDb()
      .query<{ c: number }, [string]>('SELECT COUNT(*) AS c FROM attachments WHERE entry_id = ?')
      .get(e.id)
    expect(rows?.c).toBe(1)
  })

  test('対応していない形式は拒否する', async () => {
    const e = createEntry({ body_md: 'x' })
    const bad = new File([new Uint8Array([1, 2, 3])], 'a.txt', { type: 'text/plain' })
    await expect(addAttachment(e.id, bad)).rejects.toThrow(ValidationError)
  })

  test('20MB を超える画像は拒否する', async () => {
    const e = createEntry({ body_md: 'x' })
    const big = { type: 'image/png', size: MAX_ATTACHMENT_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(0) }
    await expect(addAttachment(e.id, big)).rejects.toThrow(ValidationError)
  })

  test('存在しない記録への添付は NotFoundError', async () => {
    await expect(addAttachment('no-such-id', pngFile())).rejects.toThrow(NotFoundError)
  })

  test('削除するとファイルも消える', async () => {
    const e = createEntry({ body_md: '削除テスト' })
    const a = await addAttachment(e.id, pngFile())
    const abs = join(dataDir(), a.rel_path)
    expect(await Bun.file(abs).exists()).toBe(true)
    await deleteAttachment(a.id)
    expect(await Bun.file(abs).exists()).toBe(false)
    expect(
      getDb().query<{ id: string }, [string]>('SELECT id FROM attachments WHERE id = ?').get(a.id),
    ).toBeNull()
  })

  test('存在しない添付の削除は NotFoundError', async () => {
    await expect(deleteAttachment('no-such-id')).rejects.toThrow(NotFoundError)
  })
})
