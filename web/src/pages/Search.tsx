// 検索画面。検索語は URL（`#/search?q=…`）に持つので、再読み込みと戻るが効く。
// 結果はその日の画面（`#/day/<日付>?entry=<記録の id>`）へのリンクにする。
import { useEffect, useState } from 'preact/hooks'
import { api, type SearchHit } from '../api.ts'
import { ja, formatJapaneseDate } from '../i18n/ja.ts'
import { isSaveShortcut, useIme } from '../hooks/ime.ts'
import { formatRoute, navigate } from '../router.ts'

type Props = {
  /** URL に入っている検索語。空なら結果を出さない。 */
  q?: string
}

/** どこが一致したかの表示（本文／見出し／文字起こしのまま（編集前）の文）。 */
function matchedInLabel(matchedIn: string): string {
  const labels = ja.search.matchedIn
  if (matchedIn === 'title') return labels.title
  if (matchedIn === 'transcription') return labels.transcription
  return labels.body
}

export function Search({ q }: Props) {
  const [text, setText] = useState(q ?? '')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const ime = useIme()

  // URL の検索語が変わったら（戻る・進む・再読み込みを含む）検索し直す。
  useEffect(() => {
    let alive = true
    setText(q ?? '')
    if (!q || q.trim() === '') {
      setHits(null)
      return
    }
    setError(null)
    api
      .search(q)
      .then((res) => alive && setHits(res.hits))
      .catch((e) => alive && setError(e instanceof Error ? e.message : ja.error.generic))
    return () => {
      alive = false
    }
  }, [q, reloadKey])

  /** 検索を実行する＝検索語を URL に入れる（同じ語なら、その場で引き直す）。 */
  function run() {
    const next = text.trim()
    if (next === '') return
    if (next === (q ?? '')) setReloadKey((n) => n + 1)
    else navigate({ name: 'search', q: next })
  }

  return (
    <div class="page">
      <div class="search-bar">
        <input
          class="input"
          type="search"
          value={text}
          placeholder={ja.search.placeholder}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            // IME 変換中の Enter で検索が走らないようにする（要件 J5）
            if (ime.shouldIgnoreKey(e)) return
            if (e.key === 'Enter' || isSaveShortcut(e)) {
              e.preventDefault()
              run()
            }
          }}
          {...ime.handlers}
        />
        <button type="button" class="button ghost" onClick={() => run()}>
          {ja.search.run}
        </button>
      </div>

      {error && (
        <p class="error">
          {ja.error.prefix}
          {error}
        </p>
      )}

      {hits !== null &&
        (hits.length === 0 ? (
          <p class="muted">{ja.search.empty}</p>
        ) : (
          <>
            <p class="muted">{ja.search.resultCount(hits.length)}</p>
            <ul class="hits">
              {hits.map((h) => (
                <li key={h.entry_id}>
                  <a
                    class="hit"
                    href={formatRoute({ name: 'day', date: h.day_date, entry: h.entry_id })}
                  >
                    <span class="hit-date">
                      {formatJapaneseDate(h.day_date)}
                      <span class="hit-matched">{matchedInLabel(h.matched_in)}</span>
                    </span>
                    <span class="hit-title">{h.headline}</span>
                    <span class="hit-excerpt">{h.excerpt}</span>
                  </a>
                </li>
              ))}
            </ul>
          </>
        ))}
    </div>
  )
}
