// その日の記録 1 件のカード。クリックで編集に切り替わる。
import { useState } from 'preact/hooks'
import { api, type Entry, type Revision } from '../api.ts'
import { ja, formatJapaneseDate, formatJapaneseDateTime } from '../i18n/ja.ts'
import { renderMarkdown } from '../markdown.ts'
import { EntryEditor } from './EntryEditor.tsx'
import { Attachments } from './Attachments.tsx'
import { Lightbox } from './Lightbox.tsx'

const THUMB_LIMIT = 4

type Props = { entry: Entry; onChanged: (entry: Entry) => void }

export function EntryCard({ entry, onChanged }: Props) {
  const [editing, setEditing] = useState(false)
  const [revisions, setRevisions] = useState<Revision[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [managingAttachments, setManagingAttachments] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const images = entry.attachments.filter((a) => a.kind === 'image')

  async function toggleHistory() {
    if (revisions) {
      setRevisions(null)
      return
    }
    try {
      setRevisions((await api.revisions(entry.id)).revisions)
    } catch (e) {
      setError(e instanceof Error ? e.message : ja.error.generic)
    }
  }

  async function toggleRetire() {
    try {
      const res = entry.retired_at ? await api.unretire(entry.id) : await api.retire(entry.id)
      onChanged(res.entry)
    } catch (e) {
      setError(e instanceof Error ? e.message : ja.error.generic)
    }
  }

  return (
    <article class={`card${entry.retired_at ? ' retired' : ''}`}>
      <header class="card-head">
        <h2 class="card-title">{entry.headline}</h2>
        <div class="card-meta">
          {entry.retired_at && <span class="badge">{ja.entry.retired}</span>}
          {!entry.review_enabled && <span class="badge">{ja.entry.notReviewed}</span>}
          {entry.schedule && !entry.retired_at && entry.review_enabled ? (
            <span class="badge subtle">{ja.entry.nextDue(formatJapaneseDate(entry.schedule.due.slice(0, 10)))}</span>
          ) : null}
        </div>
      </header>

      {images.length > 0 && (
        <div class="thumb-preview">
          {images.slice(0, THUMB_LIMIT).map((a) => (
            <img
              key={a.id}
              class="thumb-preview-img"
              src={`/files/${a.rel_path}`}
              onClick={() => setLightbox(`/files/${a.rel_path}`)}
            />
          ))}
          {images.length > THUMB_LIMIT && (
            <span class="thumb-more">{ja.attachments.moreCount(images.length - THUMB_LIMIT)}</span>
          )}
        </div>
      )}

      {editing ? (
        <EntryEditor
          initial={{
            title: entry.title ?? '',
            body_md: entry.body_md,
            review_enabled: entry.review_enabled === 1,
          }}
          submitLabel={ja.entry.save}
          showResetSchedule
          onCancel={() => setEditing(false)}
          onSubmit={async (v) => {
            const res = await api.updateEntry(entry.id, {
              title: v.title.trim() === '' ? null : v.title,
              body_md: v.body_md,
              review_enabled: v.review_enabled,
              reset_schedule: v.reset_schedule,
            })
            onChanged(res.entry)
            setEditing(false)
          }}
        />
      ) : (
        <div
          class="card-body prose"
          role="button"
          tabIndex={0}
          onClick={() => setEditing(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setEditing(true)
          }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.body_md) }}
        />
      )}

      <footer class="card-actions">
        {!editing && (
          <button type="button" class="button ghost" onClick={() => setEditing(true)}>
            {ja.entry.edit}
          </button>
        )}
        <button type="button" class="button ghost" onClick={() => void toggleHistory()}>
          {revisions ? ja.entry.historyClose : ja.entry.historyOpen}
        </button>
        <button type="button" class="button ghost" onClick={() => void toggleRetire()}>
          {entry.retired_at ? ja.entry.unretire : ja.entry.retire}
        </button>
        <button type="button" class="button ghost" onClick={() => setManagingAttachments((v) => !v)}>
          {managingAttachments ? ja.attachments.manageClose : ja.attachments.manage}
        </button>
      </footer>

      {managingAttachments && (
        <Attachments
          entryId={entry.id}
          attachments={entry.attachments}
          onChanged={(attachments) => onChanged({ ...entry, attachments })}
        />
      )}

      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}

      {revisions && (
        <div class="history">
          {revisions.length === 0 ? (
            <p class="muted">{ja.entry.historyEmpty}</p>
          ) : (
            <ul class="history-list">
              {revisions.map((r) => (
                <li key={r.id}>
                  <div class="history-head">{ja.entry.historyItem(r.rev_no, formatJapaneseDateTime(r.created_at))}</div>
                  <div class="history-body prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(r.body_md) }} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p class="error">{ja.error.prefix}{error}</p>}
    </article>
  )
}
