/**
 * markdown-text.ts — Markdown から「読者が目にする地の文」を切り出すための部品。
 *
 * `scripts/check-text.ts`（検査）と `scripts/fix-text-spacing.ts`（一括修正）の
 * 両方が使う。判定そのもの（正書法のルール）は `text-rules.ts` にあり、こちらは
 * コードブロック・行内コード・URL・リンクの URL 部分・表の罫線・見出しや箇条書き
 * の行頭記号を、地の文から除く境界の定義だけを持つ。
 */

/** 表の罫線行（`|---|:---:|` の類）。 */
export const TABLE_RULE_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** 見出し・箇条書き・引用の行頭記号（構文であって地の文ではない）。 */
export const BLOCK_MARKER_RE = /^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)+/;

/** コード・URL・リンクを剥がした跡地に置く中立なプレースホルダ。
 *  日本語クラスにも ASCII 可視文字にも属さないので、前後のスペース規則を
 *  誤って発火させない。 */
export const MD_PLACEHOLDER = "￼";

/** 1 行ぶんのコード・URL・リンクを剥がす（`check-text.ts` の検査専用。中身を
 *  プレースホルダに潰すので、剥がした後の文字列から元の文字は復元できない）。
 *  - 行内コード `…` はまるごとプレースホルダに（中身は地の文ではない）。
 *  - Markdown リンク `[文](url)` はまるごとプレースホルダに——リンク先の URL
 *    が半角括弧を使うのは記法であって、和文中の半角括弧の規則が対象とする
 *    種類の括弧ではない。
 *  - 残った裸の URL もプレースホルダに。 */
export function stripMarkupNoise(text: string): string {
  return text
    .replace(/`[^`]*`/g, MD_PLACEHOLDER)
    .replace(/\[[^\]]*\]\([^)]*\)/g, MD_PLACEHOLDER)
    .replace(/https?:\/\/[^\s)）\]]+/g, MD_PLACEHOLDER);
}

/** 半開区間 [start, end)。 */
export type Range = [number, number];

/** `fix-text-spacing.ts` が編集してよい範囲を決めるための「触ってはいけない範囲」。
 *  行内コードは丸ごと、Markdown リンクは URL 部分（`(...)` の中身）だけ、
 *  裸の URL は丸ごとを保護する——リンクの見出し文（`[ここ]`）は地の文なので
 *  規則の対象に残す。剥がして捨てる `stripMarkupNoise` と違い、位置と元の
 *  文字を保ったまま返す。 */
export function protectedRanges(line: string): Range[] {
  const ranges: Range[] = [];
  for (const m of line.matchAll(/`[^`]*`/g)) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  for (const m of line.matchAll(/\[[^\]]*\]\(([^)]*)\)/g)) {
    const urlStart = m.index + m[0].indexOf("(") + 1;
    const urlEnd = urlStart + (m[1] ?? "").length;
    ranges.push([urlStart, urlEnd]);
  }
  for (const m of line.matchAll(/https?:\/\/[^\s)）\]]+/g)) {
    // すでにリンクの URL 部分として保護済みの範囲との重複はマージ側で吸収する。
    ranges.push([m.index, m.index + m[0].length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last !== undefined && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** `line` を保護範囲で分割し、地の文の断片だけに `edit` を適用して結合し直す。
 *  保護範囲（行内コード・URL）は元の文字のまま残る。 */
export function editEditableSpans(line: string, edit: (segment: string) => string): string {
  const ranges = protectedRanges(line);
  let out = "";
  let cursor = 0;
  for (const [start, end] of ranges) {
    out += edit(line.slice(cursor, start));
    out += line.slice(start, end);
    cursor = end;
  }
  out += edit(line.slice(cursor));
  return out;
}
