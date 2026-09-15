/**
 * jsx-text.ts — 画面（.tsx）に日本語のUI文言が直書きされていないかの検査。
 *
 * 規約「UIに出す文字列は web/src/i18n/ja.ts 以外に書かない」の機械検査。
 * 見るのは JSX の 2 か所だけ。
 *
 *  - テキストノード … `<p>読み込み中…</p>` の「読み込み中…」
 *  - 属性値 … `title="閉じる"`、`placeholder="…"`、`aria-label="…"` など
 *
 * 対象外：コメント（ASTに現れない）、`{ja.day.loading}` のような参照（文字列
 * リテラルではない）、関数の中身（`onClick={() => confirm('…')}` のような
 * ハンドラは「テキストノードと属性値」ではないので、この規則では見ない）。
 */

import ts from "typescript";
import { JP, excerpt, type Finding } from "./text-rules";

export const JSX_HARDCODED_RULE = "UI 文言の直書き — ja.ts に置く";

export type LocatedFinding = Finding & { line: number };

/** 関数の境界。ここから先は「テキストノードと属性値」ではないので降りない。 */
function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)
  );
}

/** ノードが直に持つ文字列（テンプレートリテラルの断片を含む）。無ければ null。 */
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

/**
 * 式の中の日本語を含む文字列リテラルを集める（関数の中には降りない）。
 * `{'あ'}`、`{cond ? 'あ' : 'い'}`、`` {`あ${x}`} `` のような書き方を拾う。
 */
function collectJapaneseLiterals(node: ts.Node, out: ts.Node[]): void {
  if (isFunctionLike(node)) return;
  const text = literalText(node);
  if (text !== null && JP.test(text)) out.push(node);
  node.forEachChild((child) => collectJapaneseLiterals(child, out));
}

/**
 * JSX に直書きされた日本語を探す。
 * @param source .tsx のソース
 * @param fileName AST を作るときの名前（拡張子で TSX と判定させる）
 */
export function findHardcodedJsxText(source: string, fileName = "input.tsx"): LocatedFinding[] {
  const found: LocatedFinding[] = [];
  if (!JP.test(source)) return found;
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );

  const push = (node: ts.Node, text: string, at: number): void => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    found.push({ rule: JSX_HARDCODED_RULE, excerpt: excerpt(text, at), line: line + 1 });
  };

  const visit = (node: ts.Node): void => {
    // (a) テキストノード。字下げや改行だけの JsxText は対象にしない。
    if (ts.isJsxText(node)) {
      const text = node.text.trim();
      if (JP.test(text)) push(node, text, text.search(JP));
    }

    // (b) 属性値。`title="閉じる"` と `title={'閉じる'}` の両方を見る。
    if (ts.isJsxAttribute(node)) {
      const init = node.initializer;
      const literals: ts.Node[] = [];
      if (init !== undefined) {
        if (ts.isStringLiteral(init)) {
          if (JP.test(init.text)) literals.push(init);
        } else if (ts.isJsxExpression(init) && init.expression !== undefined) {
          collectJapaneseLiterals(init.expression, literals);
        }
      }
      for (const lit of literals) {
        const text = literalText(lit) ?? "";
        push(lit, text, text.search(JP));
      }
    }

    // (c) 子要素の式（`<p>{'読み込み中…'}</p>`）。属性値の式は (b) が見るので除く。
    if (
      ts.isJsxExpression(node) &&
      node.expression !== undefined &&
      node.parent !== undefined &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      const literals: ts.Node[] = [];
      collectJapaneseLiterals(node.expression, literals);
      for (const lit of literals) {
        const text = literalText(lit) ?? "";
        push(lit, text, text.search(JP));
      }
    }

    node.forEachChild(visit);
  };
  visit(sourceFile);
  return found;
}
