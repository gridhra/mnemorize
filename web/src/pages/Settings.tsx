// 設定画面：音声の文字起こし・復習・データの 3 節（設計 05 §3.6）。
import { useEffect, useRef, useState } from 'preact/hooks'
import { api, ApiError, type Health } from '../api.ts'
import { ja } from '../i18n/ja.ts'
import { useIme } from '../hooks/ime.ts'

type SettingKey =
  | 'whisper_model_path'
  | 'glossary'
  | 'hallucination_phrases'
  | 'daily_review_limit'
  | 'auto_retire'
  | 'boundary_hour'
  | 'snapshot_copy_dir'

type FormState = {
  whisper_model_path: string
  glossary: string
  hallucination_phrases: string
  daily_review_limit: string
  auto_retire: boolean
  boundary_hour: string
  snapshot_copy_dir: string
}

const EMPTY_FORM: FormState = {
  whisper_model_path: '',
  glossary: '',
  hallucination_phrases: '',
  daily_review_limit: '10',
  auto_retire: true,
  boundary_hour: '4',
  snapshot_copy_dir: '',
}

/** 設定の各欄の鍵（サーバーが返す `field` と同じ文字列）。 */
const SETTING_KEYS: SettingKey[] = [
  'whisper_model_path',
  'glossary',
  'hallucination_phrases',
  'daily_review_limit',
  'auto_retire',
  'boundary_hour',
  'snapshot_copy_dir',
]

type NoteContent = { purpose: string; effect: string; example: string }

/** 目的・効果・例をまとめた開閉注釈（要件：登録の意味が伝わること）。 */
function FieldNote({ note }: { note: NoteContent }) {
  return (
    <details class="field-note">
      <summary>{ja.settings.noteSummary}</summary>
      <dl>
        <dt>{ja.settings.notePurpose}</dt>
        <dd>{note.purpose}</dd>
        <dt>{ja.settings.noteEffect}</dt>
        <dd>{note.effect}</dd>
        <dt>{ja.settings.noteExample}</dt>
        <dd>{note.example}</dd>
      </dl>
    </details>
  )
}

export function Settings() {
  const [health, setHealth] = useState<Health | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SettingKey, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ime = useIme()

  const [exportWorking, setExportWorking] = useState<'markdown' | 'json' | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportPath, setExportPath] = useState<string | null>(null)
  const [exportResultText, setExportResultText] = useState<string | null>(null)
  const [exportOpening, setExportOpening] = useState(false)
  const [exportOpenError, setExportOpenError] = useState<string | null>(null)

  const [snapshotWorking, setSnapshotWorking] = useState(false)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [snapshotPath, setSnapshotPath] = useState<string | null>(null)
  const [snapshotResultText, setSnapshotResultText] = useState<string | null>(null)
  const [snapshotOpening, setSnapshotOpening] = useState(false)
  const [snapshotOpenError, setSnapshotOpenError] = useState<string | null>(null)

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null))
    api
      .settings()
      .then((res) => {
        const s = res.settings
        setForm({
          whisper_model_path: typeof s.whisper_model_path === 'string' ? s.whisper_model_path : '',
          glossary: typeof s.glossary === 'string' ? s.glossary : '',
          hallucination_phrases: Array.isArray(s.hallucination_phrases)
            ? (s.hallucination_phrases as unknown[]).map(String).join('\n')
            : '',
          daily_review_limit: String(s.daily_review_limit ?? 10),
          auto_retire: s.auto_retire !== false,
          boundary_hour: String(s.boundary_hour ?? 4),
          snapshot_copy_dir: typeof s.snapshot_copy_dir === 'string' ? s.snapshot_copy_dir : '',
        })
      })
      .catch(() => {})
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current)
    }
  }, [])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((cur) => ({ ...cur, [key]: value }))
  }

  function prepStatusText(h: Health): string {
    if (!h.whisper_cli_found) return ja.settings.prepMissingCli
    if (!h.whisper_model_configured) return ja.settings.prepModelNotConfigured
    if (!h.whisper_model_exists) return ja.settings.prepModelMissing
    if (h.whisper_model_used_fallback && h.whisper_model_effective_path) {
      return ja.settings.prepReadyFallback(h.whisper_model_effective_path)
    }
    return ja.settings.prepReady
  }

  function prepReady(h: Health): boolean {
    return h.whisper_cli_found && h.whisper_model_configured && h.whisper_model_exists
  }

  async function save() {
    setSaving(true)
    setError(null)
    setFieldErrors({})
    if (savedTimer.current) clearTimeout(savedTimer.current)
    setSavedMessage(null)
    try {
      // 範囲外の値も丸めずそのまま送る。サーバーが 400 で返す検証メッセージを欄の下にそのまま出す。
      const res = await api.putSettings({
        whisper_model_path: form.whisper_model_path.trim(),
        glossary: form.glossary,
        hallucination_phrases: form.hallucination_phrases
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
        daily_review_limit: Number(form.daily_review_limit),
        auto_retire: form.auto_retire,
        boundary_hour: Number(form.boundary_hour),
        snapshot_copy_dir: form.snapshot_copy_dir.trim(),
      })
      setForm((cur) => ({
        ...cur,
        daily_review_limit: String(res.settings.daily_review_limit),
        boundary_hour: String(res.settings.boundary_hour),
        auto_retire: res.settings.auto_retire !== false,
      }))
      setSavedMessage(ja.settings.saved)
      savedTimer.current = setTimeout(() => setSavedMessage(null), 3000)
      const h = await api.health()
      setHealth(h)
    } catch (e) {
      // field が既知の欄の鍵ならその欄の下に、無ければ（未知の field・field 無し）
      // 画面下部の共通エラーに出す。ラベル文言には依存しない。
      if (e instanceof ApiError && e.field && (SETTING_KEYS as string[]).includes(e.field)) {
        setFieldErrors({ [e.field as SettingKey]: e.message })
      } else {
        setError(e instanceof Error ? e.message : ja.error.generic)
      }
    } finally {
      setSaving(false)
    }
  }

  async function runExport(kind: 'markdown' | 'json') {
    setExportWorking(kind)
    setExportError(null)
    try {
      const r = kind === 'markdown' ? await api.exportMarkdown() : await api.exportJson()
      setExportPath(r.path)
      setExportResultText(ja.settings.exportResult(r.path, r.files.length, r.bytes))
    } catch (e) {
      setExportError(e instanceof Error ? e.message : ja.error.generic)
    } finally {
      setExportWorking(null)
    }
  }

  async function runSnapshot() {
    setSnapshotWorking(true)
    setSnapshotError(null)
    try {
      const r = await api.createSnapshot()
      setSnapshotPath(r.path)
      setSnapshotResultText(ja.settings.snapshotResult(r.path, r.copied_to))
    } catch (e) {
      setSnapshotError(e instanceof Error ? e.message : ja.error.generic)
    } finally {
      setSnapshotWorking(false)
    }
  }

  async function openExportInFinder() {
    if (!exportPath) return
    setExportOpening(true)
    setExportOpenError(null)
    try {
      await api.openInFinder(exportPath)
    } catch (e) {
      setExportOpenError(e instanceof Error ? e.message : ja.settings.openInFinderFailed)
    } finally {
      setExportOpening(false)
    }
  }

  async function openSnapshotInFinder() {
    if (!snapshotPath) return
    setSnapshotOpening(true)
    setSnapshotOpenError(null)
    try {
      await api.openInFinder(snapshotPath)
    } catch (e) {
      setSnapshotOpenError(e instanceof Error ? e.message : ja.settings.openInFinderFailed)
    } finally {
      setSnapshotOpening(false)
    }
  }

  return (
    <div class="page">
      <h1>{ja.settings.title}</h1>

      {/*
        文字起こしと復習の設定は「保存」1 つで一緒に保存する。
        そのため両節を 1 つの form に入れ、末尾に保存の操作行を置く。
        データ節（書き出し・控え）は保存と無関係なので form の外に出す。
      */}
      <form
        class="settings-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <section class="card settings-section">
          <h2 class="section-title">{ja.settings.sectionTranscription}</h2>

          {health && (
            <div class={`status-box ${prepReady(health) ? 'ok' : 'warn'}`}>
              <p class="status-box-title">
                {ja.settings.prepLabel}：{prepStatusText(health)}
              </p>
              {!prepReady(health) && (
                <>
                  <p>{ja.settings.prepNotReadyNote}</p>
                  <ul>
                    {ja.settings.setupSteps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          <label class="field">
            <span class="field-label">{ja.settings.whisperModelPathLabel}</span>
            <input
              class="input"
              type="text"
              value={form.whisper_model_path}
              onInput={(e) => set('whisper_model_path', (e.target as HTMLInputElement).value)}
              {...ime.handlers}
            />
            {fieldErrors.whisper_model_path && <p class="field-error">{fieldErrors.whisper_model_path}</p>}
            <p class="field-help">{ja.settings.whisperModelPathHelp}</p>
            <FieldNote note={ja.settings.whisperModelPathNote} />
          </label>

          <label class="field">
            <span class="field-label">{ja.settings.glossaryLabel}</span>
            <textarea
              class="textarea"
              rows={4}
              value={form.glossary}
              onInput={(e) => set('glossary', (e.target as HTMLTextAreaElement).value)}
              {...ime.handlers}
            />
            {fieldErrors.glossary && <p class="field-error">{fieldErrors.glossary}</p>}
            <p class="field-help">{ja.settings.glossaryHelp}</p>
            <FieldNote note={ja.settings.glossaryNote} />
          </label>

          <label class="field">
            <span class="field-label">{ja.settings.hallucinationLabel}</span>
            <textarea
              class="textarea"
              rows={4}
              value={form.hallucination_phrases}
              onInput={(e) => set('hallucination_phrases', (e.target as HTMLTextAreaElement).value)}
              {...ime.handlers}
            />
            {fieldErrors.hallucination_phrases && (
              <p class="field-error">{fieldErrors.hallucination_phrases}</p>
            )}
            <p class="field-help">{ja.settings.hallucinationHelp}</p>
            <FieldNote note={ja.settings.hallucinationNote} />
          </label>
        </section>

        <section class="card settings-section">
          <h2 class="section-title">{ja.settings.sectionReview}</h2>

          <label class="field">
            <span class="field-label">{ja.settings.dailyReviewLimitLabel}</span>
            <input
              class="input input-narrow"
              type="number"
              value={form.daily_review_limit}
              onInput={(e) => set('daily_review_limit', (e.target as HTMLInputElement).value)}
            />
            {fieldErrors.daily_review_limit && <p class="field-error">{fieldErrors.daily_review_limit}</p>}
            <p class="field-help">{ja.settings.dailyReviewLimitHelp}</p>
            <FieldNote note={ja.settings.dailyReviewLimitNote} />
          </label>

          {/*
            チェックの項目だけは、外側を label にしない。label の中で「詳しく」を開くと
            チェックが一緒に切り替わってしまうため、チェックとラベルの 1 行だけを label にする。
          */}
          <div class="field field-checkbox">
            <label class="field-checkbox-line">
              <input
                type="checkbox"
                checked={form.auto_retire}
                onChange={(e) => set('auto_retire', (e.target as HTMLInputElement).checked)}
              />
              <span class="field-label">{ja.settings.autoRetireLabel}</span>
            </label>
            {fieldErrors.auto_retire && <p class="field-error">{fieldErrors.auto_retire}</p>}
            <p class="field-help">{ja.settings.autoRetireHelp}</p>
            <FieldNote note={ja.settings.autoRetireNote} />
          </div>

          <label class="field">
            <span class="field-label">{ja.settings.boundaryHourLabel}</span>
            <input
              class="input input-narrow"
              type="number"
              value={form.boundary_hour}
              onInput={(e) => set('boundary_hour', (e.target as HTMLInputElement).value)}
            />
            {fieldErrors.boundary_hour && <p class="field-error">{fieldErrors.boundary_hour}</p>}
            <p class="field-help">{ja.settings.boundaryHourHelp}</p>
            <FieldNote note={ja.settings.boundaryHourNote} />
          </label>

          <div class="form-actions">
            {error && <p class="field-error">{ja.error.prefix}{error}</p>}
            {savedMessage && <span class="settings-status ok">{savedMessage}</span>}
            <button type="submit" class="button primary" disabled={saving}>
              {saving ? ja.settings.saving : ja.settings.save}
            </button>
          </div>
        </section>
      </form>

      <section class="card settings-section">
        <h2 class="section-title">{ja.settings.sectionData}</h2>

        <div class="field">
          <span class="field-label">{ja.settings.dataDirLabel}</span>
          {health && <code class="path">{health.data_dir}</code>}
          <p class="field-help">{ja.settings.dataDirHelp}</p>
        </div>

        <div class="action-row">
          <button
            type="button"
            class="button ghost"
            disabled={exportWorking !== null}
            onClick={() => void runExport('markdown')}
          >
            {exportWorking === 'markdown' ? ja.settings.working : ja.settings.exportMarkdown}
          </button>
          <button
            type="button"
            class="button ghost"
            disabled={exportWorking !== null}
            onClick={() => void runExport('json')}
          >
            {exportWorking === 'json' ? ja.settings.working : ja.settings.exportJson}
          </button>
          <span class="action-result">{exportResultText ?? ''}</span>
          <button
            type="button"
            class="button ghost"
            disabled={!exportPath || exportOpening}
            onClick={() => void openExportInFinder()}
          >
            {ja.settings.openInFinder}
          </button>
        </div>
        {exportError && <p class="field-error">{exportError}</p>}
        {exportOpenError && <p class="field-error">{exportOpenError}</p>}

        <label class="field">
          <span class="field-label">{ja.settings.snapshotCopyDirLabel}</span>
          <input
            class="input"
            type="text"
            value={form.snapshot_copy_dir}
            onInput={(e) => set('snapshot_copy_dir', (e.target as HTMLInputElement).value)}
            {...ime.handlers}
          />
          {fieldErrors.snapshot_copy_dir && <p class="field-error">{fieldErrors.snapshot_copy_dir}</p>}
          <p class="field-help">{ja.settings.snapshotCopyDirHelp}</p>
          <FieldNote note={ja.settings.snapshotCopyDirNote} />
        </label>

        <div class="field">
          <span class="field-label">{ja.settings.snapshotLabel}</span>
          <div class="action-row action-row-single">
            <button type="button" class="button ghost" disabled={snapshotWorking} onClick={() => void runSnapshot()}>
              {snapshotWorking ? ja.settings.working : ja.settings.createSnapshot}
            </button>
            <span class="action-result">{snapshotResultText ?? ''}</span>
            <button
              type="button"
              class="button ghost"
              disabled={!snapshotPath || snapshotOpening}
              onClick={() => void openSnapshotInFinder()}
            >
              {ja.settings.openInFinder}
            </button>
          </div>
          <p class="field-help">{ja.settings.createSnapshotHelp}</p>
        </div>
        {snapshotError && <p class="field-error">{snapshotError}</p>}
        {snapshotOpenError && <p class="field-error">{snapshotOpenError}</p>}
      </section>
    </div>
  )
}
