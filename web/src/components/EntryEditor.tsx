// 記録の編集フォーム（新規作成と既存編集の両方で使う）。
import type { ComponentChildren } from 'preact'
import { useState } from 'preact/hooks'
import { ja } from '../i18n/ja.ts'
import { isSaveShortcut, useIme } from '../hooks/ime.ts'
import { api, type Entry } from '../api.ts'

export type EditorValue = {
  title: string
  body_md: string
  review_enabled: boolean
  /** 「内容を作り直したので復習を最初からやり直す」（要件 S4）。既定はオフ。 */
  reset_schedule?: boolean
}

type Props = {
  initial: EditorValue
  submitLabel: string
  /**
   * 保存処理。新規作成では、画像を先に落とした場合にここで作られた記録の id へ
   * 続けて添付をアップロードするため、作成された記録を返せるようにしてある
   * （返さなくても良い＝既存の呼び出し元はそのままで良い）。
   */
  onSubmit: (v: EditorValue) => Promise<Entry | void>
  onCancel?: () => void
  /** 新規作成欄では録音・画像の置き場を出す。 */
  showCaptureSlots?: boolean
  /** 既存の記録の編集では「復習を最初からやり直す」チェックを出す（新規作成では意味がない）。 */
  showResetSchedule?: boolean
  /**
   * 録音ボタン（段階 2）。日付やジョブの扱いは呼び出し元（Today）が持つので、
   * 部品そのものを受け取ってここに差し込む。
   */
  recorderSlot?: ComponentChildren
}

export function EntryEditor({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  showCaptureSlots,
  showResetSchedule,
  recorderSlot,
}: Props) {
  const [title, setTitle] = useState(initial.title)
  const [body, setBody] = useState(initial.body_md)
  const [reviewEnabled, setReviewEnabled] = useState(initial.review_enabled)
  // 「復習を最初からやり直す」。保存のたびに既定のオフへ戻す（毎回意識して選ぶもの）。
  const [resetSchedule, setResetSchedule] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 記録がまだ無い（新規作成中）の間に落とされた画像。保存で記録ができてからアップロードする。
  const [pendingImages, setPendingImages] = useState<File[]>([])
  const ime = useIme()

  const canSave = body.trim().length > 0 || title.trim().length > 0

  async function save() {
    if (!canSave || saving) return
    setSaving(true)
    setError(null)
    try {
      const created = await onSubmit({
        title,
        body_md: body,
        review_enabled: reviewEnabled,
        reset_schedule: resetSchedule,
      })
      if (pendingImages.length > 0 && created && 'id' in created) {
        await api.uploadAttachments(created.id, pendingImages)
      }
      setPendingImages([])
      setResetSchedule(false)
      setTitle('')
      setBody('')
    } catch (e) {
      setError(e instanceof Error ? e.message : ja.error.generic)
    } finally {
      setSaving(false)
    }
  }

  function addPendingImages(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length > 0) setPendingImages((cur) => [...cur, ...images])
  }

  function onKeyDown(e: KeyboardEvent) {
    if (ime.shouldIgnoreKey(e)) return
    if (isSaveShortcut(e)) {
      e.preventDefault()
      void save()
    }
  }

  return (
    <div class="editor">
      <label class="field">
        <span class="field-label">{ja.entry.titleLabel}</span>
        <input
          class="input"
          type="text"
          value={title}
          placeholder={ja.entry.titlePlaceholder}
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          onKeyDown={onKeyDown}
          {...ime.handlers}
        />
      </label>
      <label class="field">
        <span class="field-label">{ja.entry.bodyLabel}</span>
        <textarea
          class="textarea"
          rows={8}
          value={body}
          placeholder={ja.entry.bodyPlaceholder}
          onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
          onKeyDown={onKeyDown}
          {...ime.handlers}
        />
      </label>

      {showCaptureSlots && (
        <div class="capture-slots">
          {recorderSlot}
          <div
            class="dropzone active"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              addPendingImages(Array.from(e.dataTransfer?.files ?? []))
            }}
            onPaste={(e) => addPendingImages(Array.from(e.clipboardData?.files ?? []))}
            tabIndex={0}
          >
            <span>{ja.attachments.dropZone}</span>
            <label class="button ghost">
              {ja.attachments.choose}
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,image/heic"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  addPendingImages(Array.from((e.target as HTMLInputElement).files ?? []))
                  ;(e.target as HTMLInputElement).value = ''
                }}
              />
            </label>
            {pendingImages.length > 0 && (
              <ul class="pending-images">
                {pendingImages.map((f, i) => (
                  <li key={`${f.name}-${i}`}>
                    {f.name}
                    <button
                      type="button"
                      class="button ghost"
                      onClick={() => setPendingImages((cur) => cur.filter((_, idx) => idx !== i))}
                    >
                      {ja.entry.cancel}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {showResetSchedule && (
        <div class="reset-schedule">
          <label class="toggle">
            <input
              type="checkbox"
              checked={resetSchedule}
              onChange={(e) => setResetSchedule((e.target as HTMLInputElement).checked)}
            />
            <span>{ja.entry.resetSchedule}</span>
          </label>
          {resetSchedule && <small class="hint">{ja.entry.resetScheduleHint}</small>}
        </div>
      )}

      <div class="editor-actions">
        <label class="toggle">
          <input
            type="checkbox"
            checked={reviewEnabled}
            onChange={(e) => setReviewEnabled((e.target as HTMLInputElement).checked)}
          />
          <span>{ja.entry.reviewEnabled}</span>
        </label>
        <span class="spacer" />
        <small class="hint">{ja.entry.saveHint}</small>
        {onCancel && (
          <button type="button" class="button ghost" onClick={onCancel}>
            {ja.entry.cancel}
          </button>
        )}
        <button type="button" class="button primary" disabled={!canSave || saving} onClick={() => void save()}>
          {saving ? ja.entry.saving : submitLabel}
        </button>
      </div>
      {error && <p class="error">{ja.error.prefix}{error}</p>}
    </div>
  )
}
