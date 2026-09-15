// 録音した音声（WAV）の保存。外界（ファイルシステム）に触れるのでアダプタに置く。
// 画像の添付は別の担当が server/adapters/files.ts に作るので、ここは音声だけを扱う。
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { getDb, dataDir } from '../db/connection.ts'
import { now as clockNow, toLocalIso } from './clock.ts'

/** WAV のヘッダが読めなかったときに投げる。 */
export class WavParseError extends Error {}

export type WavInfo = {
  sampleRate: number
  channels: number
  bitsPerSample: number
  durationSec: number
}

function readAscii(buf: Uint8Array, offset: number, length: number): string {
  let s = ''
  for (let i = 0; i < length; i++) s += String.fromCharCode(buf[offset + i] ?? 0)
  return s
}

/**
 * WAV のヘッダを読む。44 バイト固定とは決めつけず、RIFF のチャンクを順にたどる
 * （他のツールが作った WAV で fmt と data の間に別のチャンクが挟まっていても壊れないように）。
 */
export function parseWavHeader(buf: Uint8Array): WavInfo {
  if (buf.length < 12) throw new WavParseError('ファイルが短すぎて RIFF ヘッダを読めません')
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (readAscii(buf, 0, 4) !== 'RIFF' || readAscii(buf, 8, 4) !== 'WAVE') {
    throw new WavParseError('RIFF/WAVE ヘッダが見つかりません')
  }

  let offset = 12
  let sampleRate: number | null = null
  let channels: number | null = null
  let bitsPerSample: number | null = null
  let dataSize: number | null = null

  while (offset + 8 <= buf.length) {
    const chunkId = readAscii(buf, offset, 4)
    const chunkSize = dv.getUint32(offset + 4, true)
    const start = offset + 8
    if (chunkId === 'fmt ') {
      if (start + 16 > buf.length) throw new WavParseError('fmt チャンクが不完全です')
      channels = dv.getUint16(start + 2, true)
      sampleRate = dv.getUint32(start + 4, true)
      bitsPerSample = dv.getUint16(start + 14, true)
    } else if (chunkId === 'data') {
      // ヘッダのサイズが実体より大きいことがあるので、実データ長で頭打ちにする。
      dataSize = Math.min(chunkSize, buf.length - start)
    }
    // チャンクは偶数バイト境界に揃う（奇数サイズなら 1 バイトのパディング）。
    offset = start + chunkSize + (chunkSize % 2)
  }

  if (sampleRate === null || channels === null || bitsPerSample === null) {
    throw new WavParseError('fmt チャンクが見つかりませんでした')
  }
  if (dataSize === null) throw new WavParseError('data チャンクが見つかりませんでした')
  const bytesPerFrame = (bitsPerSample / 8) * channels
  const durationSec = bytesPerFrame > 0 ? dataSize / bytesPerFrame / sampleRate : 0
  return { sampleRate, channels, bitsPerSample, durationSec }
}

export type SavedAudio = {
  attachmentId: string
  relPath: string
  absPath: string
  bytes: number
  sha256: string
  durationSec: number
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** データディレクトリ配下の絶対パス。 */
export function absolutePathOf(relPath: string): string {
  return join(dataDir(), relPath)
}

/**
 * WAV を `audio/YYYY/MM/<uuid>.wav` に保存し、attachments に kind='audio' の 1 行を作る。
 * 記録（entry）はこの時点ではまだ無いことがあるので entry_id は NULL で作り、あとで結びつける。
 */
export async function saveAudio(
  data: Uint8Array,
  options: { entryId?: string | null; now?: Date } = {},
): Promise<SavedAudio> {
  const info = parseWavHeader(data)
  const now = options.now ?? clockNow()
  const id = Bun.randomUUIDv7()
  const relDir = join('audio', String(now.getFullYear()), pad2(now.getMonth() + 1))
  const relPath = join(relDir, `${id}.wav`)
  const absPath = join(dataDir(), relPath)
  await mkdir(join(dataDir(), relDir), { recursive: true })
  await Bun.write(absPath, data)

  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(data)
  const sha256 = hasher.digest('hex')

  getDb()
    .query(
      `INSERT INTO attachments (id, entry_id, kind, rel_path, mime, bytes, sha256, duration_sec, created_at)
       VALUES (?, ?, 'audio', ?, 'audio/wav', ?, ?, ?, ?)`,
    )
    .run(id, options.entryId ?? null, relPath, data.byteLength, sha256, info.durationSec, toLocalIso(now))

  return {
    attachmentId: id,
    relPath,
    absPath,
    bytes: data.byteLength,
    sha256,
    durationSec: info.durationSec,
  }
}

/** 保存済みの音声を記録に結びつける（文字起こしが終わって記録ができたとき）。 */
export function attachAudioToEntry(attachmentId: string, entryId: string): void {
  getDb().query('UPDATE attachments SET entry_id = ? WHERE id = ?').run(entryId, attachmentId)
}

/** 添付 1 行を取り出す（再試行で保存済み WAV のパスを引くのに使う）。 */
export function findAudio(attachmentId: string): { rel_path: string; abs_path: string } | null {
  const row = getDb()
    .query<{ rel_path: string }, [string]>('SELECT rel_path FROM attachments WHERE id = ?')
    .get(attachmentId)
  if (!row) return null
  return { rel_path: row.rel_path, abs_path: absolutePathOf(row.rel_path) }
}
