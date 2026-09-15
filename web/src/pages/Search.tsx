// 検索画面。結果をクリックするとその日の「今日」画面へ移動する。
import { useState } from 'preact/hooks'
import { api, type SearchHit } from '../api.ts'
import { ja, formatJapaneseDate } from '../i18n/ja.ts'
import { isSaveShortcut, useIme } from '../hooks/ime.ts'

type Props = { onOpenDate: (date: string) => void }

export function Search({ onOpenDate }: Props) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ime = useIme()

  async function run() {
    if (q.trim() === '') return
    setError(null)
    try {
      setHits((await api.search(q)).hits)
    } catch (e) {
      setError(e instanceof Error ? e.message : ja.error.generic)
    }
  }

  return (
    <div class="page">
      <div class="search-bar">
        <input
          class="input"
          type="search"
          value={q}
          placeholder={ja.search.placeholder}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            // IME 変換中の Enter で検索が走らないようにする（要件 J5）
            if (ime.shouldIgnoreKey(e)) return
            if (e.key === 'Enter' || isSaveShortcut(e)) {
              e.preventDefault()
              void run()
            }
          }}
          {...ime.handlers}
        />
        <button type="button" class="button primary" onClick={() => void run()}>
          {ja.search.run}
        </button>
      </div>
      <small class="hint">{ja.search.hint}</small>

      {error && <p class="error">{ja.error.prefix}{error}</p>}

      {hits !== null &&
        (hits.length === 0 ? (
          <p class="muted">{ja.search.empty}</p>
        ) : (
          <>
            <p class="muted">{ja.search.resultCount(hits.length)}</p>
            <ul class="hits">
              {hits.map((h) => (
                <li key={h.entry_id}>
                  <button type="button" class="hit" onClick={() => onOpenDate(h.day_date)}>
                    <span class="hit-date">{formatJapaneseDate(h.day_date)}</span>
                    <span class="hit-title">{h.headline}</span>
                    <span class="hit-excerpt">{h.excerpt}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ))}
    </div>
  )
}
