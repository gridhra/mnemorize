// 添付ファイル（画像）の保存・削除。外界（ファイルシステム）に触れるのはここだけ。
import { mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { now as clockNow } from './clock.ts'

/** バイト列の SHA-256（16 進）。 */
export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * 画像を `<dataDir>/attachments/YYYY/MM/<uuid>.<ext>` に保存する。
 * 戻り値の relPath はデータディレクトリからの相対パス（`/files/<relPath>` で配信される）。
 */
export async function saveAttachmentFile(
  dataDir: string,
  bytes: Uint8Array,
  ext: string,
  now: Date = clockNow(),
): Promise<{ relPath: string; absPath: string }> {
  const y = String(now.getFullYear())
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const relDir = join('attachments', y, m)
  const absDir = join(dataDir, relDir)
  await mkdir(absDir, { recursive: true })
  const id = Bun.randomUUIDv7()
  const relPath = join(relDir, `${id}.${ext}`)
  const absPath = join(dataDir, relPath)
  await Bun.write(absPath, bytes)
  return { relPath, absPath }
}

/** 添付ファイルの実体を削除する。既に無ければ何もしない。 */
export async function deleteAttachmentFile(dataDir: string, relPath: string): Promise<void> {
  try {
    await unlink(join(dataDir, relPath))
  } catch {
    // 既に無い場合は無視する
  }
}
