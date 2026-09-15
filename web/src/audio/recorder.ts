// 録音（AudioWorklet → 16kHz モノラル 16bit WAV）。検証 spikes/recorder/ を土台にしている。
// 引き継いだ注意点：
//  - AudioContext は sampleRate: 16000 を指定して作り、実際の値が違えば線形補間でリサンプリングする。
//  - AudioWorkletNode は destination に繋がっていないと process() が呼ばれない。ゲイン 0 の GainNode を経由させる。
//  - Worklet からメインスレッドへ渡す Float32Array は毎回コピーする（Worklet 側で slice 済み）。
//  - AudioContext の生成と resume はクリック処理の中で行う。
//  - 停止時はトラック停止・ノード切断・close を確実に行う（マイク使用中の表示が消えない不具合を防ぐ）。
// Worklet の中身を文字列として取り込み、実行時に Blob の URL にして読み込む。
// `?url` だと本番ビルドで小さいファイルが data: URL に埋め込まれ、
// AudioWorklet.addModule がブラウザによって読めないことがあるため、この形にしている。
import workletSource from './recorder-worklet.js?raw'

let workletUrlCache: string | null = null

function workletUrl(): string {
  if (workletUrlCache) return workletUrlCache
  workletUrlCache = URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }))
  return workletUrlCache
}

/** whisper.cpp が受け付ける唯一の形式。 */
export const TARGET_SAMPLE_RATE = 16000

/** 無音とみなす音量（RMS＝音量の実効値）のしきい値。これ未満が続く区間を先頭・末尾から切り落とす。 */
export const SILENCE_RMS_THRESHOLD = 0.01

/** 無音を切り落とすときに前後へ残す余白（秒）。切りすぎて語頭が欠けるのを防ぐ。 */
export const SILENCE_KEEP_MARGIN_SEC = 0.3

/** 最長の録音時間（秒）。これを過ぎたら自動で停止する。 */
export const MAX_RECORDING_SEC = 600

/** 無音判定をする窓の長さ（秒）。 */
const RMS_WINDOW_SEC = 0.02

/** マイクが使えないときに投げる。message はそのまま画面に出さず、呼び出し側が文言を選ぶ。 */
export class MicPermissionError extends Error {}

export function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] ?? 0
    sum += v * v
  }
  return Math.sqrt(sum / samples.length)
}

/** 複数のブロックを 1 本の Float32Array に繋ぐ。 */
export function mergeChunks(chunks: Float32Array[]): Float32Array {
  let total = 0
  for (const c of chunks) total += c.length
  const merged = new Float32Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.length
  }
  return merged
}

/** 線形補間でサンプルレートを変える。 */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input
  const ratio = from / to
  const length = Math.round(input.length / ratio)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = pos - i0
    out[i] = (input[i0] ?? 0) * (1 - frac) + (input[i1] ?? 0) * frac
  }
  return out
}

/**
 * 先頭と末尾の無音を切り落とす（要件 J4）。
 * 窓ごとの RMS がしきい値を超える最初と最後の位置を探し、前後に余白を残して切る。
 * 全部が無音なら元のまま返す（判断は文字起こし側の後処理に任せる）。
 */
export function trimSilence(
  samples: Float32Array,
  sampleRate: number,
  threshold = SILENCE_RMS_THRESHOLD,
  marginSec = SILENCE_KEEP_MARGIN_SEC,
): Float32Array {
  const windowSize = Math.max(1, Math.floor(sampleRate * RMS_WINDOW_SEC))
  let first = -1
  let last = -1
  for (let start = 0; start < samples.length; start += windowSize) {
    const end = Math.min(start + windowSize, samples.length)
    if (computeRms(samples.subarray(start, end)) >= threshold) {
      if (first < 0) first = start
      last = end
    }
  }
  if (first < 0) return samples
  const margin = Math.floor(sampleRate * marginSec)
  const from = Math.max(0, first - margin)
  const to = Math.min(samples.length, last + margin)
  return samples.slice(from, to)
}

/** Float32(-1..1) を 16kHz モノラル 16bit PCM の WAV（44 バイトヘッダ）にする。 */
export function encodeWav(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): Blob {
  const int16 = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  const numChannels = 1
  const bitsPerSample = 16
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataSize = int16.length * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt チャンクの大きさ（PCM は 16）
  view.setUint16(20, 1, true) // 形式 1 = PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  ascii(36, 'data')
  view.setUint32(40, dataSize, true)
  let offset = 44
  for (let i = 0; i < int16.length; i++) {
    view.setInt16(offset, int16[i] ?? 0, true)
    offset += 2
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

export type RecorderHandle = {
  /** 録音を止めて WAV を作る。二度目以降は同じ結果を返さず null。 */
  stop(): Promise<{ wav: Blob; durationSec: number } | null>
  /** 結果を捨てて後片付けだけする。 */
  cancel(): Promise<void>
}

export type StartOptions = {
  /** 音量メーター用。0〜1 くらいの RMS を細かく渡す。 */
  onLevel?: (rms: number) => void
  /** 最長時間に達して自動停止したときに呼ばれる。 */
  onAutoStop?: () => void
  maxSeconds?: number
}

/**
 * 録音を始める。必ずクリック処理の中から呼ぶこと（AudioContext の生成と resume がクリック内である必要がある）。
 * マイクが拒否されたときは MicPermissionError を投げる。
 */
export async function startRecording(options: StartOptions = {}): Promise<RecorderHandle> {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (e) {
    throw new MicPermissionError(e instanceof Error ? e.message : String(e))
  }

  const ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE })
  if (ctx.state === 'suspended') await ctx.resume()
  await ctx.audioWorklet.addModule(workletUrl())

  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'recorder-processor')
  const chunks: Float32Array[] = []
  node.port.onmessage = (event: MessageEvent) => {
    const block = event.data as Float32Array
    chunks.push(block)
    options.onLevel?.(computeRms(block))
  }
  source.connect(node)
  // Web Audio は destination まで繋がっていないと処理自体が走らない。
  // 録音の音は要らないのでゲイン 0 の GainNode を経由させる。
  const silent = ctx.createGain()
  silent.gain.value = 0
  node.connect(silent)
  silent.connect(ctx.destination)

  let finished = false
  let autoStopTimer: ReturnType<typeof setTimeout> | null = null

  async function teardown(): Promise<number> {
    const sourceRate = ctx.sampleRate
    if (autoStopTimer) clearTimeout(autoStopTimer)
    try {
      source.disconnect()
    } catch {
      /* 既に切れている */
    }
    try {
      node.disconnect()
      silent.disconnect()
    } catch {
      /* 既に切れている */
    }
    for (const track of stream.getTracks()) track.stop()
    await ctx.close()
    return sourceRate
  }

  const handle: RecorderHandle = {
    async stop() {
      if (finished) return null
      finished = true
      const sourceRate = await teardown()
      if (chunks.length === 0) return null
      const merged = mergeChunks(chunks)
      const resampled = resample(merged, sourceRate, TARGET_SAMPLE_RATE)
      const trimmed = trimSilence(resampled, TARGET_SAMPLE_RATE)
      return {
        wav: encodeWav(trimmed, TARGET_SAMPLE_RATE),
        durationSec: trimmed.length / TARGET_SAMPLE_RATE,
      }
    },
    async cancel() {
      if (finished) return
      finished = true
      await teardown()
    },
  }

  const maxSeconds = options.maxSeconds ?? MAX_RECORDING_SEC
  autoStopTimer = setTimeout(() => {
    options.onAutoStop?.()
  }, maxSeconds * 1000)

  return handle
}
