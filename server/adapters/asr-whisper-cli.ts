// whisper.cpp の whisper-cli をサブプロセスで呼ぶアダプタ。
// 外界（サブプロセス・一時ファイル）に触れるのはここだけ。テストでは AsrAdapter を偽物に差し替える。
//
// 重要（検証ノート docs/research/06-spike-whisper.md）：
//  - `-nt`（--no-timestamps）は絶対に付けない。表示上の省略ではなくデコード自体が変わり、
//    実測で文が丸ごと落ちた（文字誤り率 49.6% → 外すと 8.8%）。
//  - `-l ja` は必須。言語自動判定は日本語音声を英語と誤判定する。
//  - `-fa`（flash attention）は速度改善が確認済み。
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlink } from 'node:fs/promises'
import { getSettings } from '../services/settings.ts'

/** 1 セグメント（whisper のタイムスタンプ付きの一区切り）。 */
export type AsrSegment = {
  /** 開始位置（ミリ秒） */
  from_ms: number
  /** 終了位置（ミリ秒） */
  to_ms: number
  text: string
}

export type AsrResult = {
  /** セグメントを結合した本文（後処理前。ASR 出力そのまま。要件 C3） */
  text: string
  segments: AsrSegment[]
  /** 使ったモデルファイルのパス */
  model: string
  /** 使った初期プロンプト */
  prompt: string
}

export type AsrOptions = {
  /** モデルファイルの絶対パス。省略時は設定の値を使う。 */
  modelPath?: string
  /** 初期プロンプト。省略時は設定の用語リストから組み立てる。 */
  prompt?: string
  /** これを過ぎたらプロセスを止めて失敗にする（既定 10 分）。 */
  timeoutMs?: number
}

/** 文字起こしの実装が満たす形。テストではこれを満たす偽物に差し替える。 */
export type AsrAdapter = {
  transcribe(
    wavPath: string,
    opts: AsrOptions,
    onSegment?: (segment: AsrSegment) => void,
  ): Promise<AsrResult>
}

/** 文字起こしに失敗したときに投げる。message には標準エラー出力の末尾を含める。 */
export class AsrError extends Error {}

export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

/**
 * 設定のパスにモデルファイルが無いときの保険として順に探す候補。
 * 設定の既定値（server/services/settings.ts の DEFAULT_WHISPER_MODEL_PATH）は
 * この最初の候補と同じ実パスだが、意味は別：こちらは「設定の値が使えないときの保険」であって
 * 「標準の場所を探す」機能ではない（設定に値があれば必ずそちらを優先する）。
 */
export const MODEL_CANDIDATES = [
  join(homedir(), '.cache', 'whisper-cpp', 'ggml-large-v3-turbo.bin'),
  join(homedir(), '.cache', 'whisper-cpp', 'ggml-large-v3-turbo-q5_0.bin'),
]

/** モデルパスの解決結果。設定の値そのものが使えたか、保険の候補に回ったかを区別する。 */
export type ModelStatus = {
  /** 設定 whisper_model_path の値（空文字もありうる）。 */
  configuredPath: string
  /** 設定の値のファイルが実在するか。 */
  configuredExists: boolean
  /** 実際に使うパス。設定の値が使えればそれ、使えなければ保険の候補、どちらも無ければ null。 */
  effectivePath: string | null
  /** 保険の候補を使うことになったか（設定の値が使えなかった場合のみ true になりうる）。 */
  usedFallback: boolean
}

/** 設定のモデルパスを優先し、無ければ保険の候補を順に探す。 */
export async function resolveModelStatus(configured?: string): Promise<ModelStatus> {
  const configuredPath = configured ?? getSettings().whisper_model_path
  const configuredExists = configuredPath.length > 0 && (await Bun.file(configuredPath).exists())
  if (configuredExists) {
    return { configuredPath, configuredExists: true, effectivePath: configuredPath, usedFallback: false }
  }
  for (const candidate of MODEL_CANDIDATES) {
    if (await Bun.file(candidate).exists()) {
      return { configuredPath, configuredExists: false, effectivePath: candidate, usedFallback: true }
    }
  }
  return { configuredPath, configuredExists: false, effectivePath: null, usedFallback: false }
}

/** 設定のモデルパス、無ければ保険の候補を順に探す。見つからなければ null。 */
export async function resolveModelPath(configured?: string): Promise<string | null> {
  return (await resolveModelStatus(configured)).effectivePath
}

/**
 * 初期プロンプトを組み立てる。設定の用語リスト（1 行 1 語）を読点区切りにしたものが主体。
 * 長い例文はハルシネーションの原因になるので入れない（検証ノート 4-2）。
 */
export function buildPrompt(glossary: string): string {
  const terms = glossary
    .split(/[\n,、]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
  const head = '以下は、今日の学習内容を日本語で話した記録です。'
  return terms.length > 0 ? `${head}${terms.join('、')}。` : head
}

/** `00:01:02.345` / `00:01:02,345` をミリ秒に直す。読めなければ null。 */
export function parseTimestamp(text: string): number | null {
  const m = /^(\d{2}):(\d{2}):(\d{2})[.,](\d{3})$/.exec(text.trim())
  if (!m) return null
  return Number(m[1]) * 3600000 + Number(m[2]) * 60000 + Number(m[3]) * 1000 + Number(m[4])
}

/**
 * 標準出力の 1 行 `[00:00:00.000 --> 00:00:05.120]  本文` をセグメントにする。
 * セグメント行でなければ（進捗表示・空行など）null を返す。
 */
export function parseSegmentLine(line: string): AsrSegment | null {
  const m = /^\s*\[([\d:.,]+)\s*-->\s*([\d:.,]+)\]\s*(.*)$/.exec(line)
  if (!m) return null
  const from = parseTimestamp(m[1] ?? '')
  const to = parseTimestamp(m[2] ?? '')
  if (from === null || to === null) return null
  const text = (m[3] ?? '').trim()
  if (text.length === 0) return null
  return { from_ms: from, to_ms: to, text }
}

/** whisper-cli が `-oj` で書く JSON の形（必要な部分だけ）。 */
type WhisperJson = {
  transcription?: {
    offsets?: { from?: number; to?: number }
    timestamps?: { from?: string; to?: string }
    text?: string
  }[]
}

/** `-oj` が書いた JSON からセグメントを組み立てる。 */
export function segmentsFromJson(json: unknown): AsrSegment[] {
  const list = (json as WhisperJson)?.transcription
  if (!Array.isArray(list)) return []
  const out: AsrSegment[] = []
  for (const item of list) {
    const text = (item?.text ?? '').trim()
    if (text.length === 0) continue
    const from =
      typeof item?.offsets?.from === 'number'
        ? item.offsets.from
        : (parseTimestamp(item?.timestamps?.from ?? '') ?? 0)
    const to =
      typeof item?.offsets?.to === 'number'
        ? item.offsets.to
        : (parseTimestamp(item?.timestamps?.to ?? '') ?? from)
    out.push({ from_ms: from, to_ms: to, text })
  }
  return out
}

const LATIN_EDGE = /[A-Za-z0-9)\]]$/
const LATIN_START = /^[A-Za-z0-9([]/

/**
 * セグメントを 1 本の本文に結合する。
 * 日本語どうしの境界には空白を入れない。ラテン文字・数字どうしが隣り合うときだけ空白を挟む。
 */
export function joinSegmentTexts(segments: { text: string }[]): string {
  let out = ''
  for (const seg of segments) {
    const text = seg.text.trim()
    if (text.length === 0) continue
    if (out.length === 0) {
      out = text
      continue
    }
    const needsSpace = LATIN_EDGE.test(out) && LATIN_START.test(text)
    out += needsSpace ? ` ${text}` : text
  }
  return out
}

/** 実際に whisper-cli を起動するアダプタ。 */
export const whisperCliAdapter: AsrAdapter = {
  async transcribe(wavPath, opts, onSegment) {
    const configured = opts.modelPath ?? getSettings().whisper_model_path
    const modelPath = await resolveModelPath(configured)
    if (!modelPath) {
      throw new AsrError(
        configured && configured.length > 0
          ? `モデルファイルが見つかりません：${configured}`
          : 'whisper.cpp のモデルファイルが見つかりません。設定でモデルのパスを指定してください。',
      )
    }
    const prompt = opts.prompt ?? buildPrompt(getSettings().glossary)
    const outBase = join(tmpdir(), `mnemorize-asr-${Bun.randomUUIDv7()}`)
    const jsonPath = `${outBase}.json`

    // -nt は絶対に付けない（ファイル冒頭の注記）。
    const args = [
      'whisper-cli',
      '-m',
      modelPath,
      '-l',
      'ja',
      '-fa',
      '--prompt',
      prompt,
      '-oj',
      '-of',
      outBase,
      '-f',
      wavPath,
    ]

    let proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
    try {
      proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
    } catch (e) {
      throw new AsrError(
        `whisper-cli を起動できませんでした（${e instanceof Error ? e.message : String(e)}）`,
      )
    }

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill()
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

    const streamed: AsrSegment[] = []
    const readStdout = (async () => {
      const decoder = new TextDecoder()
      const reader = proc.stdout.getReader()
      let buffered = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffered += decoder.decode(value, { stream: true })
        const lines = buffered.split('\n')
        buffered = lines.pop() ?? ''
        for (const line of lines) {
          const seg = parseSegmentLine(line)
          if (!seg) continue
          streamed.push(seg)
          onSegment?.(seg)
        }
      }
      const last = parseSegmentLine(buffered)
      if (last) {
        streamed.push(last)
        onSegment?.(last)
      }
    })()
    const readStderr = new Response(proc.stderr).text()

    const exitCode = await proc.exited
    clearTimeout(timer)
    await readStdout
    const stderr = await readStderr

    if (timedOut) {
      await unlink(jsonPath).catch(() => {})
      throw new AsrError('文字起こしが時間内に終わりませんでした（打ち切りました）')
    }
    if (exitCode !== 0) {
      await unlink(jsonPath).catch(() => {})
      throw new AsrError(`whisper-cli が失敗しました（終了コード ${exitCode}）\n${tail(stderr)}`)
    }

    // 完了後に JSON を読む。読めなければ標準出力から拾ったセグメントで代用する。
    let segments = streamed
    try {
      const json = await Bun.file(jsonPath).json()
      const fromJson = segmentsFromJson(json)
      if (fromJson.length > 0) segments = fromJson
    } catch {
      // JSON が読めなくても標準出力の結果があれば続行する。
    } finally {
      await unlink(jsonPath).catch(() => {})
    }

    if (segments.length === 0) {
      throw new AsrError(`文字起こしの結果が空でした\n${tail(stderr)}`)
    }
    return { text: joinSegmentTexts(segments), segments, model: modelPath, prompt }
  },
}

/** 標準エラー出力の末尾（失敗の原因を伝えるため。長すぎると読めないので切る）。 */
export function tail(text: string, maxChars = 800): string {
  const trimmed = text.trimEnd()
  return trimmed.length <= maxChars ? trimmed : `…${trimmed.slice(-maxChars)}`
}
