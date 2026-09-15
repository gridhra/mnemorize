// 画面側の見出しの決め方が、入出力表（headline.cases.ts）どおりに動くことの確認。
// 同じ表をサーバー側のテスト（server/services/entries.test.ts）も使っている。
import { describe, expect, test } from 'bun:test'
import { HEADLINE_CASES } from './headline.cases.ts'
import { headlineOf } from './headline.ts'

describe('見出しの決め方（画面側）', () => {
  for (const c of HEADLINE_CASES) {
    test(c.name, () => {
      expect(headlineOf(c.title, c.body)).toBe(c.expected)
    })
  }
})
