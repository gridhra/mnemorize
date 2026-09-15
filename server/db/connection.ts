// SQLite 接続とデータディレクトリの解決。
// 外界（ファイルシステム）に触れるのはここと server/adapters/ だけ。
import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { runMigrations } from './migrate.ts'

// server/db/ の親のさらに親（= リポジトリ直下）を基準にする。import.meta.dir 基準にすることで、
// カレントディレクトリに依存せず堅牢にリポジトリ直下を求められる。
const repoRoot = join(import.meta.dir, '..', '..')

/** データディレクトリ。環境変数 MNEMORIZE_DATA_DIR 優先、未設定ならリポジトリ直下の data/（git 管理外） */
export function dataDir(): string {
  const fromEnv = process.env.MNEMORIZE_DATA_DIR
  if (fromEnv && fromEnv.length > 0) return fromEnv
  return join(repoRoot, 'data')
}

export function dbPath(): string {
  return join(dataDir(), 'mnemorize.sqlite')
}

let cached: Database | null = null
let cachedPath: string | null = null

/** 接続を返す。初回にディレクトリ作成とマイグレーションを行う。 */
export function getDb(): Database {
  const path = dbPath()
  if (cached && cachedPath === path) return cached
  if (cached) cached.close()
  mkdirSync(dataDir(), { recursive: true })
  const db = new Database(path, { create: true })
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  runMigrations(db)
  cached = db
  cachedPath = path
  return db
}

/** テストで DB を作り直すときに使う。 */
export function resetDbCache(): void {
  if (cached) cached.close()
  cached = null
  cachedPath = null
}
