/**
 * text-rules.ts — 日本語正書法の判定（`scripts/check-text.ts` が呼ぶ本体）。
 *
 * 隣のリポジトリの `scripts/lib/text-rules.ts` を移植した。判定そのものはここに
 * あり、CLI（check-text.ts）はチェック対象の文字列を集めて渡す入口にすぎない。
 *
 * ## 規範の核（2 原則。各規則はこの具体化として下にコメントする）
 *
 *  原則1: 日本語の文中で、半角文字と日本語の間に不要なスペースを入れない。
 *         半角文字どうしの連語のスペース（`Vol. 2`、`1,304 m`、URL など）は例外。
 *  原則2: コロンなど、文中で機能させる記号は全角を使う（「：」「（）」「…」など）。
 *
 * 規則6（制御文字）は上の2原則の具体化ではなく、文字化け・二重エンコードの
 * 検出という別種の安全網。原則との対応はコメントに素直にそう書く。
 */

/** 仮名・漢字・長音符と、日本語にしか現れない約物。ラテン文字・数字・記号は入れない。 */
export const JP_CLASS = "぀-ヿ㐀-鿿々ー、。「」『』〜～";
export const JP = new RegExp(`[${JP_CLASS}]`);

/**
 * 意図的に規則を破る文字列の例外登録。キー＝リテラルの全文、値＝理由。
 * 移植した時点では空で始める（mnemorize 固有の例外はまだ無い）。
 * 例外を足すときは理由を書けること——理由を書けない例外が出たら、疑うべきは規則の方。
 */
export const ALLOW = new Map<string, string>([]);

// ─── 規則 ─────────────────────────────────────────────────────────────────────

export type Finding = { rule: string; excerpt: string };

/** 中身が半角英数（と欧文書誌で使う区切り）だけか。`(2004)` `(a)` `(pp. 1-3)` は真。 */
const LATIN_ONLY_INNER = /^[0-9A-Za-z][0-9A-Za-z .,:;'&+/–—-]*$/;

/** 規則1（原則2の具体化）: 日本語文脈の `(` … `)`。中身が日本語か、直前直後が
 *  日本語なら違反——全角（）を使う。ただし中身が半角英数だけなら、和文中でも
 *  欧文の記法として正当なので見逃す（`JCS 56 (2004)` など）。 */
export function checkParens(text: string): Finding[] {
  const found: Finding[] = [];
  const open: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") open.push(i);
    else if (text[i] === ")" && open.length > 0) {
      const o = open.pop()!;
      const innerRaw = text.slice(o + 1, i);
      const inner = innerRaw.replace(/『[^』]*』|「[^」]*」|\[[^\]]*\]/g, "");
      if (inner === "" || LATIN_ONLY_INNER.test(inner)) continue;
      let before = o - 1;
      while (before >= 0 && text[before] === " ") before--;
      let after = i + 1;
      while (after < text.length && text[after] === " ") after++;
      const latinContext =
        /[\p{Script=Latin}0-9』」)]/u.test(text[before] ?? "") && !JP.test(text[after] ?? "");
      if (latinContext) continue;
      const japaneseContext =
        JP.test(inner) || JP.test(text[before] ?? "") || JP.test(text[after] ?? "");
      if (japaneseContext) {
        found.push({ rule: "和文中の半角括弧 () — 全角（）を使う", excerpt: excerpt(text, o) });
      }
    }
  }
  return found;
}

/** 閉じ・句読の全角約物。この直後・直前の半角スペースは（相手も全角なら）余分。 */
const FW_CLOSING = "、。！？」』）〕】〈》";
/** 開きの全角約物。 */
const FW_OPENING = "「『（〔【〈《";
/** 全角の文字（仮名・漢字・約物・全角英数）。スペースが「余分」かはこの両隣で決まる。
 *  `—`（前後に半角スペース1つが規約）・`・`・`…` は意図的にこの集合から外す。 */
const FULLWIDTH_CLASS = `${JP_CLASS}${FW_CLOSING}${FW_OPENING}Ａ-Ｚａ-ｚ０-９`;

/** 規則2（原則1の具体化）: 余分な半角スペース。全角の約物どうしに挟まれた
 *  スペース・連続スペース・文字列端のスペースを見る。片側が欧文（半角）なら、
 *  それは原則1が例外とする半角どうしの語間か、規則7が別途見るべき対象なので
 *  ここでは数えない。
 *  includeEdges: 文字列の先頭・末尾のスペースを違反に数えるか。テンプレート断片
 *  や表のセルのように「文の一部が分割されている」ものには適用しない。 */
export function checkSpaces(text: string, includeEdges: boolean): Finding[] {
  const found: Finding[] = [];
  // 改行を含むリテラルのスペースはソースの体裁であってレンダリング結果ではない。
  if (text.includes("\n")) return found;
  const patterns: [RegExp, string][] = [
    [
      new RegExp(`[${FW_CLOSING}] +[${FULLWIDTH_CLASS}]`, "g"),
      "閉じ約物の直後の余分な半角スペース",
    ],
    [
      new RegExp(`[${FULLWIDTH_CLASS}] +[${FW_CLOSING}]`, "g"),
      "閉じ約物の直前の余分な半角スペース",
    ],
    [new RegExp(`[${FW_OPENING}] +`, "g"), "開き約物の直後の余分な半角スペース"],
    [
      new RegExp(`[${FULLWIDTH_CLASS}] +[${FW_OPENING}]`, "g"),
      "開き約物の直前の余分な半角スペース",
    ],
    [/ {2,}/g, "連続する半角スペース"],
    ...(includeEdges ? [[/^ | $/g, "文字列の端の半角スペース"] as [RegExp, string]] : []),
  ];
  for (const [re, rule] of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      found.push({ rule, excerpt: excerpt(text, m.index) });
      re.lastIndex = m.index + 1;
    }
  }
  return found;
}

/** 規則3（原則2の具体化）: 三点リーダー。ASCII `...` と `。。。` を禁じ、`…` に寄せる。 */
export function checkEllipsis(text: string): Finding[] {
  const found: Finding[] = [];
  if (text.includes("...")) {
    found.push({ rule: 'ASCII "..." — … を使う', excerpt: excerpt(text, text.indexOf("...")) });
  }
  if (text.includes("。。。")) {
    found.push({ rule: "句点の連続「。。。」— … を使う", excerpt: excerpt(text, text.indexOf("。。。")) });
  }
  return found;
}

/** 規則4（原則2の具体化）: 鉤括弧の対応。開閉の数が合わない、または閉じが開きに
 *  先行する場合を検出する。全角の対応記号（「」『』（））を正しく使っていても、
 *  数が崩れていれば読者には破綻して見えるため、原則2の「機能する記号を正しく使う」
 *  の一部として見る。 */
export function checkBrackets(text: string): Finding[] {
  const found: Finding[] = [];
  for (const [open, close, name] of [
    ["「", "」", "「」"],
    ["『", "』", "『』"],
    ["（", "）", "（）"],
  ] as const) {
    let depth = 0;
    let firstUnbalancedAt = -1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === open) depth++;
      else if (text[i] === close) {
        depth--;
        if (depth < 0 && firstUnbalancedAt < 0) firstUnbalancedAt = i;
      }
    }
    if (depth !== 0 || firstUnbalancedAt >= 0) {
      const at = firstUnbalancedAt >= 0 ? firstUnbalancedAt : Math.max(0, text.lastIndexOf(open));
      found.push({ rule: `${name} の開閉が不整合`, excerpt: excerpt(text, at) });
    }
  }
  return found;
}

/** 補足（原則2の具体化）: 和文中のカーリークォート。鉤括弧に直すべきものとして拾う。 */
export function checkCurlyQuotes(text: string): Finding[] {
  const at = text.search(/[’“”]/);
  if (at === -1) return [];
  return [{ rule: "和文中のカーリークォート — 「」を使う", excerpt: excerpt(text, at) }];
}

/** 規則6: 制御文字・二重エンコードの残骸。2 原則そのものの具体化ではなく、
 *  文字化け（とくに全角約物の二重エンコード）を早期に見つけるための安全網。
 *  C0（タブ・改行を除く）と C1（U+0080–U+009F）は表示不能。 */
// eslint-disable-next-line no-control-regex -- 制御文字の検出こそが目的
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]");
export function checkControlChars(text: string): Finding[] {
  const m = CONTROL_CHARS.exec(text);
  if (m === null) return [];
  const code = m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
  return [
    {
      rule: `制御文字 U+${code} — 表示不能（二重エンコードの残骸の疑い）`,
      excerpt: excerpt(text, m.index),
    },
  ];
}

/** 規則5（原則2の具体化）: 日本語文中の半角コロン。コロンの前後どちらかが日本語
 *  なら全角「：」を使う。URL（`https:` 等）や時刻・欧文書誌の `Vol. 2: 3` は
 *  前後とも非日本語なので掛からない（原則1の半角どうしの例外と対称）。 */
const HALFWIDTH_COLON_JP = new RegExp(`[${JP_CLASS}] ?: ?|: ?[${JP_CLASS}]`);
export function checkColon(text: string): Finding[] {
  const m = HALFWIDTH_COLON_JP.exec(text);
  if (m === null) return [];
  return [
    {
      rule: "和文中の半角コロン — 全角「：」を使う（後続の半角スペースも不要）",
      excerpt: excerpt(text, m.index),
    },
  ];
}

/** 規則7（原則1の具体化。核となる規則）: 日英間の半角スペース。仮名・漢字・
 *  長音符と ASCII 可視文字が半角スペース1つを挟んで隣り合えば違反（詰める）。
 *  約物（、。「」）は規則2が見る。バックスラッシュ（エスケープ）は除く。 */
export const JP_SCRIPT_CLASS = "぀-ヿ㐀-鿿々ー";
/** ASCII 可視文字に加え、転写で使うラテン拡張（ā ī ū ḥ ṭ š）と修飾文字（ʿ ʾ）も欧文側に含める。
 *  `scripts/fix-text-spacing.ts` が規則7の自動修正に再利用する。 */
export const ASCII_VISIBLE = "\\x21-\\x5B\\x5D-\\x7E\\u00C0-\\u024F\\u1E00-\\u1EFF\\u02B0-\\u02FF";
const JP_ASCII_SPACE = new RegExp(
  `[${JP_SCRIPT_CLASS}] [${ASCII_VISIBLE}]|[${ASCII_VISIBLE}] [${JP_SCRIPT_CLASS}]`,
  "g",
);
/** URL の中の日本語（`?title=後生`）に続くスペースは日英間のスペースではない。 */
const URL_SPAN = /https?:\/\/[^\s（）()「」、。，\]]+/g;
export function checkJpAsciiSpace(text: string): Finding[] {
  const found: Finding[] = [];
  const urlEnds = new Set<number>();
  for (const u of text.matchAll(URL_SPAN)) urlEnds.add(u.index + u[0].length - 1);
  let m: RegExpExecArray | null;
  while ((m = JP_ASCII_SPACE.exec(text)) !== null) {
    if (urlEnds.has(m.index)) continue;
    found.push({ rule: "日英間の半角スペース — 日本語に接する側を詰める", excerpt: excerpt(text, m.index) });
    JP_ASCII_SPACE.lastIndex = m.index + 1;
  }
  return found;
}

/** 日本語を含む文字列にのみ規則を当てる（英語のみの文字列は対象外）。
 *  standalone=false は、テンプレート断片や表のセルのように「一つの文がソース上
 *  で分割される」種別のためのモード——括弧の開閉（規則4）と文字列端のスペース
 *  （規則2の一部）は断片単位では原理的に誤検知するので外す。 */
export function inspect(text: string, standalone: boolean): Finding[] {
  if (ALLOW.has(text)) return [];
  // 制御文字は日本語の有無と無関係に検査する（英語の文字列にも混入しうる）。
  const control = checkControlChars(text);
  if (!JP.test(text)) return control;
  return [
    ...control,
    ...checkParens(text),
    ...checkSpaces(text, standalone),
    ...checkEllipsis(text),
    ...(standalone ? checkBrackets(text) : []),
    ...checkCurlyQuotes(text),
    ...checkColon(text),
    ...checkJpAsciiSpace(text),
  ];
}

export function excerpt(text: string, at: number): string {
  const start = Math.max(0, at - 20);
  const end = Math.min(text.length, at + 24);
  const body = text.slice(start, end).replace(/\n/g, "⏎");
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}
