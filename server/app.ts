// Hono アプリの組み立て。ルートの追加はこのファイルに 1 行足すだけで済むようにしてある。
import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { NotFoundError, ValidationError } from './services/entries.ts'
import days from './routes/days.ts'
import entries from './routes/entries.ts'
import files from './routes/files.ts'
import health from './routes/health.ts'
import reviews from './routes/reviews.ts'
import search from './routes/search.ts'
import settings from './routes/settings.ts'
import { attachmentById, entryAttachments } from './routes/attachments.ts'
import exportRoutes from './routes/export.ts'
import transcriptions from './routes/transcriptions.ts'

export function createApp(options: { serveStaticWeb?: boolean } = {}): Hono {
  const app = new Hono()

  app.route('/api/health', health)
  app.route('/api/days', days)
  app.route('/api/entries', entries)
  app.route('/api/settings', settings)
  app.route('/api/reviews', reviews)
  app.route('/api/search', search)
  app.route('/files', files)
  app.route('/api/transcriptions', transcriptions) // 段階 2（録音・文字起こし）
  app.route('/api/entries', entryAttachments) // 段階 3：画像添付の追加（POST /api/entries/:id/attachments）
  app.route('/api/attachments', attachmentById) // 段階 3：添付の削除（DELETE /api/attachments/:id）
  app.route('/api/export', exportRoutes) // 段階 5：書き出し・スナップショット
  // 後続担当はここに 1 行足す：

  app.onError((err, c) => {
    if (err instanceof ValidationError) {
      // field を持つ検証エラー（例：SettingsValidationError）は、どの入力欄の誤りかを
      // 一緒に返す。持たないエラーは従来どおり { error } だけ。
      const field = 'field' in err && typeof err.field === 'string' ? err.field : undefined
      return c.json(field ? { error: err.message, field } : { error: err.message }, 400)
    }
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404)
    console.error(err)
    return c.json({ error: 'サーバー内部でエラーが起きました' }, 500)
  })

  if (options.serveStaticWeb) {
    // ビルド済みの単一ページアプリを配信する（bun start）。
    app.use('/assets/*', serveStatic({ root: './web/dist' }))
    app.get('/favicon.ico', serveStatic({ path: './web/dist/favicon.ico' }))
    app.get('*', serveStatic({ path: './web/dist/index.html' }))
  }

  return app
}
