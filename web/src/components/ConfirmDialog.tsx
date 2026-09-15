// 確認ダイアログ（戻せない操作にだけ出す。設計06 §4.3・§5.5）。
//
// ブラウザ標準の確認（window の `confirm`）をやめてこの部品にした理由は 2 つ。
// （1）標準の確認は文面を 1 本の文字列でしか出せず、「見出し（動詞句）→ 何が起きるか
//      →確定の動詞」という型が作れない。確定ボタンの文字も「OK」で固定される。
// （2）確定の動詞を繰り返す（原則3）ことが、押し間違いを防ぐいちばん効く手段なので、
//      そこを変えられない道具は使えない。
//
// フォーカスの閉じ込め・Escape・背景の暗転は HTML の `<dialog>` の `showModal()` が
// 面倒を見る。閉じたときは、開く前にフォーカスがあった要素へ自分で返す
// （ブラウザ任せにすると、開いた元のボタンが消えている場合に body へ飛ぶ）。
import { useEffect, useRef } from 'preact/hooks'
import { ja } from '../i18n/ja.ts'

type Props = {
  /** 見出し。これから行う操作の動詞句（「記録を削除する」）。 */
  title: string
  /** 何が起きるか＋戻せるか。 */
  body: string
  /** 確定ボタンの文字。見出しと同じ動詞を繰り返す（原則3）。 */
  confirmLabel: string
  /** 取り消せない操作なら true（確定ボタンを赤茶の塗りつぶしにする）。 */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ title, body, confirmLabel, danger, onConfirm, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  // 開く直前にフォーカスがあった要素。閉じたらここへ返す。
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    const el = dialog.current
    return () => {
      el?.close()
      opener.current?.focus()
    }
  }, [])

  return (
    <dialog
      class="dialog"
      ref={dialog}
      // Escape とブラウザの取り消しはどちらもここに来る。
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
      // 背景（`::backdrop`）を押したとき。ダイアログの箱の外側なら閉じる。
      onClick={(e) => {
        const box = dialog.current?.getBoundingClientRect()
        if (!box) return
        const outside =
          e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom
        if (outside) onCancel()
      }}
    >
      <div class="dialog-box">
        <h2 class="dialog-title">{title}</h2>
        <p class="dialog-body">{body}</p>
        <div class="dialog-actions">
          <button type="button" class="button" onClick={onCancel}>
            {ja.common.cancel}
          </button>
          <button
            type="button"
            class={`button ${danger ? 'danger-solid' : 'primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
