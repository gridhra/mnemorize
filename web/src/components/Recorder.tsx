// 録音ボタン。押して開始、もう一度押すと停止して文字起こしに送る（要件 C1）。
import { useEffect, useRef, useState } from 'preact/hooks'
import { api } from '../api.ts'
import { ja } from '../i18n/ja.ts'
import {
  MAX_RECORDING_SEC,
  MicPermissionError,
  startRecording,
  type RecorderHandle,
} from '../audio/recorder.ts'

type Props = {
  /** 記録をこれから作る場合の学習日（画面に出している日付）。 */
  dayDate: string
  /** 既存の記録に追記する場合その id。 */
  entryId?: string
  /** ジョブができたら知らせる（一覧の先頭に「文字起こし中」カードを出すため）。 */
  onJobCreated: (jobId: string) => void
  /** 大きいボタン（新規作成欄）か、小さいボタン（既存の記録への追記）か。 */
  compact?: boolean
}

type Phase = 'idle' | 'preparing' | 'recording' | 'sending'

export function Recorder({ dayDate, entryId, onJobCreated, compact }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const handleRef = useRef<RecorderHandle | null>(null)
  const startedAtRef = useRef(0)

  // 経過時間の表示。録音中だけ動かす。
  useEffect(() => {
    if (phase !== 'recording') return
    const timer = setInterval(() => {
      setElapsed((Date.now() - startedAtRef.current) / 1000)
    }, 200)
    return () => clearInterval(timer)
  }, [phase])

  // 画面から消えるときはマイクを必ず解放する。
  useEffect(() => {
    return () => {
      void handleRef.current?.cancel()
      handleRef.current = null
    }
  }, [])

  async function start() {
    if (phase !== 'idle') return
    setError(null)
    setMessage(null)
    setPhase('preparing')
    try {
      // AudioContext の生成と resume はこのクリック処理の中で行う必要がある。
      const handle = await startRecording({
        onLevel: (rms) => setLevel(rms),
        onAutoStop: () => {
          setMessage(ja.recorder.autoStopped)
          void stop()
        },
        maxSeconds: MAX_RECORDING_SEC,
      })
      handleRef.current = handle
      startedAtRef.current = Date.now()
      setElapsed(0)
      setPhase('recording')
    } catch (e) {
      setPhase('idle')
      setError(e instanceof MicPermissionError ? ja.recorder.permissionDenied : ja.error.generic)
    }
  }

  async function stop() {
    const handle = handleRef.current
    if (!handle) return
    handleRef.current = null
    setPhase('sending')
    setLevel(0)
    try {
      const result = await handle.stop()
      if (!result || result.wav.size <= 44) {
        setError(ja.recorder.emptyRecording)
        setPhase('idle')
        return
      }
      const res = await api.createTranscription(result.wav, {
        day_date: entryId ? null : dayDate,
        entry_id: entryId ?? null,
      })
      onJobCreated(res.job_id)
      setPhase('idle')
    } catch (e) {
      setError(e instanceof Error ? e.message : ja.error.generic)
      setPhase('idle')
    }
  }

  const recording = phase === 'recording'
  const busy = phase === 'preparing' || phase === 'sending'
  const meterWidth = `${Math.min(100, level * 200)}%`

  return (
    <div class="recorder">
      <button
        type="button"
        class={`button ${recording ? 'primary' : compact ? 'ghost' : 'primary'}`}
        disabled={busy}
        onClick={() => void (recording ? stop() : start())}
      >
        {recording
          ? ja.recorder.stop
          : phase === 'preparing'
            ? ja.recorder.preparing
            : phase === 'sending'
              ? ja.recorder.sending
              : entryId
                ? ja.recorder.appendToEntry
                : ja.recorder.start}
      </button>

      {recording && (
        <span class="recorder-status">
          <span class="badge">
            {ja.recorder.recording} {ja.recorder.elapsed(elapsed)}
          </span>
          <span
            class="recorder-meter"
            aria-hidden="true"
            style="display:inline-block;width:96px;height:8px;border-radius:4px;background:rgba(127,127,127,0.25);overflow:hidden;vertical-align:middle;margin-left:8px"
          >
            <span
              style={`display:block;height:100%;width:${meterWidth};background:currentColor;transition:width 60ms linear`}
            />
          </span>
        </span>
      )}

      {!recording && !busy && <small class="hint">{ja.recorder.maxMinutes}</small>}
      {message && <small class="hint">{message}</small>}
      {error && (
        <p class="error">
          {ja.error.prefix}
          {error}
        </p>
      )}
    </div>
  )
}
