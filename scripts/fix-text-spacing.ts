/**
 * fix-text-spacing.ts — `check-text.ts` が報告する定型の違反を一括修正する。
 *
 * 対象は既定で `docs/**\/*.md` と `CLAUDE.md`（引数にファイルを渡せばそれだけを
 * 直す）。`web/src/i18n/ja.ts` は対象にしない（別の担当が編集中のため）。
 *
 * 直すのは次の 3 種類だけ（件数が多く、機械的に安全に直せるもの）。
 *  - 規則7: 仮名・漢字・長音符と ASCII 可視文字の間の半角スペース 1 つを削除。
 *  - 規則5: 前後どちらかが日本語の半角コロン `:` を全角「：」に。
 *  - 規則3: ASCII の三点リーダー `...` を「…」に。
 *
 * 規則1（半角括弧）・規則2（余分な半角スペース）・カーリークォートは件数が
 * わずかで自動変換の判断が難しいため、ここでは直さない
 *（`bun run check:text` の残りを見て手で直す）。
 *
 * 地の文の境界は `check-text.ts` と同じ判定を共有する（`lib/markdown-text.ts`）:
 * コードブロック・行内コード・URL・Markdown リンクの URL 部分・表の罫線行・
 * frontmatter・見出しや箇条書きの行頭記号は触らない。
 *
 * 使い方:
 *   bun run scripts/fix-text-spacing.ts --dry-run   変更行数だけ表示（書き込まない）
 *   bun run scripts/fix-text-spacing.ts             実際に書き換える
 *   bun run scripts/fix-text-spacing.ts docs/x.md   対象ファイルを指定
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ASCII_VISIBLE, JP_CLASS, JP_SCRIPT_CLASS } from "./lib/text-rules";
import { BLOCK_MARKER_RE, TABLE_RULE_RE, editEditableSpans } from "./lib/markdown-text";

const ROOT = process.cwd();

// ─── 対象ファイルの決定（check-text.ts の defaultMarkdownTargets と同じ規則） ──

function collectMarkdownFiles(dir: string, out: string[]): void {
  const st = statSync(dir, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) collectMarkdownFiles(p, out);
    else if (entry.name.endsWith(".md")) out.push(p);
  }
}

function defaultTargets(): string[] {
  const out: string[] = [];
  collectMarkdownFiles(resolve(ROOT, "docs"), out);
  const claudeMd = resolve(ROOT, "CLAUDE.md");
  if (statSync(claudeMd, { throwIfNoEntry: false })) out.push(claudeMd);
  return out;
}

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const fileArgs = argv.filter((a) => a !== "--dry-run");
const targets = fileArgs.length > 0 ? fileArgs.map((p) => resolve(ROOT, p)) : defaultTargets();

// ─── 変換本体 ─────────────────────────────────────────────────────────────────

/** 規則7: `[JP] [ASCII]` / `[ASCII] [JP]` の半角スペース 1 つを削除。 */
const RULE7_JP_ASCII = new RegExp(`([${JP_SCRIPT_CLASS}]) ([${ASCII_VISIBLE}])`, "g");
const RULE7_ASCII_JP = new RegExp(`([${ASCII_VISIBLE}]) ([${JP_SCRIPT_CLASS}])`, "g");

/** 規則5: 日本語に接する半角コロンを全角「：」に（前後の半角スペースも消す）。 */
const RULE5_JP_BEFORE = new RegExp(`([${JP_CLASS}]) ?: ?`, "g");
const RULE5_JP_AFTER = new RegExp(`: ?([${JP_CLASS}])`, "g");

/** 規則3: ASCII の三点リーダー。 */
const RULE3_ELLIPSIS = /\.\.\./g;

/** 地の文の断片（保護範囲を除いた部分）1 つぶんに 3 規則を順に適用する。
 *  規則7 の 2 方向は互いの文字クラスが重ならないので、順に適用してよい
 *  （片方の削除がもう片方の新しい一致を生まない）。 */
export function applyRulesToSegment(segment: string): string {
  return segment
    .replace(RULE7_JP_ASCII, "$1$2")
    .replace(RULE7_ASCII_JP, "$1$2")
    .replace(RULE5_JP_BEFORE, "$1：")
    .replace(RULE5_JP_AFTER, "：$1")
    .replace(RULE3_ELLIPSIS, "…");
}

/** 表の行（罫線を除く、`|` を含む行）を、セル単位で変換する。
 *  セルの前後の空白（パディング）はそのまま残し、トリムした中身だけ変換する
 *  ——`check-text.ts` がセルをトリムしてから検査するのと同じ境界。 */
function fixTableRow(line: string): string {
  return line
    .split("|")
    .map((cell) => {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(cell)!;
      const lead = m[1] ?? "";
      const core = m[2] ?? "";
      const trail = m[3] ?? "";
      return lead + editEditableSpans(core, applyRulesToSegment) + trail;
    })
    .join("|");
}

/** 見出し・箇条書き・引用の行頭記号を残し、残りだけ変換する
 *  ——`check-text.ts` が `BLOCK_MARKER_RE` を剥がしてから検査するのと同じ境界。 */
function fixProseLine(line: string): string {
  const m = BLOCK_MARKER_RE.exec(line);
  const markerLen = m ? m[0].length : 0;
  const marker = line.slice(0, markerLen);
  const rest = line.slice(markerLen);
  return marker + editEditableSpans(rest, applyRulesToSegment);
}

export function fixMarkdownSource(source: string): { text: string; changedLines: number } {
  const lines = source.split("\n");
  const out: string[] = [];
  let changedLines = 0;

  let i = 0;
  // frontmatter はそのまま通す。
  if (lines[0]?.trim() === "---") {
    out.push(lines[0]!);
    i = 1;
    while (i < lines.length && lines[i]?.trim() !== "---") {
      out.push(lines[i]!);
      i++;
    }
    if (i < lines.length) {
      out.push(lines[i]!);
      i++;
    }
  }

  let inFence = false;
  for (; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      out.push(raw);
      continue;
    }
    if (inFence) {
      out.push(raw);
      continue;
    }
    if (raw.trim().length === 0 || TABLE_RULE_RE.test(raw)) {
      out.push(raw);
      continue;
    }
    const fixed = /\|/.test(raw) ? fixTableRow(raw) : fixProseLine(raw);
    if (fixed !== raw) changedLines++;
    out.push(fixed);
  }
  return { text: out.join("\n"), changedLines };
}

// ─── 実行 ─────────────────────────────────────────────────────────────────────
// `scripts/check-text.test.ts` がテストのために本ファイルを import しても、
// このブロックは走らない（import.meta.main は CLI として直接実行したときだけ真）。

if (import.meta.main) {
  let totalChangedLines = 0;
  let totalChangedFiles = 0;
  for (const file of targets) {
    const st = statSync(file, { throwIfNoEntry: false });
    if (!st || !st.isFile()) continue;
    const source = readFileSync(file, "utf8");
    const { text, changedLines } = fixMarkdownSource(source);
    if (changedLines === 0) continue;
    totalChangedFiles++;
    totalChangedLines += changedLines;
    console.log(`${relative(ROOT, file)}: ${changedLines} 行を変換`);
    if (!dryRun) writeFileSync(file, text);
  }

  console.log(
    `\n${dryRun ? "[dry-run] " : ""}${totalChangedFiles} ファイル・${totalChangedLines} 行を変換`,
  );
}
