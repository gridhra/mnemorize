// 日次スナップショット（要件 P3）。`VACUUM INTO` で `snapshots/mnemorize-YYYYMMDD-HHmm.sqlite` を作る。
import { mkdir, readdir, unlink, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getDb, dataDir } from '../db/connection.ts'
import { getSettings } from './settings.ts'
import { calendarDate, now as clockNow } from '../adapters/clock.ts'

const pad = (n: number) => String(n).padStart(2, '0')

/** 残すスナップショットの数。これを超えた古いものから削除する。 */
export const KEEP_SNAPSHOTS = 14

export function snapshotsDir(): string {
  return join(dataDir(), 'snapshots')
}

export type SnapshotResult = { path: string; copied_to: string | null; deleted: string[] }

export async function createSnapshot(now: Date = clockNow()): Promise<SnapshotResult> {
  const dir = snapshotsDir()
  await mkdir(dir, { recursive: true })
  // 秒まで名前に入れる。それでも同じ秒に複数作られたら -2, -3 … と連番で空きを探す
  // （VACUUM INTO は既存ファイルには書けないので、名前が衝突すると失敗する）。
  const stamp = `${calendarDate(now).replace(/-/g, '')}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  let fileName = `mnemorize-${stamp}.sqlite`
  let filePath = join(dir, fileName)
  for (let n = 2; await Bun.file(filePath).exists(); n++) {
    fileName = `mnemorize-${stamp}-${n}.sqlite`
    filePath = join(dir, fileName)
  }

  const db = getDb()
  db.query('VACUUM INTO ?').run(filePath)

  const all = (await readdir(dir)).filter((f) => f.startsWith('mnemorize-') && f.endsWith('.sqlite')).sort()
  const toDelete = all.slice(0, Math.max(0, all.length - KEEP_SNAPSHOTS))
  for (const f of toDelete) await unlink(join(dir, f)).catch(() => {})

  let copiedTo: string | null = null
  const copyDir = getSettings().snapshot_copy_dir
  if (typeof copyDir === 'string' && copyDir.trim().length > 0) {
    await mkdir(copyDir, { recursive: true })
    const dest = join(copyDir, fileName)
    await copyFile(filePath, dest)
    copiedTo = dest
  }

  return { path: filePath, copied_to: copiedTo, deleted: toDelete }
}
