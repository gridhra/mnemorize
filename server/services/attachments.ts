// 画像添付の追加・削除。ロジックはここに置き、ルートは薄く保つ（要件 C6）。
import { getDb, dataDir } from '../db/connection.ts'
import { deleteAttachmentFile, saveAttachmentFile, sha256Hex } from '../adapters/files.ts'
import { now as clockNow, toLocalIso } from '../adapters/clock.ts'
import { getEntry, NotFoundError, ValidationError, type AttachmentRow } from './entries.ts'

/** 許可する画像形式と保存時の拡張子。 */
const ALLOWED_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heic',
}

/** 1 枚あたりの上限（20MB）。 */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

/**
 * 画像を 1 枚、記録に添付する。
 * 同じ記録に同じ SHA-256 の画像が既にあれば、新規保存せず既存の行を返す（重複防止）。
 */
export async function addAttachment(
  entryId: string,
  file: { type: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> },
  now: Date = clockNow(),
): Promise<AttachmentRow> {
  getEntry(entryId) // 存在しなければ NotFoundError

  const ext = ALLOWED_MIME[file.type]
  if (!ext) {
    throw new ValidationError(`対応していない画像形式です（png/jpeg/gif/webp/heic のみ）: ${file.type || '不明'}`)
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new ValidationError('画像は 1 枚あたり 20MB までです')
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const hash = sha256Hex(bytes)
  const db = getDb()

  const dup = db
    .query<AttachmentRow, [string, string]>(
      `SELECT * FROM attachments WHERE entry_id = ? AND sha256 = ? AND kind = 'image'`,
    )
    .get(entryId, hash)
  if (dup) return dup

  const { relPath } = await saveAttachmentFile(dataDir(), bytes, ext, now)
  const id = Bun.randomUUIDv7()
  const nowIso = toLocalIso(now)
  db.query(
    `INSERT INTO attachments (id, entry_id, kind, rel_path, mime, bytes, sha256, created_at)
     VALUES (?, ?, 'image', ?, ?, ?, ?, ?)`,
  ).run(id, entryId, relPath, file.type, bytes.length, hash, nowIso)

  return db.query<AttachmentRow, [string]>('SELECT * FROM attachments WHERE id = ?').get(id)!
}

/** 添付を削除する（ファイル実体も消す）。音声（kind='audio'）もここで削除できる。 */
export async function deleteAttachment(id: string): Promise<AttachmentRow> {
  const db = getDb()
  const row = db.query<AttachmentRow, [string]>('SELECT * FROM attachments WHERE id = ?').get(id)
  if (!row) throw new NotFoundError(`添付が見つかりません: ${id}`)
  db.query('DELETE FROM attachments WHERE id = ?').run(id)
  await deleteAttachmentFile(dataDir(), row.rel_path)
  return row
}
