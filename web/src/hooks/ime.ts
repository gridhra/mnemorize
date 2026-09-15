// 日本語 IME への配慮（要件 J5）。
// 変換確定の Enter でショートカットが誤発火しないよう、composition 中はキー操作を無視する。
import { useRef } from 'preact/hooks'

export function useIme() {
  const composing = useRef(false)
  return {
    /** テキスト入力要素にそのまま展開して使う。 */
    handlers: {
      onCompositionStart: () => {
        composing.current = true
      },
      onCompositionEnd: () => {
        composing.current = false
      },
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
