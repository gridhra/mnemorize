// 単一ページアプリの入口。上部の帯（アプリ名と 4 つの入口）と、ハッシュに応じた画面の描画。
import { render } from 'preact'
import { useCallback, useEffect, useState } from 'preact/hooks'
import { api } from './api.ts'
import { ja } from './i18n/ja.ts'
import { ReviewQueueContext } from './queue-context.ts'
import { formatRoute, useRoute, type Route } from './router.ts'
import { Today } from './pages/Today.tsx'
import { Calendar } from './pages/Calendar.tsx'
import { Day } from './pages/Day.tsx'
import { Search } from './pages/Search.tsx'
import { Settings } from './pages/Settings.tsx'
import './styles.css'

function App() {
  const route = useRoute()
  // 「学習日」は午前 4 時境界で決まるのでサーバーに聞く。取得までは暦日で仮置きする。
  const [today, setToday] = useState<string>(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  // 上部の帯の「今日」に添える件数：今日出す分のうち、まだ評価していない件数。
  // 上限を超えて明日以降に回る分（繰り越し）は数えない。
  const [dueCount, setDueCount] = useState(0)

  const refreshDueCount = useCallback(() => {
    api
      .reviewsToday()
      .then((q) => {
        // 今日まだ評価していない件数 = 今日出すキューの残り（items）を、
        // 1 日の上限の残り枠（上限 − 今日すでに評価した件数）で頭打ちにしたもの。
        const remainingToday = Math.max(0, q.daily_limit - q.reviewed_today)
        setDueCount(Math.max(0, Math.min(q.items.length, remainingToday)))
      })
      .catch(() => setDueCount(0))
  }, [])

  useEffect(() => {
    api
      .health()
      .then((h) => setToday(h.today))
      .catch(() => {
        // 学習日が取れなくても、暦日の仮置きで画面は出す。
      })
  }, [])

  // 画面を移るたびに件数を取り直す（画面遷移でも更新する）。
  useEffect(() => {
    refreshDueCount()
  }, [route.name, refreshDueCount])

  const links: { route: Route; label: string; badge?: number }[] = [
    { route: { name: 'today' }, label: ja.nav.today, badge: dueCount },
    { route: { name: 'calendar' }, label: ja.nav.calendar },
    { route: { name: 'search' }, label: ja.nav.search },
    { route: { name: 'settings' }, label: ja.nav.settings },
  ]

  return (
    <ReviewQueueContext.Provider value={refreshDueCount}>
      <div class="app">
        <header class="topbar">
          <span class="app-name">{ja.appName}</span>
          <nav class="topnav">
            {links.map((l) => (
              <a
                key={l.route.name}
                href={formatRoute(l.route)}
                aria-current={route.name === l.route.name ? 'page' : undefined}
              >
                {l.label}
                {l.badge ? <span class="nav-badge">{l.badge}</span> : null}
              </a>
            ))}
          </nav>
        </header>
        <main>
          {route.name === 'today' && <Today today={today} />}
          {route.name === 'calendar' && <Calendar ym={route.ym} today={today} />}
          {route.name === 'day' && route.date && (
            <Day key={route.date} date={route.date} today={today} entryId={route.entry} />
          )}
          {route.name === 'search' && <Search key={route.q ?? ''} q={route.q} />}
          {route.name === 'settings' && <Settings />}
        </main>
      </div>
    </ReviewQueueContext.Provider>
  )
}

render(<App />, document.getElementById('app')!)
