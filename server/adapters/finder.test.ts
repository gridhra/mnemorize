// パス検証だけを確かめる。`open` は実行しない（環境依存・副作用があるため）。
import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = mkdtempSync(join(tmpdir(), 'mnemorize-finder-test-'))
process.env.MNEMORIZE_DATA_DIR = tmp

const { assertWithinDataDir } = await import('./finder.ts')
const { ValidationError } = await import('../services/entries.ts')

describe('assertWithinDataDir', () => {
  test('データ置き場そのものは許可する', () => {
    expect(assertWithinDataDir(tmp)).toBe(tmp)
  })

  test('データ置き場配下のパスは許可する', () => {
    const target = join(tmp, 'export', 'markdown')
    expect(assertWithinDataDir(target)).toBe(target)
  })

  test('データ置き場の外のパスは拒否する', () => {
    expect(() => assertWithinDataDir('/etc/passwd')).toThrow(ValidationError)
    expect(() => assertWithinDataDir(tmp + '-sibling')).toThrow(ValidationError)
  })
})
