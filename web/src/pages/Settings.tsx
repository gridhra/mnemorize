// 設定画面：状態表示、設定編集、書き出し・スナップショット（要件 P2、P3）。
import { useEffect, useState } from 'preact/hooks'
import { api, type Health } from '../api.ts'
import { ja } from '../i18n/ja.ts'
import { useIme } from '../hooks/ime.ts'

type FormState = {
  whisper_model_path: string
  glossary: string
  hallucination_phrases: string
  daily_review_limit: string
  boundary_hour: string
  snapshot_copy_dir: string
}

const EMPTY_FORM: FormState = {
  whisper_model_path: '',
  glossary: '',
  hallucination_phrases: '',
  daily_review_limit: '10',
  boundary_hour: '4',
  snapshot_copy_dir: '',
}

export function Settings() {
  const [health, setHealth] = useState<Health | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ime = useIme()

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
          boundary_hour: String(s.boundary_hour ?? 4),
          snapshot_copy_dir: typeof s.snapshot_copy_dir === 'string' ? s.snapshot_copy_dir : '',
        })
      })
      .catch(() => {})
  }, [])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((cur) => ({ ...cur, [key]: value }))
  }

  async function save() {
    setSaving(true)
    setError(null)
    setSavedMessage(null)
    try {
      const limit = Number(form.daily_review_limit)
      const hour = Number(form.boundary_hour)
      const res = await api.putSettings({
        whisper_model_path: form.whisper_model_path.trim(),
        glossary: form.glossary,
        hallucination_phrases: form.hallucination_phrases
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
        // サーバー側の受け付ける範囲（1〜200）に合わせて丸める。
        daily_review_limit:
          Number.isFinite(limit) && limit > 0 ? Math.min(200, Math.floor(limit)) : 10,
        boundary_hour: Number.isFinite(hour) && hour >= 0 && hour <= 23 ? Math.floor(hour) : 4,
        snapshot_copy_dir: form.snapshot_copy_dir.trim(),
      })
      setForm((cur) => ({
        ...cur,
        daily_review_limit: String(res.settings.daily_review_limit),
        boundary_hour: String(res.settings.boundary_hour),
      }))
      setSavedMessage(ja.settings.saved)
      const h = await api.health()
      setHealth(h)
    } catch (e) {
      setError(e instanceof Error ? e.message : ja.error.generic)
    } finally {
      setSaving(false)
    }
  }

  async function runExport(kind: 'markdown' | 'json' | 'snapshot') {
    setWorking(ja.settings.working)
    setResultMessage(null)
    setError(null)
    try {
      if (kind === 'markdown') {
        const r = await api.exportMarkdown()
        setResultMessage(ja.settings.exportResult(r.path, r.files.length, r.bytes))
      } else if (kind === 'json') {
        const r = await api.exportJson()
        setResultMessage(ja.settings.exportResult(r.path, r.files.length, r.bytes))
      } else {
        const r = await api.createSnapshot()
        setResultMessage(ja.settings.snapshotResult(r.path, r.copied_to))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : ja.error.generic)
    } finally {
      setWorking(null)
    }
  }

  return (
    <div class="page">
      <section class="settings-section">
        <h2 class="section-title">{ja.settings.sectionStatus}</h2>
        {health && (
          <dl class="kv">
            <dt>{ja.settings.dataDir}</dt>
            <dd><code>{health.data_dir}</code></dd>
            <dt>{ja.settings.dbPath}</dt>
            <dd><code>{health.db_path}</code></dd>
            <dt>{ja.settings.whisperCli}</dt>
            <dd>{health.whisper_cli_found ? <code>{health.whisper_cli}</code> : ja.settings.notFound}</dd>
            <dt>{ja.settings.whisperModel}</dt>
            <dd>
              {!health.whisper_model_configured
                ? ja.settings.notConfigured
                : health.whisper_model_exists
                  ? ja.settings.found
                  : ja.settings.notFound}
            </dd>
            <dt>{ja.settings.boundaryHour(health.boundary_hour)}</dt>
            <dd />
          </dl>
        )}
      </section>

      <section class="settings-section">
        <h2 class="section-title">{ja.settings.sectionEdit}</h2>
        <label class="field">
          <span class="field-label">{ja.settings.whisperModelPathLabel}</span>
          <input
            class="input"
            type="text"
            value={form.whisper_model_path}
            onInput={(e) => set('whisper_model_path', (e.target as HTMLInputElement).value)}
            {...ime.handlers}
          />
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
        </label>
        <label class="field">
          <span class="field-label">{ja.settings.dailyReviewLimitLabel}</span>
          <input
            class="input"
            type="number"
            min={1}
            value={form.daily_review_limit}
            onInput={(e) => set('daily_review_limit', (e.target as HTMLInputElement).value)}
          />
        </label>
        <label class="field">
          <span class="field-label">{ja.settings.boundaryHourLabel}</span>
          <input
            class="input"
            type="number"
            min={0}
            max={23}
            value={form.boundary_hour}
            onInput={(e) => set('boundary_hour', (e.target as HTMLInputElement).value)}
          />
        </label>
        <label class="field">
          <span class="field-label">{ja.settings.snapshotCopyDirLabel}</span>
          <input
            class="input"
            type="text"
            value={form.snapshot_copy_dir}
            onInput={(e) => set('snapshot_copy_dir', (e.target as HTMLInputElement).value)}
            {...ime.handlers}
          />
        </label>
        <div class="editor-actions">
          <button type="button" class="button primary" disabled={saving} onClick={() => void save()}>
            {saving ? ja.settings.saving : ja.settings.save}
          </button>
          {savedMessage && <span class="muted">{savedMessage}</span>}
        </div>
      </section>

      <section class="settings-section">
        <h2 class="section-title">{ja.settings.sectionExport}</h2>
        <div class="editor-actions">
          <button type="button" class="button ghost" disabled={working !== null} onClick={() => void runExport('markdown')}>
            {ja.settings.exportMarkdown}
          </button>
          <button type="button" class="button ghost" disabled={working !== null} onClick={() => void runExport('json')}>
            {ja.settings.exportJson}
          </button>
          <button type="button" class="button ghost" disabled={working !== null} onClick={() => void runExport('snapshot')}>
            {ja.settings.createSnapshot}
          </button>
        </div>
        {working && <p class="muted">{working}</p>}
        {resultMessage && <p class="muted">{resultMessage}</p>}
      </section>

      {error && <p class="error">{ja.error.prefix}{error}</p>}
    </div>
  )
}
