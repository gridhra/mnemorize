import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// テスト用に独立した DB を使う（import より前に環境変数を決める必要がある）。
const tmp = mkdtempSync(join(tmpdir(), 'mnemorize-test-'))
process.env.MNEMORIZE_DATA_DIR = tmp

const { getDb, resetDbCache, dbPath } = await import('../db/connection.ts')
const { runMigrations, migrationFiles } = await import('../db/migrate.ts')
const {
  createEntry,
  getEntry,
  headlineOf,
  listDay,
  listDayCounts,
  listRevisions,
  retireEntry,
  unretireEntry,
  updateEntry,
  NotFoundError,
  ValidationError,
} = await import('./entries.ts')
const { search } = await import('./search.ts')

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

describe('マイグレーション', () => {
  test('一時ディレクトリに独立した DB ができる', () => {
    expect(dbPath().startsWith(tmp)).toBe(true)
    const tables = getDb()
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name)
    for (const t of ['entries', 'entry_revisions', 'attachments', 'transcription_jobs', 'review_logs', 'schedule_state', 'settings']) {
      expect(tables).toContain(t)
    }
  })
  test('2 回目の実行では何も適用されない（冪等）', () => {
    expect(runMigrations(getDb())).toEqual([])
    expect(migrationFiles().length).toBeGreaterThan(0)
  })
})

describe('記録の作成', () => {
  test('作成すると schedule_state が New・翌日 4:00 で 1 行できる', () => {
    const now = new Date('2026-09-15T14:00:00')
    const e = createEntry({ body_md: '今日は FSRS の論文を読んだ。' }, now)
    expect(e.day_date).toBe('2026-09-15')
    expect(e.review_enabled).toBe(1)
    expect(e.schedule?.state).toBe('New')
    expect(e.schedule?.due.slice(0, 16)).toBe('2026-09-16T04:00')
    expect(e.schedule?.reps).toBe(0)
    expect(e.schedule?.lapses).toBe(0)
    expect(e.schedule?.stability).toBeNull()
  })
  test('深夜 2 時の記録は前日の学習日になる', () => {
    const e = createEntry({ body_md: '夜ふかしメモ' }, new Date('2026-09-16T02:00:00'))
    expect(e.day_date).toBe('2026-09-15')
  })
  test('本文もタイトルも空なら拒否する', () => {
    expect(() => createEntry({ body_md: '   ' })).toThrow(ValidationError)
  })
  test('日付の形式が不正なら拒否する', () => {
    expect(() => createEntry({ day_date: '2026/09/15', body_md: 'x' })).toThrow(ValidationError)
  })
  test('タイトルが空なら本文先頭 1 文が手がかりになる', () => {
    const e = createEntry({ body_md: '# 見出し\n\nSQLite の WAL を調べた。次は FTS5。' })
    expect(e.headline).toBe('見出し')
    expect(headlineOf(null, 'SQLite の WAL を調べた。次は FTS5。')).toBe('SQLite の WAL を調べた。')
  })
})

describe('更新と履歴', () => {
  test('更新のたびに更新前の全文が履歴に積まれる', () => {
    const e = createEntry({ title: 'v1', body_md: '最初の本文' }, new Date('2026-09-15T10:00:00'))
    updateEntry(e.id, { body_md: '二番目の本文' }, new Date('2026-09-15T11:00:00'))
    const after = updateEntry(e.id, { title: 'v3', body_md: '三番目の本文' }, new Date('2026-09-15T12:00:00'))
    expect(after.body_md).toBe('三番目の本文')
    const revs = listRevisions(e.id)
    expect(revs.map((r) => r.rev_no)).toEqual([2, 1])
    expect(revs.map((r) => r.body_md)).toEqual(['二番目の本文', '最初の本文'])
    expect(revs[1]?.title).toBe('v1')
  })
  test('本文が変わらない更新では履歴が積まれない', () => {
    const e = createEntry({ body_md: '同じ本文' })
    updateEntry(e.id, { review_enabled: false })
    expect(listRevisions(e.id)).toHaveLength(0)
    expect(getEntry(e.id).review_enabled).toBe(0)
  })
  test('reset_schedule を付けないかぎり予定は変わらない', () => {
    const e = createEntry({ body_md: 'あ' }, new Date('2026-09-15T10:00:00'))
    const before = e.schedule?.due
    const after = updateEntry(e.id, { body_md: 'い' })
    expect(after.schedule?.due).toBe(before!)
    expect(after.schedule_reset_at).toBeNull()
  })
  // reset_schedule=true の側の動きは services/reviews.test.ts で確かめている（段階 4 で実装した）。
  test('存在しない記録の更新は NotFoundError', () => {
    expect(() => updateEntry('no-such-id', { body_md: 'x' })).toThrow(NotFoundError)
  })
})

describe('日付一覧', () => {
  test('同じ日の記録が作成順に並び、日ごとの件数が取れる', () => {
    createEntry({ day_date: '2026-09-14', body_md: '一' })
    createEntry({ day_date: '2026-09-15', body_md: '二' })
    createEntry({ day_date: '2026-09-15', body_md: '三' })
    const day = listDay('2026-09-15')
    expect(day.map((e) => e.body_md)).toEqual(['二', '三'])
    expect(listDay('2026-09-13')).toHaveLength(0)
    expect(listDayCounts('2026-09-13', '2026-09-16')).toEqual([
      { day_date: '2026-09-14', count: 1 },
      { day_date: '2026-09-15', count: 2 },
    ])
  })
})

describe('卒業と取り消し', () => {
  test('卒業すると retired_at が立ち、復習履歴に 1 行残る', () => {
    const e = createEntry({ body_md: 'もう覚えた' })
    const retired = retireEntry(e.id, new Date('2026-09-20T09:00:00'))
    expect(retired.retired_at).not.toBeNull()
    const back = unretireEntry(e.id, new Date('2026-09-21T09:00:00'))
    expect(back.retired_at).toBeNull()
    const kinds = getDb()
      .query<{ kind: string }, [string]>('SELECT kind FROM review_logs WHERE entry_id = ? ORDER BY reviewed_at')
      .all(e.id)
      .map((r) => r.kind)
    expect(kinds).toEqual(['retire', 'unretire'])
  })
})

describe('全文検索', () => {
  test('3 文字以上は FTS5 trigram で引ける', () => {
    createEntry({ day_date: '2026-09-15', body_md: 'SQLite の全文検索を日本語で試した。' })
    const hits = search('全文検索')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.day_date).toBe('2026-09-15')
  })
  test('2 文字の検索語は LIKE にフォールバックする', () => {
    createEntry({ day_date: '2026-09-15', body_md: '録音の話' })
    const hits = search('録音')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.excerpt).toContain('録音')
  })
  test('更新後は新しい本文で引ける', () => {
    const e = createEntry({ body_md: '古い内容のメモ' })
    updateEntry(e.id, { body_md: '新しい内容のメモ' })
    expect(search('新しい内容')).toHaveLength(1)
    expect(search('古い内容')).toHaveLength(0)
  })
})
