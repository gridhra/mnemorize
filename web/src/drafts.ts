// 書きかけの記録（下書き）をブラウザに残す。
//
// 録音の文字起こしは本文欄に流れ込むだけで、保存するまでサーバーには記録が残らない。
// 保存の前に画面を離れたり再読み込みしたりしても書いたものが消えないよう、
// 入力のたびに localStorage へ写しておき、フォームを開いたときに戻す。
// 「記録する」「保存」「やめる」で消す。

/** 下書き 1 件の中身。 */
export type Draft = {
  title: string
  /** 見出し欄を人が触ったか。触っていなければ、保存時も「見出しなし」のまま扱う。 */
  title_touched: boolean
  body_md: string
  /** この下書きに結びつける予定の文字起こしジョブ。 */
  transcription_job_ids: string[]
  /** 保存した時刻（ISO 8601）。いまは使っていないが、古い下書きを見分けるために残す。 */
  saved_at: string
}

/** 新規作成の欄の下書きのキー。学習日ごとに 1 つ。 */
export function newEntryDraftKey(dayDate: string): string {
  return `draft:new:${dayDate}`
}

/** 既存の記録を編集中の下書きのキー。記録ごとに 1 つ。 */
export function editEntryDraftKey(entryId: string): string {
  return `draft:edit:${entryId}`
}

export function loadDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Draft>
    if (typeof parsed.title !== 'string' || typeof parsed.body_md !== 'string') return null
    const ids = Array.isArray(parsed.transcription_job_ids)
      ? parsed.transcription_job_ids.filter((v): v is string => typeof v === 'string')
      : []
    return {
      title: parsed.title,
      title_touched: parsed.title_touched === true,
      body_md: parsed.body_md,
      transcription_job_ids: ids,
      saved_at: typeof parsed.saved_at === 'string' ? parsed.saved_at : '',
    }
  } catch {
    // 読めない下書きは無かったことにする（保存に失敗した記録より、開けない画面のほうが困る）。
    return null
  }
}

export function saveDraft(key: string, draft: Omit<Draft, 'saved_at'>): void {
  try {
    localStorage.setItem(key, JSON.stringify({ ...draft, saved_at: new Date().toISOString() }))
  } catch {
    // 容量超過などは黙って諦める。下書きは保険であって、入力そのものを止めてはいけない。
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // 同上。
  }
}
