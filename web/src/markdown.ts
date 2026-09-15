// 最小限の Markdown 表示（段落・改行・箇条書き・見出し・強調・コード）。
// 外部ライブラリは使わず、必ず HTML をエスケープしてから組み立てる（XSS 対策）。

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
}

/** Markdown を安全な HTML 文字列にする。入力はすべてエスケープ済み。 */
export function renderMarkdown(src: string): string {
  const out: string[] = []
  let listItems: string[] | null = null
  // 段落を組み立て中かどうか。空行で段落は必ず切れる（切らないと段落間の空行が畳まれる）。
  let inParagraph = false

  const flushList = () => {
    if (listItems) {
      out.push(`<ul>${listItems.map((li) => `<li>${li}</li>`).join('')}</ul>`)
      listItems = null
    }
  }

  for (const rawLine of src.split('\n')) {
    const line = rawLine.trimEnd()
    if (line.trim() === '') {
      flushList()
      inParagraph = false
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushList()
      inParagraph = false
      const level = Math.min(6, heading[1]!.length + 2) // 本文中なので h3 から始める
      out.push(`<h${level}>${inline(heading[2] ?? '')}</h${level}>`)
      continue
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      inParagraph = false
      listItems ??= []
      listItems.push(inline(bullet[1] ?? ''))
      continue
    }
    flushList()
    const last = out[out.length - 1]
    // 空行を挟まずに続く行は同じ段落の中の改行（<br />）にする。
    // 空行のあとは新しい段落（<p>）として立てる。
    if (inParagraph && last?.startsWith('<p>')) {
      out[out.length - 1] = `${last.slice(0, -4)}<br />${inline(line)}</p>`
    } else {
      out.push(`<p>${inline(line)}</p>`)
      inParagraph = true
    }
  }
  flushList()
  return out.join('')
}
