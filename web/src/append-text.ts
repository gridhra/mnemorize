// 文字起こしの結果を本文欄の末尾に足すときの、つなぎ方の規則。
//
// サーバー側の `server/adapters/asr-whisper-cli.ts` の `joinSegmentTexts()` と同じ考え方：
// ラテン文字や数字どうしが接するときだけ半角スペースを1つ入れ、日本語どうしは詰める。
// 画面側にも置いてあるのは、文字起こしの途中経過（セグメント）が1つずつ届くたびに
// 本文欄へ足していくため（サーバーが結合し終わるのを待たない）。

const LATIN_EDGE = /[A-Za-z0-9)\]]$/
const LATIN_START = /^[A-Za-z0-9([]/

/**
 * 同じ録音の続き（セグメント）を足す。ラテン文字どうしの境界だけ半角スペースを入れる。
 */
export function joinContinuation(current: string, added: string): string {
  const text = added.trim()
  if (text.length === 0) return current
  if (current.length === 0) return text
  return LATIN_EDGE.test(current) && LATIN_START.test(text) ? `${current} ${text}` : `${current}${text}`
}

/**
 * 新しい録音のひとかたまりを足す。既に本文があれば空行を1つ挟む
 * （もともと書いてあった文章と、いま話した文章の切れ目を見せるため）。
 */
export function appendBlock(current: string, added: string): string {
  const text = added.trim()
  if (text.length === 0) return current
  if (current.trim().length === 0) return text
  return `${current.replace(/\s+$/, '')}\n\n${text}`
}
