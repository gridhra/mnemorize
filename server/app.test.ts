// 共通エラーハンドラ（createApp の app.onError）の HTTP 応答のテスト。
// DB を使うルート（/api/settings）を通すので一時ディレクトリに独立した DB を作る。
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = mkdtempSync(join(tmpdir(), 'mnemorize-app-test-'))
process.env.MNEMORIZE_DATA_DIR = tmp

const { resetDbCache } = await import('./db/connection.ts')
const { createApp } = await import('./app.ts')

afterAll(() => {
  resetDbCache()
  rmSync(tmp, { recursive: true, force: true })
})

describe('PUT /api/settings の検証エラー応答', () => {
  test('不正な値は 400 で { error, field } を返す', async () => {
    const app = createApp()
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ daily_review_limit: 0 }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(typeof body.error).toBe('string')
    expect(body.field).toBe('daily_review_limit')
  })

  test('field を持たないエラー（不正な日付）は従来どおり { error } だけを返す', async () => {
    const app = createApp()
    const res = await app.request('/api/days/not-a-date')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(typeof body.error).toBe('string')
    expect('field' in body).toBe(false)
  })
})
