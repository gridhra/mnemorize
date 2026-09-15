// 表示の切り替え（セグメント）。内容領域に何を出すかを選ぶだけで、何も起こさない
// 部品なので、文言は名詞にし、ボタン（行為）とは違う見た目にする（操作の原則1・10）。
//
// 箱の大きさは選んでも変わらない（原則11a）。選択中は面と枠と太字で示し、位置は動かさない。
// 矢印キーで隣へ移り、Tab は「選択中の 1 つ」にだけ止まる（`tablist` の作法）。
import { useRef } from 'preact/hooks'

export type SegmentOption<T extends string> = { value: T; label: string }

type Props<T extends string> = {
  /** 支援技術に読ませる、この切り替えの名前。 */
  label: string
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  /**
   * 編集中など、切り替えを受け付けないとき。消さずに無効にして位置を残す（原則11a）。
   * `disabled` 属性ではなく `aria-disabled` にしてある——属性で外すと札が
   * Tab の順から消え、支援技術からも「そこに何があるのか」が読めなくなる。
   * 押せないことは、押しても何も起きないことと、色が退くことで示す。
   */
  disabled?: boolean
}

export function Segmented<T extends string>({ label, options, value, onChange, disabled }: Props<T>) {
  const list = useRef<HTMLDivElement>(null)

  function onKeyDown(e: KeyboardEvent) {
    if (disabled) return
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const at = options.findIndex((o) => o.value === value)
    const next = e.key === 'ArrowRight' ? at + 1 : at - 1
    const target = options[(next + options.length) % options.length]
    if (!target) return
    onChange(target.value)
    // 選んだタブへフォーカスも移す（矢印キーで選ぶ＝そのタブにいる、という作法）。
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[
      (next + options.length) % options.length
    ]?.focus()
  }

  return (
    <div
      class={`segmented${disabled ? ' is-disabled' : ''}`}
      role="tablist"
      aria-label={label}
      ref={list}
      onKeyDown={onKeyDown}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          class="segment"
          aria-selected={o.value === value}
          aria-disabled={disabled}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => {
            if (disabled) return
            onChange(o.value)
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
