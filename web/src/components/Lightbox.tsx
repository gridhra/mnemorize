// 画像の原寸表示（ライトボックス）。暗い余白のクリックと Escape キーの両方で閉じる。
// 一覧カードと画像の表示の 2 か所から使うので、閉じ方をここ 1 か所にまとめてある。
//
// 重ね合わせの層なので、開いたらフォーカスを自分で取り、閉じたら開く前の要素へ返す
// （操作の原則8）。取らないと、キーボードの人は背後の一覧を触り続けることになり、
// Escape がどこに効くのか分からない。
import { useEffect, useRef } from 'preact/hooks'

type Props = { src: string; onClose: () => void }

export function Lightbox({ src, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null
    box.current?.focus()
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      opener.current?.focus()
    }
  }, [onClose])

  return (
    <div class="lightbox" ref={box} tabIndex={-1} onClick={onClose}>
      <img src={src} />
    </div>
  )
}
