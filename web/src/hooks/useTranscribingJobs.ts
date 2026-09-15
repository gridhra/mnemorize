// 文字起こし中カードの一覧を持つフック。「今日」の画面と「日」の画面が同じものを出す。
//
// その日の、まだ決着していない（queued / running / failed の）文字起こしジョブを
// サーバーから読む。これが無いと、ブラウザ自身が始めた録音のジョブしかカードに
// 出ない（再読み込みしたあとや、別の経路で作られたジョブの失敗が画面から見えなくなる）。
import { useEffect, useState } from 'preact/hooks'
import { api } from '../api.ts'

export type TranscribingJobs = {
  /** 表示するジョブの id。新しいものが先頭（要件 C2）。 */
  jobIds: string[]
  /** 録音から新しいジョブができたときに先頭へ足す。 */
  addJob: (jobId: string) => void
  /** カードを閉じる（表示から外すだけ。ジョブ自体には触らない）。 */
  removeJob: (jobId: string) => void
  /** ジョブが記録になったとき。カードを外し、その日の一覧を取り直す。 */
  onDone: (jobId: string) => void
}

/**
 * @param date 読み込む学習日（YYYY-MM-DD）。null なら読み込まない（まだ来ていない日など）。
 * @param reload ジョブが記録になったときに呼ぶ、その日の一覧の取り直し。
 */
export function useTranscribingJobs(date: string | null, reload: () => void): TranscribingJobs {
  const [jobIds, setJobIds] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    setJobIds([])
    if (date === null) return
    api
      .transcriptions({ status: ['queued', 'running', 'failed'], day_date: date })
      .then((res) => {
        if (alive) setJobIds(res.jobs.map((j) => j.id))
      })
      .catch(() => {
        // ジョブ一覧が読めなくても、その日の記録の表示は続ける。
      })
    return () => {
      alive = false
    }
  }, [date])

  const addJob = (jobId: string) =>
    setJobIds((cur) => (cur.includes(jobId) ? cur : [jobId, ...cur]))
  const removeJob = (jobId: string) => setJobIds((cur) => cur.filter((id) => id !== jobId))
  const onDone = (jobId: string) => {
    removeJob(jobId)
    reload()
  }

  return { jobIds, addJob, removeJob, onDone }
}
