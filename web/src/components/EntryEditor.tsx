// 記録の編集フォーム（新規作成と既存編集の両方で使う）。
//
// 録音の文字起こしはこのフォームの中で完結する。録音を止めるとサーバーに文字起こしジョブが
// でき、その結果はこの本文欄の末尾に流れ込む（記録はまだ作られない）。利用者が手直しして
// 「記録する」「保存」を押したとき、そのジョブの id を添えて保存し、録音した音声が
// その記録のものになる。保存の前に画面を離れても失わないよう、入力は下書きに写しておく。
import { useEffect, useRef, useState } from 'preact/hooks'
import { ja } from '../i18n/ja.ts'
import { isSaveShortcut, useIme } from '../hooks/ime.ts'
import { useTranscriptionStream } from '../hooks/useTranscriptionStream.ts'
import { clearDraft, loadDraft, saveDraft } from '../drafts.ts'
import { appendBlock, joinContinuation } from '../append-text.ts'
import { headlineOf } from '../headline.ts'
import { api, type Entry } from '../api.ts'
import { Recorder } from './Recorder.tsx'

/**
 * 編集フォームの操作（保存・中止）を、フォームの外から押せるようにする窓口。
 * 記録カードは「編集する」があった座標に「キャンセル」を出す（操作の原則11b）ため、
 * ボタンをフォームの中ではなくカードの操作の帯に置く必要がある。
 */
export type EditorControls = {
  save: () => void
  cancel: () => void
  /** 本文も見出しも空なら保存できない。 */
  canSave: boolean
  saving: boolean
}

export type EditorValue = {
  title: string
  body_md: string
  review_enabled: boolean
}

/** 「記録する」「保存」で呼び出し元に渡すもの。 */
export type EditorSubmit = {
  /**
   * 見出し。null は「見出しなし」＝表示のたびに本文の先頭1文から作る、という意味。
   * 空のとき、本文の先頭1文と同じとき、見出し欄を触っていないときが null になる。
   */
  title: string | null
  body_md: string
  review_enabled: boolean
  /** 「内容を作り直したので復習を最初からやり直す」（要件 S4）。 */
  reset_schedule: boolean
  /** この記録に結びつける文字起こしジョブ（録音した音声）。 */
  transcription_job_ids: string[]
}

type Props = {
  initial: EditorValue
  submitLabel: string
  /**
   * 保存処理。新規作成では、画像を先に落とした場合にここで作られた記録の id へ
   * 続けて添付をアップロードするため、作成された記録を返せるようにしてある
   * （返さなくても良い＝既存の呼び出し元はそのままで良い）。
   */
  onSubmit: (v: EditorSubmit) => Promise<Entry | void>
  onCancel?: () => void
  /** 新規作成欄では画像の置き場を出す。 */
  showCaptureSlots?: boolean
  /** 既存の記録の編集では「復習を最初からやり直す」チェックを出す（新規作成では意味がない）。 */
  showResetSchedule?: boolean
  /** 既存の記録の編集か。見出し欄の補足文と録音ボタンの名前が変わる。 */
  editing?: boolean
  /** 録音ボタンを出す。dayDate は画面に出している学習日。 */
  recorder?: { dayDate: string; primary?: boolean }
  /** 下書きの保存先（localStorage のキー）。省略すると下書きを保存しない。 */
  draftKey?: string
  /**
   * 渡すと、保存と中止のボタンをこのフォームに出さず、呼び出し元へ操作を預ける
   * （記録カードが自分の操作の帯に置く）。値は保存できるかどうかが変わるたびに届く。
   */
  onControls?: (controls: EditorControls) => void
}

export function EntryEditor({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  showCaptureSlots,
  showResetSchedule,
  editing,
  recorder,
  draftKey,
  onControls,
}: Props) {
  // 下書きがあればそれを正とする（文字起こしが流れ込むたびに書き写してある）。
  const restored = useRef(draftKey ? loadDraft(draftKey) : null)
  const [title, setTitle] = useState(restored.current?.title ?? initial.title)
  const [body, setBody] = useState(restored.current?.body_md ?? initial.body_md)
  const [reviewEnabled, setReviewEnabled] = useState(initial.review_enabled)
  // 「復習を最初からやり直す」。保存のたびに既定のオフへ戻す（毎回意識して選ぶもの）。
  const [resetSchedule, setResetSchedule] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 記録がまだ無い（新規作成中）の間に落とされた画像。保存で記録ができてからアップロードする。
  const [pendingImages, setPendingImages] = useState<File[]>([])
  /** 見出し欄を人が触ったか。下書きから戻したときは、下書きに書いてある通りに引き継ぐ。 */
  const titleTouched = useRef(restored.current?.title_touched ?? false)

  // IME の変換中は本文欄を書き換えられないので、届いた文章をここにためて確定後に流す。
  const held = useRef<{ text: string; first: boolean }[]>([])
  const ime = useIme(() => flushHeld())

  const stream = useTranscriptionStream({
    onAppend: (text, first) => {
      if (ime.isComposing()) {
        held.current.push({ text, first })
        return
      }
      setBody((cur) => (first ? appendBlock(cur, text) : joinContinuation(cur, text)))
    },
  })

  function flushHeld(): void {
    const queued = held.current
    if (queued.length === 0) return
    held.current = []
    setBody((cur) =>
      queued.reduce((acc, q) => (q.first ? appendBlock(acc, q.text) : joinContinuation(acc, q.text)), cur),
    )
  }

  // 下書きから復元したジョブは、まだ終わっていなければ続きを本文欄に流す。
  useEffect(() => {
    const ids = restored.current?.transcription_job_ids ?? []
    if (ids.length > 0) stream.restoreJobs(ids)
    // 復元は開いたときの 1 回だけ。
  }, [])

  // 入力と文字起こしの反映のたびに下書きを写す。
  useEffect(() => {
    if (!draftKey) return
    const ids = stream.jobs.map((j) => j.id)
    if (title === initial.title && body === initial.body_md && ids.length === 0) return
    saveDraft(draftKey, {
      title,
      title_touched: titleTouched.current,
      body_md: body,
      transcription_job_ids: ids,
    })
  }, [draftKey, title, body, stream.jobs])

  const canSave = body.trim().length > 0 || title.trim().length > 0
  /** 見出しを省略したときに使われる、本文の先頭1文。 */
  const autoHeadline = headlineOf(null, body)
  /** 開いたときの本文から作られる見出し。「欄に入っているのは自動の見出しか」の判定に使う。 */
  const initialAutoHeadline = useRef(headlineOf(null, restored.current?.body_md ?? initial.body_md))

  /**
   * 保存する見出し。null は「見出しなし」＝本文の先頭1文に追随させる、という意味。
   *
   * 空のとき、いまの本文から作る見出しと同じとき、そして
   * **欄を一度も触っておらず、入っているのが開いたときの自動の見出しのまま**のときは null。
   * 3 つ目が無いと、見出しを触らずに本文だけ直した記録が、古い先頭1文を見出しとして
   * 焼き付けてしまい、以後は本文を直しても見出しが追随しなくなる。
   */
  function titleForSave(): string | null {
    const trimmed = title.trim()
    if (trimmed.length === 0) return null
    if (trimmed === autoHeadline) return null
    if (!titleTouched.current && trimmed === initialAutoHeadline.current) return null
    return trimmed
  }

  async function save() {
    if (!canSave || saving) return
    setSaving(true)
    setError(null)
    try {
      const created = await onSubmit({
        title: titleForSave(),
        body_md: body,
        review_enabled: reviewEnabled,
        reset_schedule: resetSchedule,
        transcription_job_ids: stream.jobIdsForSave(),
      })
      if (pendingImages.length > 0 && created && 'id' in created) {
        await api.uploadAttachments(created.id, pendingImages)
      }
      if (draftKey) clearDraft(draftKey)
      stream.clear()
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

  function cancel() {
    if (draftKey) clearDraft(draftKey)
    stream.clear()
    onCancel?.()
  }

  function addPendingImages(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length > 0) setPendingImages((cur) => [...cur, ...images])
  }

  // 呼び出し元へ渡す操作。関数そのものは毎回作り直すと古い入力を掴むので、
  // 最新の実装を ref に写し、外へ渡す関数は固定にする。
  const latest = useRef({ save, cancel })
  latest.current = { save, cancel }
  const stable = useRef<Pick<EditorControls, 'save' | 'cancel'>>({
    save: () => void latest.current.save(),
    cancel: () => latest.current.cancel(),
  })
  useEffect(() => {
    onControls?.({ save: stable.current.save, cancel: stable.current.cancel, canSave, saving })
  }, [onControls, canSave, saving])

  function onKeyDown(e: KeyboardEvent) {
    if (ime.shouldIgnoreKey(e)) return
    if (isSaveShortcut(e)) {
      e.preventDefault()
      void save()
    }
  }

  return (
    <div class="editor">
      {/*
        録音ボタンは一番上に置く。新規作成では「録音して記録する」、
        既存の記録の編集では「録音して書き足す」。文字起こしの状態はそのすぐ下、
        いつも同じ場所に1行ずつ出す（出ても出なくてもボタンの位置は動かない）。
      */}
      {recorder && (
        <div class="recorder-slot">
          <Recorder
            dayDate={recorder.dayDate}
            primary={recorder.primary}
            append={editing}
            hasStatus={stream.jobs.length > 0}
            onJobCreated={stream.addJob}
          >
            {stream.jobs.map((job) => (
              <div class="transcribe-status" key={job.id}>
                {job.status === 'failed' ? (
                  <>
                    <span class="status-line">
                      {ja.transcribe.failed}
                      {job.error ? ja.transcribe.reason(job.error) : ''}
                    </span>
                    <button
                      type="button"
                      class="button"
                      onClick={() => void stream.retry(job.id)}
                    >
                      {ja.transcribe.retry}
                    </button>
                  </>
                ) : job.status === 'done' ? (
                  <span class="status-line">{ja.transcribe.finished(submitLabel)}</span>
                ) : (
                  <span class="status-line">
                    {job.status === 'waiting' ? ja.transcribe.waiting : ja.transcribe.running}
                    {ja.transcribe.elapsed(job.elapsedSec)}
                  </span>
                )}
                {job.warnings.map((w) => (
                  <small class="hint" key={w}>
                    {ja.transcribe.warningPrefix}
                    {w}
                  </small>
                ))}
              </div>
            ))}
          </Recorder>
        </div>
      )}

      <label class="field">
        <span class="field-label">{ja.entry.titleLabel}</span>
        <input
          class="input"
          type="text"
          value={title}
          placeholder={autoHeadline ? ja.entry.titlePlaceholderAuto(autoHeadline) : ''}
          onInput={(e) => {
            titleTouched.current = true
            setTitle((e.target as HTMLInputElement).value)
          }}
          onKeyDown={onKeyDown}
          {...ime.handlers}
        />
        <small class="field-help">{editing ? ja.entry.titleHintEdit : ja.entry.titleHint}</small>
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
                      {ja.attachments.delete}
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
        {!onControls && onCancel && (
          <button type="button" class="button" onClick={cancel}>
            {ja.entry.cancel}
          </button>
        )}
        {!onControls && (
          <button
            type="button"
            class="button toggle"
            disabled={!canSave || saving}
            onClick={() => void save()}
          >
            {saving ? ja.entry.saving : submitLabel}
          </button>
        )}
      </div>
      {error && <p class="error">{ja.error.prefix}{error}</p>}
    </div>
  )
}
