// 見出し（記録の1行目に出る手がかり）の決め方。
//
// サーバーの `server/services/entries.ts` の `headlineOf()` と同じ規則を画面側にも置いたもの。
// 画面は「見出し欄を触っていない記録は、本文の先頭1文に追随させる」という判断のために、
// 保存する前にこの規則の結果を知る必要がある（サーバーに問い合わせては入力のたびに往復する）。
// 両方が同じ結果を返すことは `web/src/headline.test.ts` と
// `server/services/entries.test.ts` が同じ入力表（headline.cases.ts）で確かめている。

/**
 * 明示の見出し（title）があればそれ。無ければ本文の先頭1文を手がかりとして取り出す
 * （Markdown の記号は軽く落とし、60文字を超えたら切り詰める）。
 */
export function headlineOf(title: string | null, bodyMd: string): string {
  if (title && title.trim().length > 0) return title.trim()
  const firstLine = bodyMd
    .split('\n')
    .map((l) => l.replace(/^\s*(#{1,6}|[-*+]|\d+\.)\s*/, '').trim())
    .find((l) => l.length > 0)
  if (!firstLine) return ''
  // 先頭1文を取り、末尾の句読点は落とす。見出しは文ではなく札なので、
  // 「昨日の記録3。」のように点が残ると据わりが悪い（2026-09-15の指摘）。
  const sentence = (firstLine.split(/(?<=[。．.!?！？])/)[0] ?? firstLine).replace(
    /[。．.!?！？]+$/,
    '',
  )
  return sentence.length > 60 ? `${sentence.slice(0, 60)}…` : sentence
}
