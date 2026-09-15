/**
 * check-text.ts — 日本語正書法の機械検査。
 *
 * 実行: bun run check:text（または bun run scripts/check-text.ts）
 * 引数にファイルを渡すと、そのファイルだけを検査する
 * （例: bun run scripts/check-text.ts docs/README.md）。
 * 引数なしなら既定の検査対象すべてを検査する。
 *
 * 判定そのものは scripts/lib/text-rules.ts の inspect() にある。本ファイルは
 * 検査対象から「読者が目にする素のテキスト」を取り出して inspect() に渡す入口
 * にすぎない。2 種類の入口がある。
 *
 *  (a) TypeScript の文字列リテラル（web/src/i18n/ja.ts）
 *      TypeScript の AST を歩いて文字列リテラルだけを見る——コメントや識別子は
 *      対象外（規則は「画面に出る文言」についてのものであって、ソースの
 *      書きぶりについてのものではない）。
 *  (b) Markdown の本文（docs/**\/*.md と CLAUDE.md）
 *      コードブロック（```）、行内コード（`…`）、URL、frontmatter、表の罫線
 *      （`|---|---|` の行）を除いた地の文を、行単位・表のセル単位で検査する。
 *
 * 隣接プロジェクトの scripts/check-text.ts を移植し、mnemorize 用に検査対象を
 * 差し替えた（元は src/ 配下の TypeScript 全体、こちらは i18n の言葉と docs）。
 *
 * ## 逃げ道
 *
 * 意図的に規則を破る文字列は scripts/lib/text-rules.ts の ALLOW に理由つきで
 * 登録する。規則そのものを緩めないこと——理由を書けない例外が出たら、疑うべきは
 * 規則の方。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { ALLOW, JP, checkBrackets, inspect, type Finding } from "./lib/text-rules";
import { BLOCK_MARKER_RE, TABLE_RULE_RE, stripMarkupNoise } from "./lib/markdown-text";

const ROOT = process.cwd();

type Violation = Finding & { file: string; line: number };

const violations: Violation[] = [];
let literalsScanned = 0;
let linesScanned = 0;

// ─── 検査対象の決定 ───────────────────────────────────────────────────────────

const DEFAULT_TS_TARGETS = ["web/src/i18n/ja.ts"];

function collectMarkdownFiles(dir: string, out: string[]): void {
  const st = statSync(dir, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) collectMarkdownFiles(p, out);
    else if (entry.name.endsWith(".md")) out.push(p);
  }
}

function defaultMarkdownTargets(): string[] {
  const out: string[] = [];
  collectMarkdownFiles(resolve(ROOT, "docs"), out);
  const claudeMd = resolve(ROOT, "CLAUDE.md");
  if (statSync(claudeMd, { throwIfNoEntry: false })) out.push(claudeMd);
  return out;
}

const argv = process.argv.slice(2);
let tsTargets: string[];
let mdTargets: string[];
if (argv.length > 0) {
  const resolved = argv.map((p) => resolve(ROOT, p));
  tsTargets = resolved.filter((p) => p.endsWith(".ts") || p.endsWith(".tsx"));
  mdTargets = resolved.filter((p) => p.endsWith(".md"));
} else {
  tsTargets = DEFAULT_TS_TARGETS.map((p) => resolve(ROOT, p));
  mdTargets = defaultMarkdownTargets();
}

// ─── (a) TypeScript の文字列リテラル ─────────────────────────────────────────

/** 式の境界を表すプレースホルダ。日本語クラスに属さず、既存規則のどれにも掛からない。 */
const EXPR_PLACEHOLDER = "￼";

/** `+` 連結の一部か（`"不正: " + x` の左辺のような断片）。 */
function isConcatOperand(node: ts.Node): boolean {
  const p = node.parent;
  return (
    p !== undefined && ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.PlusToken
  );
}

/** `+` 連結チェーンを左から潰して結合テキストにする（非リテラルはプレースホルダ）。 */
function flattenConcat(node: ts.Expression): string {
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return flattenConcat(node.left) + flattenConcat(node.right);
  }
  const text = literalText(node);
  return text ?? EXPR_PLACEHOLDER;
}

/** テンプレートリテラル／`+` 連結チェーンの「結合テキスト」——式の穴をプレース
 *  ホルダに置いて断片を繋いだもの。規則4（括弧の開閉）はこの単位で見る。 */
function joinedText(node: ts.Node): string | null {
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) out += EXPR_PLACEHOLDER + span.literal.text;
    return out;
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
    !isConcatOperand(node)
  ) {
    const out = flattenConcat(node);
    return out === EXPR_PLACEHOLDER ? null : out;
  }
  return null;
}

/** 読者が目にしうるリテラル種別のみ。テンプレートリテラルは断片ごとに見るので、
 *  `${…}` の境界がスペース規則を誤検知することはない。 */
function literalText(node: ts.Node): string | null {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  ) {
    return node.text;
  }
  return null;
}

function tsSourceFiles(target: string): string[] {
  const st = statSync(target, { throwIfNoEntry: false });
  if (!st) return [];
  if (st.isFile()) return [".ts", ".tsx"].includes(extname(target)) ? [target] : [];
  const out: string[] = [];
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const p = join(target, entry.name);
    if (entry.isDirectory()) out.push(...tsSourceFiles(p));
    else if ([".ts", ".tsx"].includes(extname(entry.name)) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

function checkTsFile(file: string): void {
  const source = readFileSync(file, "utf8");
  if (!JP.test(source)) return;
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const report = (node: ts.Node, found: Finding[]): void => {
    if (found.length === 0) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    for (const f of found) violations.push({ ...f, file: relative(ROOT, file), line: line + 1 });
  };
  const visit = (node: ts.Node): void => {
    const text = literalText(node);
    if (text !== null) {
      literalsScanned++;
      const standalone =
        (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
        !isConcatOperand(node);
      report(node, inspect(text, standalone));
    }
    const joined = joinedText(node);
    if (joined !== null && JP.test(joined) && !ALLOW.has(joined)) {
      report(node, checkBrackets(joined));
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
}

for (const target of tsTargets) {
  for (const file of tsSourceFiles(target)) checkTsFile(file);
}

// ─── (b) Markdown の本文 ─────────────────────────────────────────────────────

function checkMarkdownFile(file: string): void {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  const rel = relative(ROOT, file);

  let i = 0;
  // frontmatter（先頭が `---` で始まるブロック）を除外する。
  if (lines[0]?.trim() === "---") {
    i = 1;
    while (i < lines.length && lines[i]?.trim() !== "---") i++;
    i++; // 閉じの --- も飛ばす
  }

  // Markdown はソース上の改行（ソフトラップ）が段落の中では 1 つの文として
  // 続く。物理行ごとに独立して検査すると、段落の途中で改行された括弧の対応
  // （規則4）や、行頭のソフトラップに過ぎない字下げを「文字列の端のスペース」
  // （規則2）と誤検出する。そのため、空行や見出し・箇条書きで区切られる
  // 「ブロック」単位に一度連結してから inspect() に掛ける。
  let block: { text: string; startLine: number } | null = null;
  const flush = (): void => {
    if (block !== null) {
      const found = inspect(block.text, true);
      for (const f of found) violations.push({ ...f, file: rel, line: block.startLine });
    }
    block = null;
  };
  const appendToBlock = (text: string, lineNo: number): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (block === null) block = { text: trimmed, startLine: lineNo };
    // 継ぎ目にスペースを入れない：ソース上は改行であってスペース文字ではない。
    // スペースを入れると、行の折り返しにすぎない箇所を「余分な半角スペース」
    // として誤検出してしまう（規則2・規則7 は実際に書かれた文字だけを見る）。
    else block.text += trimmed;
  };

  let inFence = false;
  for (; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    linesScanned++;
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      flush();
      continue;
    }
    if (inFence) continue;

    if (raw.trim().length === 0) {
      flush();
      continue;
    }
    if (TABLE_RULE_RE.test(raw)) {
      flush();
      continue;
    }

    const lineNo = i + 1;
    const stripped = stripMarkupNoise(raw);

    // 表の行は 1 行 1 論理単位（セルごと）として、その場で検査する。
    if (/\|/.test(stripped) && stripped.trim().length > 0) {
      flush();
      const cells = stripped
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      for (const cell of cells) {
        const found = inspect(cell, true);
        for (const f of found) violations.push({ ...f, file: rel, line: lineNo });
      }
      continue;
    }

    const hasMarker = BLOCK_MARKER_RE.test(stripped);
    if (hasMarker) {
      // 見出し・箇条書き・引用の開始行は、直前のブロックと連結しない新しい文。
      flush();
      appendToBlock(stripped.replace(BLOCK_MARKER_RE, ""), lineNo);
    } else {
      // マーカーの無い行は、直前のブロックのソフトラップの続き
      // （直前が空行等で閉じていれば新しいブロックの先頭になる）。
      appendToBlock(stripped, lineNo);
    }
  }
  flush();
}

for (const file of mdTargets) checkMarkdownFile(file);

// ─── 報告 ─────────────────────────────────────────────────────────────────────

for (const v of violations) {
  console.error(`${v.file}:${v.line}: ${v.rule}: ${v.excerpt}`);
}

if (violations.length > 0) {
  console.error(`\n${violations.length} 件の違反`);
  console.error(
    "意図的に規則を破る場合は scripts/lib/text-rules.ts の ALLOW に理由つきで登録する。",
  );
  process.exit(1);
}

console.log(
  `違反なし（TS リテラル ${literalsScanned} 件・Markdown ${linesScanned} 行を検査、ALLOW ${ALLOW.size} 件）`,
);
