// 設定の保存時の値検証のテスト。DB を使うので一時ディレクトリに独立した DB を作る。
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = mkdtempSync(join(tmpdir(), 'mnemorize-settings-test-'))
process.env.MNEMORIZE_DATA_DIR = tmp

const { getDb, resetDbCache } = await import('../db/connection.ts')
const { ValidationError } = await import('./entries.ts')
const { boundaryHour, getSettings, putSettings } = await import('./settings.ts')

beforeEach(() => {
  getDb().exec('DELETE FROM settings')
})

afterAll(() => {
  resetDbCache()
  rmSync(tmp, { recursive: true, force: true })
})

describe('設定の保存（正しい値）', () => {
  test('鍵ごとの正しい型の値はそのまま保存される', () => {
    const s = putSettings({
      boundary_hour: 5,
      daily_review_limit: 20,
      auto_retire: false,
      whisper_model_path: '/models/ggml.bin',
      glossary: 'FSRS\nts-fsrs',
      snapshot_copy_dir: '/tmp/copy',
      hallucination_phrases: ['ご視聴ありがとうございました'],
    })
    expect(s.boundary_hour).toBe(5)
    expect(s.daily_review_limit).toBe(20)
    expect(s.auto_retire).toBe(false)
    expect(s.whisper_model_path).toBe('/models/ggml.bin')
    expect(s.hallucination_phrases).toEqual(['ご視聴ありがとうございました'])
    expect(boundaryHour()).toBe(5)
  })

  test('境界の値（0 時・23 時、上限 1 件・200 件）を受け付ける', () => {
    expect(putSettings({ boundary_hour: 0 }).boundary_hour).toBe(0)
    expect(putSettings({ boundary_hour: 23 }).boundary_hour).toBe(23)
    expect(putSettings({ daily_review_limit: 1 }).daily_review_limit).toBe(1)
    expect(putSettings({ daily_review_limit: 200 }).daily_review_limit).toBe(200)
  })

  test('定型句は改行区切りの 1 本の文字列でも受ける（空行は捨てる）', () => {
    const s = putSettings({ hallucination_phrases: 'あ\n\n い ' })
    expect(s.hallucination_phrases).toEqual(['あ', 'い'])
  })

  test('未知の鍵は黙って捨てる', () => {
    const s = putSettings({ unknown_key: 1, boundary_hour: 6 })
    expect(s.boundary_hour).toBe(6)
    expect('unknown_key' in s).toBe(false)
  })
})

describe('設定の保存（不正な値は ValidationError）', () => {
  test('boundary_hour が 0〜23 の外なら拒否する', () => {
    expect(() => putSettings({ boundary_hour: 99 })).toThrow(ValidationError)
    expect(() => putSettings({ boundary_hour: -1 })).toThrow(ValidationError)
    expect(() => putSettings({ boundary_hour: 4.5 })).toThrow(ValidationError)
    expect(() => putSettings({ boundary_hour: '4' })).toThrow(ValidationError)
  })

  test('daily_review_limit が 1〜200 の外なら拒否する', () => {
    expect(() => putSettings({ daily_review_limit: 0 })).toThrow(ValidationError)
    expect(() => putSettings({ daily_review_limit: 201 })).toThrow(ValidationError)
    expect(() => putSettings({ daily_review_limit: 'abc' })).toThrow(ValidationError)
  })

  test('auto_retire は真偽値だけ。文字列は拒否する（黙って無効になるのを防ぐ）', () => {
    expect(() => putSettings({ auto_retire: 'yes' })).toThrow(ValidationError)
    expect(getSettings().auto_retire).toBe(true)
  })

  test('文字列の鍵に数値や配列を入れたら拒否する', () => {
    expect(() => putSettings({ whisper_model_path: 123 })).toThrow(ValidationError)
    expect(() => putSettings({ glossary: ['a'] })).toThrow(ValidationError)
    expect(() => putSettings({ snapshot_copy_dir: null })).toThrow(ValidationError)
  })

  test('定型句に文字列以外が混ざっていたら拒否する', () => {
    expect(() => putSettings({ hallucination_phrases: [1, 2] })).toThrow(ValidationError)
    expect(() => putSettings({ hallucination_phrases: 42 })).toThrow(ValidationError)
  })

  test('1 つでも不正なら、同じ要求の正しい値も保存しない', () => {
    expect(() => putSettings({ boundary_hour: 6, auto_retire: 'yes' })).toThrow(ValidationError)
    expect(getSettings().boundary_hour).toBe(4) // 既定値のまま
  })
})
