// 「⋯」で開くメニュー（記録カードの、常時は見せない操作の置き場）。
//
// 重ね合わせの層である（操作の原則2）。`position: absolute` で土台の面の上に浮かせ、
// 周囲の要素の座標を 1px も動かさない。以前は `<details>` で行内に開いていたため、
// メニューを開くたびに下のカードが押し下げられ、続けて押したい操作の位置が変わった
// （2026-09-15のユーザー指摘「メニューが要素の高さを変えて周囲を押し広げる」）。
//
// 閉じる手段は開いた場所に置く（原則11b）：「⋯」をもう一度押せば閉じ、メニューは
// 「⋯」を覆わない位置（ボタンの下）に出す。
import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { ja } from '../i18n/ja.ts'

type Props = {
  /**
   * 「⋯」のボタン。呼び出し元が項目を押したあとフォーカスをここへ返せるようにする。
   * 返さないと、項目が消えたあとに開く確認ダイアログが「戻し先」を失う。
   */
  buttonRef?: { current: HTMLButtonElement | null }
  open: boolean
  /** 開閉を切り替える。外側クリック・Escape・項目の実行から呼ばれる。 */
  onOpenChange: (open: boolean) => void
  /** `role="menuitem"` を持つ要素を並べる。閉じるのは各項目の処理の仕事。 */
  children: ComponentChildren
}

/** メニューの中の、いま押せる項目（無効のものは飛ばす）。 */
function items(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'))
}

export function MoreMenu({ buttonRef, open, onOpenChange, children }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const own = useRef<HTMLButtonElement>(null)
  const button = buttonRef ?? own

  // 開いたら最初の項目へフォーカスを移す（原則8）。
  useEffect(() => {
    if (!open) return
    items(menu.current)[0]?.focus()
  }, [open])

  // 外側のクリックと Escape で閉じ、フォーカスは「⋯」へ返す（原則8・11b）。
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (wrap.current?.contains(e.target as Node)) return
      onOpenChange(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onOpenChange(false)
      button.current?.focus()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onOpenChange])

  /** 上下キーで項目を送る。端は反対側へ回す。 */
  function onMenuKeyDown(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const list = items(menu.current)
    if (list.length === 0) return
    const at = list.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'ArrowDown' ? at + 1 : at - 1
    list[(next + list.length) % list.length]?.focus()
  }

  return (
    <div class="more" ref={wrap}>
      <button
        type="button"
        class="button more-button"
        ref={button}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ja.entry.moreAria}
        onClick={() => {
          const next = !open
          onOpenChange(next)
          if (!next) button.current?.focus()
        }}
      >
        {ja.entry.moreLabel}
      </button>
      {open && (
        <div class="more-menu" role="menu" ref={menu} onKeyDown={onMenuKeyDown}>
          {children}
        </div>
      )}
    </div>
  )
}
