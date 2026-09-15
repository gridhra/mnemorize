// 画像添付の追加（記録配下）・削除。ロジックは services/attachments.ts にある。
// entryAttachments は /api/entries に、attachmentById は /api/attachments に app.ts でマウントする。
import { Hono } from 'hono'
import { now as clockNow } from '../adapters/clock.ts'
import { ValidationError } from '../services/entries.ts'
import { addAttachment, deleteAttachment } from '../services/attachments.ts'

export const entryAttachments = new Hono()

entryAttachments.post('/:id/attachments', async (c) => {
  const entryId = c.req.param('id')
  let body: Record<string, unknown>
  try {
    body = await c.req.parseBody({ all: true })
  } catch {
    throw new ValidationError('multipart の本文が読めません')
  }
  const raw = body['files'] ?? body['file']
  const candidates = Array.isArray(raw) ? raw : raw ? [raw] : []
  const files = candidates.filter((f): f is File => f instanceof File)
  if (files.length === 0) throw new ValidationError('画像ファイルを files で送ってください')

  // 時刻は必ず clock アダプタから取る（MNEMORIZE_FAKE_NOW を効かせるため）。
  const now = clockNow()
  const attachments = []
  for (const file of files) {
    attachments.push(await addAttachment(entryId, file, now))
  }
  return c.json({ attachments }, 201)
})

export const attachmentById = new Hono()

attachmentById.delete('/:id', async (c) => {
  const attachment = await deleteAttachment(c.req.param('id'))
  return c.json({ attachment })
})
