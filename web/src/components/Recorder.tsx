// 録音ボタン。押して開始、もう一度押すと停止して文字起こしに送る（要件 C1）。
// 文字起こしの結果はこの部品の外（新規作成・編集のフォームの本文欄）に流れ込む。
import type { ComponentChildren } from 'preact'
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
  /** 画面に出している学習日。どの日の録音かをジョブに覚えさせるためだけに使う。 */
  dayDate: string
  /**
   * 文字起こしジョブができたら知らせる。
   * ジョブは記録を作らない。結果は呼び出し元（フォーム）が本文欄に流し込む。
   */
  onJobCreated: (jobId: string) => void
  /** 塗りつぶしの大きいボタンにする（新規作成欄の主操作）。既定は枠線のボタン。 */
  primary?: boolean
  /** 既存の記録の編集では「録音して書き足す」という名前にする。 */
  append?: boolean
  /** ボタンの下に出す文字起こしの状態1行（呼び出し元が描く）。 */
  children?: ComponentChildren
  /**
   * 呼び出し元が状態1行（文字起こしの行）を出しているか。
   * 出ているあいだは「録音は最長10分です」を引っ込める——状態行は 1 つだけで、
   * 待機中・録音中・停止後で中身だけが入れ替わる（原則B）。
   */
  hasStatus?: boolean
}

type Phase = 'idle' | 'preparing' | 'recording' | 'sending'

export function Recorder({ dayDate, onJobCreated, primary, append, children, hasStatus }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [waitingPermission, setWaitingPermission] = useState(false)
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
    setWaitingPermission(false)
    setPhase('preparing')
    // 許可ダイアログが出たまま止まっているように見える不安を減らすため、
    // 3 秒たっても準備中のままなら案内を出す。
    const waitTimer = setTimeout(() => setWaitingPermission(true), 3000)
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
      if (!(e instanceof MicPermissionError)) {
        console.error('[recorder]', e)
      }
      setPhase('idle')
      setError(
        e instanceof MicPermissionError
          ? ja.recorder.permissionDenied
          : ja.recorder.startFailed(e instanceof Error ? e.name : String(e)),
      )
    } finally {
      clearTimeout(waitTimer)
      setWaitingPermission(false)
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
      const res = await api.createTranscription(result.wav, { day_date: dayDate })
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
      {/* 文言が 5 通りに変わるボタン。箱の幅は最長の文言に合わせて固定してあり、
          押しても位置も大きさも変わらない（.toggle-record。操作の原則11a）。 */}
      <button
        type="button"
        class={`button toggle-record${primary || recording ? ' primary' : ''}`}
        disabled={busy}
        onClick={() => void (recording ? stop() : start())}
      >
        {recording
          ? ja.recorder.stop
          : phase === 'preparing'
            ? ja.recorder.preparing
            : phase === 'sending'
              ? ja.recorder.sending
              : append
                ? ja.recorder.appendToEntry
                : ja.recorder.start}
      </button>

      {/*
        状態1行。録音ボタンのすぐ下の決まった場所に 1 つだけ置き、中身だけが入れ替わる
        （待機中は「録音は最長10分です」、録音中は経過と音量、停止後は文字起こしの状態）。
        以前は「最長10分」が別の行として録音ボタンの下に孤立していた（2026-09-15の指摘）。
      */}
      <div class="recorder-status">
        {recording ? (
          <span class="recorder-live">
            <span class="badge">
              {ja.recorder.recording} {ja.recorder.elapsed(elapsed)}
            </span>
            <span class="recorder-meter" aria-hidden="true">
              <span class="recorder-meter-bar" style={`width:${meterWidth}`} />
            </span>
          </span>
        ) : !busy && !hasStatus ? (
          <small class="hint">{ja.recorder.maxMinutes}</small>
        ) : null}
        {children}
      </div>

      <small class="hint recorder-permission-hint">
        {waitingPermission ? ja.recorder.waitingPermission : ''}
      </small>

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
