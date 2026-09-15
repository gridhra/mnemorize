// 「文字起こし中…」のカード（要件 C2）。録音停止直後に一覧の先頭へ出し、
// サーバー送信イベント（SSE）で届く部分結果を順に流し込む。完了したら一覧を取り直す。
import { useEffect, useRef, useState } from 'preact/hooks'
import { api, type TranscriptionJob } from '../api.ts'
import { ja } from '../i18n/ja.ts'

type Props = {
  jobId: string
  /** 完了したとき（一覧の再取得に使う）。 */
  onDone: (entryId: string | null) => void
  /** カードを閉じるとき。 */
  onDismiss: (jobId: string) => void
}

type Status = 'waiting' | 'running' | 'failed'

export function TranscribingCard({ jobId, onDone, onDismiss }: Props) {
  const [status, setStatus] = useState<Status>('waiting')
  const [segments, setSegments] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [retrying, setRetrying] = useState(false)
  // 再試行のたびに増やして、購読（SSE）を貼り直す。
  const [attempt, setAttempt] = useState(0)
  const startedAt = useRef(Date.now())

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const source = new EventSource(api.transcriptionEventsUrl(jobId))
    let closed = false
    const close = () => {
      if (!closed) {
        closed = true
        source.close()
      }
    }

    source.addEventListener('status', (e) => {
      const job = (JSON.parse((e as MessageEvent).data).job ?? null) as TranscriptionJob | null
      if (!job) return
      if (job.status === 'done') {
        close()
        onDone(job.entry_id)
      } else if (job.status === 'failed') {
        setStatus('failed')
        setError(job.error)
        close()
      } else {
        setStatus(job.status === 'running' ? 'running' : 'waiting')
      }
    })
    source.addEventListener('segment', (e) => {
      const data = JSON.parse((e as MessageEvent).data)
      setStatus('running')
      setSegments((cur) => [...cur, String(data.segment?.text ?? '')])
    })
    source.addEventListener('warning', (e) => {
      const data = JSON.parse((e as MessageEvent).data)
      setWarnings((cur) => [...cur, String(data.message ?? '')])
    })
    source.addEventListener('done', (e) => {
      const data = JSON.parse((e as MessageEvent).data)
      close()
      onDone((data.entry_id as string | null) ?? null)
    })
    source.addEventListener('failed', (e) => {
      const data = JSON.parse((e as MessageEvent).data)
      setStatus('failed')
      setError(String(data.error ?? ''))
      close()
    })
    source.onerror = () => {
      // 接続が切れたら状態を 1 回だけ問い合わせて決着をつける（完了直後の切断と区別するため）。
      close()
      api
        .transcription(jobId)
        .then(({ job }) => {
          if (job.status === 'done') onDone(job.entry_id)
          else if (job.status === 'failed') {
            setStatus('failed')
            setError(job.error)
          }
        })
        .catch(() => {
          setStatus('failed')
          setError(ja.error.generic)
        })
    }

    return close
  }, [jobId, attempt])

  async function retry() {
    setRetrying(true)
    try {
      await api.retryTranscription(jobId)
      setSegments([])
      setWarnings([])
      setError(null)
      setStatus('waiting')
      startedAt.current = Date.now()
      setElapsed(0)
      setAttempt((n) => n + 1) // 購読を貼り直す
    } catch (e) {
      setError(e instanceof Error ? e.message : ja.error.generic)
    } finally {
      setRetrying(false)
    }
  }

  return (
    <article class="card transcribing">
      <header class="card-head">
        <h2 class="card-title">
          {status === 'failed' ? ja.transcribe.failed : ja.transcribe.title}
        </h2>
        <div class="card-meta">
          {status !== 'failed' && <span class="badge subtle">{ja.transcribe.elapsed(elapsed)}</span>}
        </div>
      </header>

      {status !== 'failed' && (
        <div class="card-body prose">
          {segments.length === 0 ? (
            <p class="muted">{status === 'waiting' ? ja.transcribe.waiting : ja.transcribe.listening}</p>
          ) : (
            <p>{segments.join('')}</p>
          )}
        </div>
      )}

      {warnings.map((w) => (
        <small class="hint" key={w}>
          {ja.transcribe.warningPrefix}
          {w}
        </small>
      ))}

      {status === 'failed' && (
        <>
          <p class="error">
            {ja.error.prefix}
            {error}
          </p>
          <footer class="card-actions">
            <button type="button" class="button" disabled={retrying} onClick={() => void retry()}>
              {retrying ? ja.transcribe.retrying : ja.transcribe.retry}
            </button>
            <button type="button" class="button ghost" onClick={() => onDismiss(jobId)}>
              {ja.transcribe.dismiss}
            </button>
          </footer>
        </>
      )}
    </article>
  )
}
