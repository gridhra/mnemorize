// 連番 SQL ファイルを順に適用する簡単なマイグレーション実行器。
// スキーマ変更は必ず新しい連番ファイルを足すこと（既存ファイルは編集しない）。
import type { Database } from 'bun:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { now as clockNow, toLocalIso } from '../adapters/clock.ts'

const migrationsDir = join(import.meta.dir, 'migrations')

export function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
}

export function runMigrations(db: Database): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`)
  const applied = new Set(
    db.query<{ name: string }, []>('SELECT name FROM schema_migrations').all().map((r) => r.name),
  )
  const newlyApplied: string[] = []
  for (const name of migrationFiles()) {
    if (applied.has(name)) continue
    const sql = readFileSync(join(migrationsDir, name), 'utf8')
    db.transaction(() => {
      db.exec(sql)
      db.query('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
        name,
        toLocalIso(clockNow()),
      )
    })()
    newlyApplied.push(name)
  }
  return newlyApplied
}
