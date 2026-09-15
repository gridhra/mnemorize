// whisper-cli アダプタのうち、サブプロセスを起動しない部分（パーサ・結合・プロンプト）のテスト。
// 実際に whisper-cli を叩く通しテストは環境変数 MNEMORIZE_RUN_WHISPER=1 のときだけ動かす。
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildPrompt,
  joinSegmentTexts,
  parseSegmentLine,
  parseTimestamp,
  segmentsFromJson,
  tail,
  whisperCliAdapter,
} from './asr-whisper-cli.ts'

describe('標準出力の 1 行をセグメントにする', () => {
  test('タイムスタンプ付きの行を読む', () => {
    const seg = parseSegmentLine('[00:00:00.000 --> 00:00:04.680]   今日は、線形代数の章を読んだ。')
    expect(seg).toEqual({
      from_ms: 0,
      to_ms: 4680,
      text: '今日は、線形代数の章を読んだ。',
    })
  })

  test('1 時間を超える位置も読む', () => {
    expect(parseSegmentLine('[01:02:03.004 --> 01:02:05.000]  あ')?.from_ms).toBe(3723004)
  })

  test('カンマ区切りのミリ秒（JSON と同じ形）も読む', () => {
    expect(parseTimestamp('00:00:05,120')).toBe(5120)
  })

  test('セグメント行でなければ null', () => {
    expect(parseSegmentLine('whisper_init_from_file_with_params_no_state: loading model')).toBeNull()
    expect(parseSegmentLine('')).toBeNull()
    // 本文が空の行は捨てる
    expect(parseSegmentLine('[00:00:00.000 --> 00:00:01.000]   ')).toBeNull()
  })
})

describe('-oj が書いた JSON からセグメントを組み立てる', () => {
  test('offsets を使う', () => {
    const json = {
      transcription: [
        { offsets: { from: 0, to: 4680 }, text: ' 今日は、線形代数の' },
        { offsets: { from: 4680, to: 9000 }, text: '固有値の章を読んだ。' },
        { offsets: { from: 9000, to: 9100 }, text: '  ' },
      ],
    }
    const segs = segmentsFromJson(json)
    expect(segs).toHaveLength(2)
    expect(joinSegmentTexts(segs)).toBe('今日は、線形代数の固有値の章を読んだ。')
  })

  test('offsets が無ければ timestamps から読む', () => {
    const segs = segmentsFromJson({
      transcription: [{ timestamps: { from: '00:00:01,500', to: '00:00:02,000' }, text: 'あ' }],
    })
    expect(segs[0]?.from_ms).toBe(1500)
  })

  test('形が違えば空配列', () => {
    expect(segmentsFromJson({})).toEqual([])
    expect(segmentsFromJson(null)).toEqual([])
  })
})

describe('セグメントの結合', () => {
  test('日本語どうしの境界には空白を入れない', () => {
    expect(joinSegmentTexts([{ text: '今日は本を読んだ。' }, { text: 'あとで復習する。' }])).toBe(
      '今日は本を読んだ。あとで復習する。',
    )
  })

  test('ラテン文字どうしが隣り合うときだけ空白を入れる', () => {
    expect(joinSegmentTexts([{ text: 'useEffect' }, { text: 'cleanup' }])).toBe('useEffect cleanup')
    expect(joinSegmentTexts([{ text: 'React の' }, { text: 'useEffect を見た' }])).toBe(
      'React のuseEffect を見た',
    )
  })
})

describe('初期プロンプト', () => {
  test('用語リストを読点区切りにして添える', () => {
    expect(buildPrompt('React\nuseEffect\nSQLite')).toBe(
      '以下は、今日の学習内容を日本語で話した記録です。React、useEffect、SQLite。',
    )
  })

  test('用語が無ければ短い一文だけ', () => {
    expect(buildPrompt('  ')).toBe('以下は、今日の学習内容を日本語で話した記録です。')
  })
})

test('標準エラー出力の末尾だけを取り出す', () => {
  expect(tail('abcdef', 3)).toBe('…def')
  expect(tail('abc\n\n', 10)).toBe('abc')
})

// --- 実機テスト（whisper-cli を実際に起動する。既定では走らせない） ---
const samplePath = join(import.meta.dir, '..', '..', 'spikes', 'whisper', 'samples', 'sample_a.wav')
const runReal = process.env.MNEMORIZE_RUN_WHISPER === '1' && existsSync(samplePath)

const describeReal = runReal ? describe : describe.skip

describeReal('実機：whisper-cli を起動する', () => {
  test(
    'サンプル音声を文字起こしできる',
    async () => {
      const segments: string[] = []
      const result = await whisperCliAdapter.transcribe(samplePath, {}, (s) => {
        segments.push(s.text)
      })
      expect(result.segments.length).toBeGreaterThan(0)
      expect(result.text).toContain('固有値')
      expect(segments.length).toBeGreaterThan(0) // 部分結果が届いている
    },
    5 * 60 * 1000,
  )
})
