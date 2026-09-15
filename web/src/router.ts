// ハッシュ（`#/…`）で画面を切り替える小さなルーター。ライブラリは使わない。
// 再読み込みで同じ画面に戻り、ブラウザの戻る・進むが効く。
import { useEffect, useState } from 'preact/hooks'

/** 画面の名前。`calendar`・`day`・`search` の中身は段階 2 で作る。 */
export type RouteName = 'today' | 'calendar' | 'day' | 'search' | 'settings'

export type Route = {
  name: RouteName
  /** カレンダーの月（YYYY-MM）。`#/calendar` のように月が無いこともある。 */
  ym?: string
  /** 日の画面の学習日（YYYY-MM-DD）。 */
  date?: string
  /** 日の画面で強調する記録の id（`#/day/2026-09-10?entry=…`）。 */
  entry?: string
  /** 検索語（`#/search?q=…`）。 */
  q?: string
}

const YM = /^\d{4}-\d{2}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** 既定の画面。不正なハッシュはここに正規化する。 */
export const DEFAULT_ROUTE: Route = { name: 'today' }

/**
 * ハッシュを画面の指定に直す。解釈できないものは null。
 * 引数は `#/day/2026-09-10?entry=abc` の形（先頭の `#` は省略してもよい）。
 */
export function matchRoute(hash: string): Route | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const [pathPart = '', queryPart = ''] = raw.split('?')
  const query = new URLSearchParams(queryPart)
  const segments = pathPart.split('/').filter((s) => s.length > 0)

  if (segments.length === 0) return { name: 'today' }
  const [head, second] = segments
  if (head === 'today' && segments.length === 1) return { name: 'today' }
  if (head === 'settings' && segments.length === 1) return { name: 'settings' }
  if (head === 'search' && segments.length === 1) {
    const q = query.get('q')
    return q ? { name: 'search', q } : { name: 'search' }
  }
  if (head === 'calendar') {
    if (segments.length === 1) return { name: 'calendar' }
    if (segments.length === 2 && second && YM.test(second)) return { name: 'calendar', ym: second }
    return null
  }
  if (head === 'day' && segments.length === 2 && second && DATE.test(second)) {
    const entry = query.get('entry')
    return entry ? { name: 'day', date: second, entry } : { name: 'day', date: second }
  }
  return null
}

/** 解釈できないハッシュは「今日」にする版。 */
export function parseRoute(hash: string): Route {
  return matchRoute(hash) ?? DEFAULT_ROUTE
}

/** 画面の指定をハッシュの文字列にする（`<a href>` に入れる値）。 */
export function formatRoute(route: Route): string {
  switch (route.name) {
    case 'today':
      return '#/today'
    case 'settings':
      return '#/settings'
    case 'search':
      return route.q ? `#/search?q=${encodeURIComponent(route.q)}` : '#/search'
    case 'calendar':
      return route.ym ? `#/calendar/${route.ym}` : '#/calendar'
    case 'day':
      return `#/day/${route.date ?? ''}${route.entry ? `?entry=${encodeURIComponent(route.entry)}` : ''}`
  }
}

/** その画面へ移動する（履歴に 1 件積む）。 */
export function navigate(route: Route): void {
  const next = formatRoute(route)
  if (window.location.hash === next) return
  window.location.hash = next
}

/**
 * 今いる画面。ハッシュが変わるたびに再描画する。
 * 解釈できないハッシュは履歴を増やさずに `#/today` へ書き換える。
 */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => read())

  useEffect(() => {
    const onHashChange = () => setRoute(read())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return route
}

function read(): Route {
  const matched = matchRoute(window.location.hash)
  if (!matched) {
    window.history.replaceState(null, '', formatRoute(DEFAULT_ROUTE))
    return DEFAULT_ROUTE
  }
  return matched
}
