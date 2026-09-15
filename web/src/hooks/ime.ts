// 日本語 IME への配慮（要件 J5）。
// 変換確定の Enter でショートカットが誤発火しないよう、composition 中はキー操作を無視する。
import { useRef } from 'preact/hooks'

/**
 * @param onCompositionEnd 変換が確定した直後に呼ぶ。変換中は本文欄を書き換えられないので、
 *   その間に届いた文字起こしの結果をここで流し込むために使う。
 */
export function useIme(onCompositionEnd?: () => void) {
  const composing = useRef(false)
  // 引数の関数は毎回新しく作られるので、最新のものを ref に持つ（ハンドラは作り直さない）。
  const endRef = useRef(onCompositionEnd)
  endRef.current = onCompositionEnd
  return {
    /** テキスト入力要素にそのまま展開して使う。 */
    handlers: {
      onCompositionStart: () => {
        composing.current = true
      },
      onCompositionEnd: () => {
        composing.current = false
        endRef.current?.()
      },
    },
    /** いま変換中か（本文欄への自動の書き込みを止めるために見る）。 */
    isComposing(): boolean {
      return composing.current
    },
    /**
     * このキー操作を無視すべきか。
     * ブラウザによって合図が違うので 3 つとも見る：
     * compositionstart/end で立てた自前の旗、KeyboardEvent.isComposing、keyCode 229。
     */
    shouldIgnoreKey(e: KeyboardEvent): boolean {
      return composing.current || e.isComposing === true || e.keyCode === 229
    },
  }
}

/** ⌘ + Enter（macOS）または Ctrl + Enter での保存かどうか。 */
export function isSaveShortcut(e: KeyboardEvent): boolean {
  return e.key === 'Enter' && (e.metaKey || e.ctrlKey)
}
