// 画像の原寸表示（ライトボックス）。暗い余白のクリックと Escape キーの両方で閉じる。
// 一覧カードと画像の管理欄の 2 か所から使うので、閉じ方をここ 1 か所にまとめてある。
import { useEffect } from 'preact/hooks'

type Props = { src: string; onClose: () => void }

export function Lightbox({ src, onClose }: Props) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div class="lightbox" onClick={onClose}>
      <img src={src} />
    </div>
  )
}
