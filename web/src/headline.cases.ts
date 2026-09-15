// 見出しの決め方の入出力表。画面側（web/src/headline.ts）とサーバー側
// （server/services/entries.ts の headlineOf）の両方を、この 1 つの表で確かめる。
// 片方だけ直すとテストが落ちるので、2 つの実装がずれたまま残らない。

export type HeadlineCase = {
  /** 何を確かめる例か（テスト名にそのまま出す）。 */
  name: string
  title: string | null
  body: string
  expected: string
}

export const HEADLINE_CASES: HeadlineCase[] = [
  {
    name: '見出しがあればそれを使う',
    title: '固有値の章',
    body: '今日は固有値の章を読んだ。演習は明日。',
    expected: '固有値の章',
  },
  {
    name: '見出しが空白だけなら本文から作る',
    title: '   ',
    body: '今日は固有値の章を読んだ。演習は明日。',
    expected: '今日は固有値の章を読んだ',
  },
  {
    name: '見出しが無ければ本文の先頭1文',
    title: null,
    body: '今日は固有値の章を読んだ。演習は明日。',
    expected: '今日は固有値の章を読んだ',
  },
  {
    name: '見出しの前後の空白は落とす',
    title: '  固有値の章  ',
    body: '',
    expected: '固有値の章',
  },
  {
    name: '本文の先頭が空行なら最初の中身のある行を使う',
    title: null,
    body: '\n\n  \n二行目が最初の中身。続き。',
    expected: '二行目が最初の中身',
  },
  {
    name: 'Markdown の見出し記号は落とす',
    title: null,
    body: '## 章のまとめ。細かい話は下に。',
    expected: '章のまとめ',
  },
  {
    name: '箇条書きの記号は落とす',
    title: null,
    body: '- 読んだ本の話。ほかにもある。',
    expected: '読んだ本の話',
  },
  {
    name: '番号つきの箇条書きの記号も落とす',
    title: null,
    body: '1. 最初の項目。次がある。',
    expected: '最初の項目',
  },
  {
    name: '句点が無ければ行の全体を使う',
    title: null,
    body: '句点の無い一行',
    expected: '句点の無い一行',
  },
  {
    name: '英語の終止符でも1文で切る',
    title: null,
    body: 'First sentence. Second sentence.',
    expected: 'First sentence',
  },
  {
    name: '疑問符でも1文で切る',
    title: null,
    body: 'これは何だったか？あとで調べる。',
    expected: 'これは何だったか',
  },
  {
    // 見出しは文ではなく札なので、先頭1文を取ったあと末尾の句読点は落とす。
    name: '本文から作る見出しは末尾の句点を落とす',
    title: null,
    body: '昨日の記録3。あとで見直す。',
    expected: '昨日の記録3',
  },
  {
    // 落とすのは本文から作った見出しだけ。人が書いた見出しはそのまま尊重する。
    name: '明示の見出しの末尾の句点は落とさない',
    title: '固有値の章。',
    body: '今日は固有値の章を読んだ。',
    expected: '固有値の章。',
  },
  {
    name: '60文字を超える1文は切り詰めて三点リーダを付ける',
    title: null,
    body: `${'あ'.repeat(70)}。`,
    expected: `${'あ'.repeat(60)}…`,
  },
  {
    name: '本文も見出しも空なら空',
    title: null,
    body: '',
    expected: '',
  },
  {
    name: '本文が空白だけなら空',
    title: null,
    body: '   \n  \n',
    expected: '',
  },
]
