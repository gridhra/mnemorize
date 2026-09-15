// fetch のラッパー。API の型もここに置く。
export type Schedule = {
  entry_id: string
  due: string
  state: string
  stability: number | null
  difficulty: number | null
  reps: number
  lapses: number
  last_review: string | null
}

export type Attachment = {
  id: string
  kind: string
  rel_path: string
  mime: string
  bytes: number
}

export type ExportSummary = { path: string; files: string[]; bytes: number }
export type SnapshotSummary = { path: string; copied_to: string | null; deleted: string[] }

export type Entry = {
  id: string
  day_date: string
  title: string | null
  body_md: string
  review_enabled: number
  retired_at: string | null
  created_at: string
  updated_at: string
  sort_order: number
  schedule_reset_at: string | null
  headline: string
  schedule: Schedule | null
  attachments: Attachment[]
}

export type Revision = {
  id: string
  entry_id: string
  rev_no: number
  title: string | null
  body_md: string
  created_at: string
}

export type SearchHit = {
  entry_id: string
  day_date: string
  title: string | null
  headline: string
  excerpt: string
  matched_in: string
}

export type Health = {
  data_dir: string
  db_path: string
  whisper_cli: string | null
  whisper_cli_found: boolean
  whisper_model_path: string
  whisper_model_configured: boolean
  whisper_model_exists: boolean
  boundary_hour: number
  today: string
  now: string
}

export type TranscriptionSegment = {
  from_ms: number
  to_ms: number
  text: string
  removed?: boolean
}

/** 文字起こしジョブ（段階 2）。 */
export type TranscriptionJob = {
  id: string
  entry_id: string | null
  audio_attachment_id: string | null
  status: 'queued' | 'running' | 'done' | 'failed'
  raw_text: string | null
  segments_json: string | null
  model: string | null
  prompt: string | null
  error: string | null
  created_at: string
  finished_at: string | null
  warnings_json: string | null
  day_date: string | null
}

/** 復習の評価。UI の 3 ボタンに対応する（2=Hard は使わない）。 */
export type ReviewRating = 1 | 3 | 4

export type ReviewSchedule = {
  due: string
  state: 'New' | 'Review'
  stability: number | null
  difficulty: number | null
  elapsed_days: number
  scheduled_days: number
  reps: number
  lapses: number
  last_review: string | null
}

/** 3 ボタンそれぞれを押したときの次回期限の予告。 */
export type ReviewPreview = {
  again: { due: string; date: string; interval_days: number }
  good: { due: string; date: string; interval_days: number }
  easy: { due: string; date: string; interval_days: number }
}

export type ReviewItem = {
  entry: Entry
  schedule: ReviewSchedule
  retrievability: number | null
  preview: ReviewPreview
}

export type ReviewQueue = {
  date: string
  items: ReviewItem[]
  /** 今日期限が来ている件数（上限で切る前、当日評価済みを除く）。 */
  total_due: number
  /** 上限で今日は出さなかった件数。 */
  carried_over: number
  reviewed_today: number
  daily_limit: number
}

export type ReviewResult = {
  entry: Entry
  schedule: ReviewSchedule
  /** 次回期限の学習日（YYYY-MM-DD）。 */
  next_due_date: string
  interval_days: number
  auto_retired: boolean
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  const body = text ? JSON.parse(text) : {}
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
  return body as T
}

export const api = {
  health: () => request<Health>('/api/health'),
  /** 録音した WAV を送ってジョブを作る（202 で job_id が返る）。 */
  createTranscription: async (
    wav: Blob,
    options: { entry_id?: string | null; day_date?: string | null } = {},
  ): Promise<{ job_id: string; job: TranscriptionJob }> => {
    const form = new FormData()
    form.append('audio', wav, 'recording.wav')
    if (options.entry_id) form.append('entry_id', options.entry_id)
    if (options.day_date) form.append('day_date', options.day_date)
    const res = await fetch('/api/transcriptions', { method: 'POST', body: form })
    const text = await res.text()
    const body = text ? JSON.parse(text) : {}
    if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
    return body as { job_id: string; job: TranscriptionJob }
  },
  transcription: (id: string) => request<{ job: TranscriptionJob }>(`/api/transcriptions/${id}`),
  /** 文字起こしジョブの一覧。status は複数指定でき、day_date でその学習日に絞れる。 */
  transcriptions: (options: { status?: string[]; day_date?: string } = {}) => {
    const params = new URLSearchParams()
    for (const s of options.status ?? []) params.append('status', s)
    if (options.day_date) params.set('day_date', options.day_date)
    const qs = params.toString()
    return request<{ jobs: TranscriptionJob[] }>(`/api/transcriptions${qs ? `?${qs}` : ''}`)
  },
  retryTranscription: (id: string) =>
    request<{ job_id: string; job: TranscriptionJob }>(`/api/transcriptions/${id}/retry`, {
      method: 'POST',
    }),
  /** 進捗（部分結果）の受け口。EventSource の URL。 */
  transcriptionEventsUrl: (id: string) => `/api/transcriptions/${id}/events`,
  day: (date: string) => request<{ date: string; entries: Entry[] }>(`/api/days/${date}`),
  dayCounts: (from: string, to: string) =>
    request<{ days: { day_date: string; count: number }[] }>(
      `/api/days?from=${from}&to=${to}`,
    ),
  createEntry: (input: {
    day_date: string
    title?: string | null
    body_md: string
    review_enabled?: boolean
  }) => request<{ entry: Entry }>('/api/entries', { method: 'POST', body: JSON.stringify(input) }),
  updateEntry: (
    id: string,
    input: { title?: string | null; body_md?: string; review_enabled?: boolean; reset_schedule?: boolean },
  ) => request<{ entry: Entry }>(`/api/entries/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  revisions: (id: string) => request<{ revisions: Revision[] }>(`/api/entries/${id}/revisions`),
  retire: (id: string) => request<{ entry: Entry }>(`/api/entries/${id}/retire`, { method: 'POST' }),
  unretire: (id: string) => request<{ entry: Entry }>(`/api/entries/${id}/unretire`, { method: 'POST' }),
  reviewsToday: () => request<ReviewQueue>('/api/reviews/today'),
  submitReview: (entryId: string, rating: ReviewRating) =>
    request<ReviewResult>('/api/reviews', {
      method: 'POST',
      body: JSON.stringify({ entry_id: entryId, rating }),
    }),
  undoReview: (entryId: string) =>
    request<ReviewResult>(`/api/reviews/${entryId}/undo`, { method: 'POST' }),
  search: (q: string) => request<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  settings: () => request<{ settings: Record<string, unknown> }>('/api/settings'),
  putSettings: (patch: Record<string, unknown>) =>
    request<{ settings: Record<string, unknown> }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  uploadAttachments: async (entryId: string, files: File[]): Promise<{ attachments: Attachment[] }> => {
    const form = new FormData()
    for (const f of files) form.append('files', f)
    const res = await fetch(`/api/entries/${entryId}/attachments`, { method: 'POST', body: form })
    const text = await res.text()
    const body = text ? JSON.parse(text) : {}
    if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
    return body as { attachments: Attachment[] }
  },
  deleteAttachment: (id: string) =>
    request<{ attachment: Attachment }>(`/api/attachments/${id}`, { method: 'DELETE' }),
  exportMarkdown: () => request<ExportSummary>('/api/export/markdown'),
  exportJson: () => request<ExportSummary>('/api/export/json'),
  createSnapshot: () => request<SnapshotSummary>('/api/export/snapshot', { method: 'POST' }),
}
