// 既存記録への画像添付：ドラッグ＆ドロップ、ファイル選択、クリップボード貼り付け（要件 C6）。
// サムネイル一覧、クリックで原寸表示（簡単なライトボックス）、削除（確認 1 回）。
import { useRef, useState } from 'preact/hooks'
import { api, type Attachment } from '../api.ts'
import { ja } from '../i18n/ja.ts'
import { Lightbox } from './Lightbox.tsx'

type Props = {
  entryId: string
  attachments: Attachment[]
  onChanged: (attachments: Attachment[]) => void
}

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/heic'

function isImageFile(f: File): boolean {
  return f.type.startsWith('image/')
}

export function Attachments({ entryId, attachments, onChanged }: Props) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const images = attachments.filter((a) => a.kind === 'image')

  async function upload(files: File[]) {
    const targets = files.filter(isImageFile)
    if (targets.length === 0) return
    setUploading(true)
    setError(null)
    try {
      const res = await api.uploadAttachments(entryId, targets)
      onChanged([...attachments, ...res.attachments])
    } catch (e) {
      setError(e instanceof Error ? e.message : ja.error.generic)
    } finally {
      setUploading(false)
    }
  }

  async function remove(id: string) {
    if (!confirm(ja.attachments.confirmDelete)) return
    setError(null)
    try {
      await api.deleteAttachment(id)
      onChanged(attachments.filter((a) => a.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : ja.error.generic)
    }
  }

  return (
    <div class="attachments">
      <div
        class="dropzone active"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          void upload(Array.from(e.dataTransfer?.files ?? []))
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData?.files ?? [])
          if (files.some(isImageFile)) {
            e.preventDefault()
            void upload(files)
          }
        }}
        tabIndex={0}
      >
        <span>{uploading ? ja.attachments.uploading : ja.attachments.dropZone}</span>
        <button type="button" class="button ghost" onClick={() => inputRef.current?.click()}>
          {ja.attachments.choose}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = Array.from((e.target as HTMLInputElement).files ?? [])
            void upload(files)
            if (inputRef.current) inputRef.current.value = ''
          }}
        />
      </div>
      {error && <p class="error">{ja.error.prefix}{error}</p>}
      {images.length > 0 && (
        <div class="thumbs">
          {images.map((a) => (
            <div class="thumb" key={a.id}>
              <img src={`/files/${a.rel_path}`} onClick={() => setLightbox(`/files/${a.rel_path}`)} />
              <button
                type="button"
                class="thumb-delete"
                title={ja.attachments.delete}
                onClick={() => void remove(a.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  )
}
