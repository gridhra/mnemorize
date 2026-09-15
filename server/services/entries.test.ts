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
  deleteEntry,
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
const { submitReview } = await import('./reviews.ts')
const { addAttachment } = await import('./attachments.ts')
const { dataDir } = await import('../db/connection.ts')
const { createJob, setAsrAdapter, waitForIdle, getJob } = await import('./transcribe.ts')
// 見出しの規則を画面側と突き合わせるための入出力表（web/src/headline.cases.ts が正本）。
const { HEADLINE_CASES } = await import('../../web/src/headline.cases.ts')

// 1x1 の透明 PNG（attachments.test.ts と同じもの）。
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
    expect(headlineOf(null, 'SQLite の WAL を調べた。次は FTS5。')).toBe('SQLite の WAL を調べた')
  })

  // 画面側にも同じ規則の実装（web/src/headline.ts）がある。保存前に「見出し欄を触ったか」を
  // 判定するために画面が必要とするもので、ずれるとサーバーとで見出しが食い違う。
  // 同じ入出力表を両方のテストが使う。
  describe('見出しの決め方が画面側の実装と一致する', () => {
    for (const c of HEADLINE_CASES) {
      test(c.name, () => {
        expect(headlineOf(c.title, c.body)).toBe(c.expected)
      })
    }
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
  test('ある版の内容で更新すると、その版に戻り、履歴は消えずに 1 つ増える', () => {
    const e = createEntry({ title: 'v1', body_md: '最初の本文' }, new Date('2026-09-15T10:00:00'))
    updateEntry(e.id, { title: 'v2', body_md: '二番目の本文' }, new Date('2026-09-15T11:00:00'))
    // 画面の「この版に戻す」は、その版の title と body_md でふつうに更新するだけ。
    const first = listRevisions(e.id)[0]!
    const back = updateEntry(
      e.id,
      { title: first.title, body_md: first.body_md },
      new Date('2026-09-15T12:00:00'),
    )
    expect(back.body_md).toBe('最初の本文')
    expect(back.title).toBe('v1')
    const revs = listRevisions(e.id)
    expect(revs.map((r) => r.rev_no)).toEqual([2, 1])
    // 戻す直前の内容（v2）も履歴に残るので、戻す操作は取り消せる。
    expect(revs[0]?.body_md).toBe('二番目の本文')
  })
  // reset_schedule=true の側の動きは services/reviews.test.ts で確かめている（段階 4 で実装した）。
  test('存在しない記録の更新は NotFoundError', () => {
    expect(() => updateEntry('no-such-id', { body_md: 'x' })).toThrow(NotFoundError)
  })
})

describe('想起見込み（retrievability）', () => {
  test('まだ復習していない記録では null、1 回評価すると 0〜1 の数になる', () => {
    const e = createEntry({ body_md: '想起見込みの確認' })
    expect(getEntry(e.id).retrievability).toBeNull()
    submitReview(e.id, 3)
    const after = getEntry(e.id)
    expect(typeof after.retrievability).toBe('number')
    expect(after.retrievability!).toBeGreaterThan(0)
    expect(after.retrievability!).toBeLessThanOrEqual(1)
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

describe('記録の削除', () => {
  test('削除すると entries・schedule_state・review_logs・attachments の行と添付ファイルが消える', async () => {
    const e = createEntry({ body_md: '削除するテスト録音のメモ' }, new Date('2026-09-15T10:00:00'))
    submitReview(e.id, 3) // review_logs に 1 行作る
    const attachment = await addAttachment(e.id, pngFile())
    const absPath = join(dataDir(), attachment.rel_path)
    expect(await Bun.file(absPath).exists()).toBe(true)

    await deleteEntry(e.id)

    const db = getDb()
    expect(db.query('SELECT 1 FROM entries WHERE id = ?').get(e.id)).toBeNull()
    expect(db.query('SELECT 1 FROM schedule_state WHERE entry_id = ?').get(e.id)).toBeNull()
    expect(db.query('SELECT 1 FROM review_logs WHERE entry_id = ?').get(e.id)).toBeNull()
    expect(db.query('SELECT 1 FROM attachments WHERE entry_id = ?').get(e.id)).toBeNull()
    expect(await Bun.file(absPath).exists()).toBe(false)
  })

  test('存在しない id は NotFoundError', async () => {
    await expect(deleteEntry('存在しない-id')).rejects.toThrow(NotFoundError)
  })

  test('削除後は全文検索に出ない', async () => {
    const e = createEntry({ day_date: '2026-09-15', body_md: '消える予定のテスト録音' })
    expect(search('テスト録音')).toHaveLength(1)
    await deleteEntry(e.id)
    expect(search('テスト録音')).toHaveLength(0)
  })
})

// ---- 録音した音声を記録に結びつける（transcription_job_ids） ----
//
// 文字起こしジョブは記録を作らない。結果は画面の本文欄に流れ込み、利用者が
// 「記録する」「保存」を押したときに、そのジョブの id を添えて保存する。
// そこで初めて音声の添付とジョブがその記録のものになる。

/** 16kHz モノラル 16bit の無音 WAV（中身は使わないのでヘッダが正しければよい）。 */
function silentWav(seconds = 1): Uint8Array {
  const sampleRate = 16000
  const dataSize = sampleRate * seconds * 2
  const buf = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buf)
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, dataSize, true)
  return new Uint8Array(buf)
}

/** whisper-cli は起動せず、決めた文章を返すだけの偽アダプタ。 */
function fakeAsr(text: string) {
  const segments = [{ from_ms: 0, to_ms: 1000, text }]
  return {
    async transcribe() {
      return { text, segments, model: '/tmp/fake-model.bin', prompt: 'テスト' }
    },
  }
}

/** 文字起こしが終わったジョブを 1 つ作る。 */
async function doneJob(text: string): Promise<string> {
  setAsrAdapter(fakeAsr(text))
  const job = await createJob({ wav: silentWav(), dayDate: '2026-09-15' })
  await waitForIdle()
  return job.id
}

describe('文字起こしジョブの結びつけ', () => {
  test('作成時に transcription_job_ids を渡すと音声がその記録に付く', async () => {
    const jobId = await doneJob('録音から起こした文章。')
    const entry = createEntry({
      day_date: '2026-09-15',
      body_md: '録音から起こした文章。手直しした。',
      transcription_job_ids: [jobId],
    })
    expect(entry.attachments).toHaveLength(1)
    expect(entry.attachments[0]?.kind).toBe('audio')
    const job = getJob(jobId)
    expect(job.entry_id).toBe(entry.id)
    // 文字起こしのまま（編集前）の文はジョブ側に残る（検索が使う）。
    expect(job.raw_text).toBe('録音から起こした文章。')
  })

  test('更新時に渡すと、あとから録音した音声が同じ記録に付く', async () => {
    const entry = createEntry({ day_date: '2026-09-15', body_md: '最初の本文。' })
    const jobId = await doneJob('書き足した文章。')
    const after = updateEntry(entry.id, {
      body_md: '最初の本文。\n\n書き足した文章。',
      transcription_job_ids: [jobId],
    })
    expect(after.attachments).toHaveLength(1)
    expect(getJob(jobId).entry_id).toBe(entry.id)
  })

  test('1 つの記録に複数回の録音を結びつけられる', async () => {
    const first = await doneJob('一度目の録音。')
    const second = await doneJob('二度目の録音。')
    const entry = createEntry({
      day_date: '2026-09-15',
      body_md: '一度目の録音。二度目の録音。',
      transcription_job_ids: [first, second],
    })
    expect(entry.attachments.filter((a) => a.kind === 'audio')).toHaveLength(2)
  })

  test('存在しないジョブ id は ValidationError（400）で、記録も作らない', async () => {
    expect(() =>
      createEntry({
        day_date: '2026-09-15',
        body_md: '作られないはずの本文。',
        transcription_job_ids: ['存在しないジョブ'],
      }),
    ).toThrow(ValidationError)
    expect(listDay('2026-09-15')).toHaveLength(0)
  })

  test('既に別の記録に結びついたジョブは ValidationError（400）', async () => {
    const jobId = await doneJob('先に別の記録に付いた録音。')
    const first = createEntry({
      day_date: '2026-09-15',
      body_md: '先に保存した記録。',
      transcription_job_ids: [jobId],
    })
    expect(() =>
      createEntry({
        day_date: '2026-09-15',
        body_md: 'あとから同じ録音を付けようとした記録。',
        transcription_job_ids: [jobId],
      }),
    ).toThrow(ValidationError)
    expect(getJob(jobId).entry_id).toBe(first.id)
  })

  test('同じ記録に同じジョブをもう一度渡しても失敗しない', async () => {
    const jobId = await doneJob('保存をやり直した録音。')
    const entry = createEntry({
      day_date: '2026-09-15',
      body_md: '保存をやり直した録音。',
      transcription_job_ids: [jobId],
    })
    const after = updateEntry(entry.id, {
      body_md: '保存をやり直した録音。手直し。',
      transcription_job_ids: [jobId],
    })
    expect(after.attachments.filter((a) => a.kind === 'audio')).toHaveLength(1)
  })

  test('記録を削除すると、結びついたジョブと音声のファイルも消える', async () => {
    const jobId = await doneJob('削除と一緒に消える録音。')
    const entry = createEntry({
      day_date: '2026-09-15',
      body_md: '削除と一緒に消える録音。',
      transcription_job_ids: [jobId],
    })
    const audio = entry.attachments.find((a) => a.kind === 'audio')
    const absPath = join(dataDir(), audio?.rel_path ?? '')
    expect(await Bun.file(absPath).exists()).toBe(true)

    await deleteEntry(entry.id)

    const db = getDb()
    expect(db.query('SELECT 1 FROM transcription_jobs WHERE id = ?').get(jobId)).toBeNull()
    expect(db.query('SELECT 1 FROM attachments WHERE id = ?').get(audio?.id ?? '')).toBeNull()
    expect(await Bun.file(absPath).exists()).toBe(false)
  })
})
