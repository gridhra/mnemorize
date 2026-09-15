// 単一ページアプリの入口。タブの切り替えと「今日」の日付だけを持つ。
import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { api } from './api.ts'
import { ja } from './i18n/ja.ts'
import { Today } from './pages/Today.tsx'
import { Review } from './pages/Review.tsx'
import { Search } from './pages/Search.tsx'
import { Settings } from './pages/Settings.tsx'
import './styles.css'

type Tab = 'today' | 'review' | 'search' | 'settings'

function App() {
  const [tab, setTab] = useState<Tab>('today')
  // 「学習日」は午前 4 時境界で決まるのでサーバーに聞く。取得までは暦日で仮置きする。
  const [today, setToday] = useState<string>(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const [date, setDate] = useState<string | null>(null)
  // 「復習」タブに出す残件数：今日出す分のうち、まだ評価していない件数。
  // 上限を超えて明日以降に回る分（繰り越し）は数えない（復習画面のヘッダーが別に示す）。
  const [dueCount, setDueCount] = useState(0)

  function refreshDueCount() {
    api
      .reviewsToday()
      .then((q) => {
        // 今日まだ評価していない件数 = 今日出すキューの残り（items）を、
        // 1 日の上限の残り枠（上限 − 今日すでに評価した件数）で頭打ちにしたもの。
        // これで、今日の分を終えたらバッジが 0 になる（上限を超えた分は明日以降に回る）。
        const remainingToday = Math.max(0, q.daily_limit - q.reviewed_today)
        setDueCount(Math.max(0, Math.min(q.items.length, remainingToday)))
      })
      .catch(() => setDueCount(0))
  }

  useEffect(() => {
    api
      .health()
      .then((h) => {
        setToday(h.today)
        setDate((cur) => cur ?? h.today)
      })
      .catch(() => setDate((cur) => cur ?? today))
    refreshDueCount()
  }, [])

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'today', label: ja.nav.today },
    { id: 'review', label: ja.nav.review, badge: dueCount },
    { id: 'search', label: ja.nav.search },
    { id: 'settings', label: ja.nav.settings },
  ]

  return (
    <div class="app">
      <nav class="tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            class={`tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.badge ? <span class="tab-badge">{t.badge}</span> : null}
          </button>
        ))}
      </nav>
      <main>
        {tab === 'today' && date && <Today date={date} today={today} onDateChange={setDate} />}
        {tab === 'review' && <Review onQueueChanged={refreshDueCount} />}
        {tab === 'search' && (
          <Search
            onOpenDate={(d) => {
              setDate(d)
              setTab('today')
            }}
          />
        )}
        {tab === 'settings' && <Settings />}
      </main>
    </div>
  )
}

render(<App />, document.getElementById('app')!)
