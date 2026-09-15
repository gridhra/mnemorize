// 設定（DB の settings テーブル。キー・値）。
import { getDb } from '../db/connection.ts'
import { ValidationError } from './entries.ts'
import { DEFAULT_BOUNDARY_HOUR, now as clockNow, toLocalIso } from '../adapters/clock.ts'

/** 設定の既定値。ここにない鍵は保存も読み出しもしない。 */
export const DEFAULT_SETTINGS = {
  /** 一日の境界時刻（要件 D10） */
  boundary_hour: DEFAULT_BOUNDARY_HOUR,
  /** 1 日の復習提示上限（要件 R4） */
  daily_review_limit: 10,
  /** whisper.cpp のモデルファイルの絶対パス（後続担当が使う） */
  whisper_model_path: '',
  /** 文字起こしの初期プロンプトに入れる専門用語（1 行 1 語） */
  glossary: '',
  /** 無音で出やすい定型句。一致したセグメントは除去する（要件 J4） */
  hallucination_phrases: ['ご視聴ありがとうございました', 'チャンネル登録', 'you', 'Thank you.'],
  /** 最大間隔に達した記録を自動で卒業させる（要件 S6） */
  auto_retire: true,
  /** スナップショットのコピー先（例：iCloud Drive のフォルダ）。空なら作らない（要件 P3） */
  snapshot_copy_dir: '',
} as const

export type Settings = { -readonly [K in keyof typeof DEFAULT_SETTINGS]: unknown } & {
  boundary_hour: number
  daily_review_limit: number
  whisper_model_path: string
  glossary: string
  hallucination_phrases: string[]
  auto_retire: boolean
  snapshot_copy_dir: string
}

export function getSettings(): Settings {
  const db = getDb()
  const rows = db.query<{ key: string; value: string }, []>('SELECT key, value FROM settings').all()
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const row of rows) {
    if (!(row.key in DEFAULT_SETTINGS)) continue
    try {
      out[row.key] = JSON.parse(row.value)
    } catch {
      // 壊れた値は既定値のままにする
    }
  }
  return out as Settings
}

/**
 * 整数かつ min〜max の範囲に入っているか。範囲外なら ValidationError。
 * メッセージは画面の欄の下にそのまま出すので、内部の鍵名は含めない
 * （画面のラベルと同じ文字列を使う。web/src/i18n/ja.ts の対応するラベルと合わせること）。
 */
function intInRange(value: unknown, min: number, max: number, label: string): number {
  const n = typeof value === 'number' ? value : Number.NaN
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ValidationError(`${label}は${min}〜${max}の整数で指定してください。`)
  }
  return n
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${label}は文字列で指定してください。`)
  }
  return value
}

/**
 * 改行区切りのリスト。文字列の配列と、改行で区切った 1 本の文字列のどちらでも受ける
 * （画面は配列で送るが、手で API を叩くときは改行区切りのほうが書きやすい）。
 */
function asStringList(value: unknown, label: string): string[] {
  if (Array.isArray(value)) {
    if (!value.every((v) => typeof v === 'string')) {
      throw new ValidationError(`${label}は文字列の配列で指定してください。`)
    }
    return value.map((v) => (v as string).trim()).filter((v) => v.length > 0)
  }
  if (typeof value === 'string') {
    return value.split('\n').map((v) => v.trim()).filter((v) => v.length > 0)
  }
  throw new ValidationError(`${label}は文字列の配列か改行区切りの文字列で指定してください。`)
}

/**
 * 鍵ごとに値を検証して、保存してよい形に直す。
 * 型が合わない値を素通しすると、読み出し側が既定値に読み替えて「設定したのに効かない」状態になる
 * （例：auto_retire に文字列 "yes" が入ると、厳密比較に外れて自動で復習を終える動作が黙って無効になる）。
 */
function validateSetting(key: keyof typeof DEFAULT_SETTINGS, value: unknown): unknown {
  switch (key) {
    case 'boundary_hour':
      return intInRange(value, 0, 23, '日付の切り替え時刻')
    case 'daily_review_limit':
      return intInRange(value, 1, 200, '1日に出す復習の上限')
    case 'auto_retire':
      if (typeof value !== 'boolean') {
        throw new ValidationError('間隔が1年に達したら復習を終える設定はオンかオフで指定してください。')
      }
      return value
    case 'hallucination_phrases':
      return asStringList(value, '無音のときに出やすい誤認識')
    case 'whisper_model_path':
      return asString(value, 'モデルファイルの場所')
    case 'glossary':
      return asString(value, '覚えさせたい言葉')
    case 'snapshot_copy_dir':
      return asString(value, '控えのコピー先')
  }
}

/** 既知の鍵だけを上書きする。未知の鍵は黙って捨てる。値が不正なら ValidationError。 */
export function putSettings(patch: Record<string, unknown>): Settings {
  const db = getDb()
  const now = toLocalIso(clockNow())
  const stmt = db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
  // 先に全部を検証する。1 つでも不正なら何も保存しない。
  const validated: [string, unknown][] = []
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue
    validated.push([key, validateSetting(key as keyof typeof DEFAULT_SETTINGS, value)])
  }
  db.transaction(() => {
    for (const [key, value] of validated) stmt.run(key, JSON.stringify(value), now)
  })()
  return getSettings()
}

/** 一日の境界時刻。0〜23 の範囲に丸める。 */
export function boundaryHour(): number {
  const h = getSettings().boundary_hour
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : DEFAULT_BOUNDARY_HOUR
}
