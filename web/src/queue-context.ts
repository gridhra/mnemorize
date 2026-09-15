// 上部の帯に出す「今日まだ評価していない復習の件数」を、下位の画面から更新するための受け渡し。
// 件数そのものは main.tsx が持ち、ここでは「取り直して」と頼む関数だけを配る。
import { createContext } from 'preact'
import { useContext } from 'preact/hooks'

/** 件数を取り直す関数。既定は何もしない（Provider の外で使っても壊れないように）。 */
export const ReviewQueueContext = createContext<() => void>(() => {})

/** 復習を 1 件評価した・記録を 1 件作ったときに呼ぶ。 */
export function useReviewQueueRefresh(): () => void {
  return useContext(ReviewQueueContext)
}
