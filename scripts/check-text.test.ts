import { describe, expect, test } from "bun:test";
import { fixMarkdownSource } from "./fix-text-spacing";
import { inspect } from "./lib/text-rules";

/** ある文字列が指定した規則名を含む Finding を出すかどうか。 */
function violatesRule(text: string, ruleSubstring: string, standalone = true): boolean {
  return inspect(text, standalone).some((f) => f.rule.includes(ruleSubstring));
}

describe("規則1: 和文中の半角括弧", () => {
  test("違反する例: 括弧の中身が日本語", () => {
    expect(violatesRule("これは(注記)です", "半角括弧")).toBe(true);
  });
  test("違反しない例: 中身が半角英数だけの欧文書誌の記法", () => {
    expect(violatesRule("これは JCS 56 (2004) の記法です", "半角括弧")).toBe(false);
  });
});

describe("規則2: 余分な半角スペース", () => {
  test("違反する例: 閉じ約物の直後の半角スペース", () => {
    expect(violatesRule("「はい」 と答えた", "余分な半角スペース")).toBe(true);
  });
  test("違反しない例: 半角どうしの語間スペースは対象外", () => {
    expect(violatesRule("標高は 1,304 m です", "余分な半角スペース")).toBe(false);
  });
});

describe("規則3: 三点リーダー", () => {
  test("違反する例: ASCII の ...", () => {
    expect(violatesRule("読み込み中...", "…")).toBe(true);
  });
  test("違反しない例: 全角三点リーダー …", () => {
    expect(violatesRule("読み込み中…", "…")).toBe(false);
  });
});

describe("規則4: 鉤括弧の対応", () => {
  test("違反する例: 「が閉じていない", () => {
    expect(violatesRule("「これは開いたまま", "開閉が不整合")).toBe(true);
  });
  test("違反しない例: 「」がきちんと対応している", () => {
    expect(violatesRule("「これは正しい」です", "開閉が不整合")).toBe(false);
  });
});

describe("補足: 和文中のカーリークォート", () => {
  test("違反する例: カーリークォートを使っている", () => {
    expect(violatesRule("これは“注意”です", "カーリークォート")).toBe(true);
  });
  test("違反しない例: 鉤括弧を使っている", () => {
    expect(violatesRule("これは「注意」です", "カーリークォート")).toBe(false);
  });
});

describe("規則5: 和文中の半角コロン", () => {
  test("違反する例: 日本語の直後に半角コロン", () => {
    expect(violatesRule("理由: これです", "半角コロン")).toBe(true);
  });
  test("違反しない例: 前後とも非日本語（URL の一部）", () => {
    expect(violatesRule("参照先は https://example.com/a です", "半角コロン")).toBe(false);
  });
});

describe("規則6: 制御文字", () => {
  test("違反する例: C1 制御文字が混入している", () => {
    expect(violatesRule("正常な文字列", "制御文字")).toBe(true);
  });
  test("違反しない例: 制御文字を含まない通常の文字列", () => {
    expect(violatesRule("正常な文字列です", "制御文字")).toBe(false);
  });
});

describe("規則7: 日英間の半角スペース", () => {
  test("違反する例: 日本語と半角英数字のあいだにスペースがある", () => {
    expect(violatesRule("約26kmではなく約 26km", "日英間の半角スペース")).toBe(true);
  });
  test("違反しない例: 詰めて書いてある", () => {
    expect(violatesRule("約26kmの距離です", "日英間の半角スペース")).toBe(false);
  });
});

describe("inspect(): 日本語を含まない文字列は制御文字以外の規則を適用しない", () => {
  test("英語だけの文字列は括弧やスペースの規則に掛からない", () => {
    expect(inspect("This is a (test) string.", true)).toEqual([]);
  });
});

describe("fixMarkdownSource(): scripts/fix-text-spacing.ts の一括変換", () => {
  test("規則7: 和文と半角英数の間の半角スペースを削除する", () => {
    const { text } = fixMarkdownSource("約 26km の距離です。\n");
    expect(text).toBe("約26kmの距離です。\n");
  });

  test("規則7: 半角どうしの語間スペースは残す（欧文の連語）", () => {
    const { text } = fixMarkdownSource("Bun 1.2 と Vol. 2、標高 1,304 m の話。\n");
    expect(text).toBe("Bun 1.2とVol. 2、標高1,304 mの話。\n");
  });

  test("規則5: 日本語に接する半角コロンを全角に変える", () => {
    const { text } = fixMarkdownSource("理由: これです。\n");
    expect(text).toBe("理由：これです。\n");
  });

  test("規則5: URL の http: や時刻の 14:30 は変えない", () => {
    // URL は丸ごと保護範囲なので、直前の「は」との間の半角スペースにも
    // 規則7（日英間スペース）は掛からない——check-text.ts の検査が URL を
    // プレースホルダに置き換えてから調べるのと同じ境界。
    const { text } = fixMarkdownSource("参照先は https://example.com/a、開始は14:30。\n");
    expect(text).toBe("参照先は https://example.com/a、開始は14:30。\n");
  });

  test("規則3: ASCII の ... を … に変える", () => {
    const { text } = fixMarkdownSource("読み込み中...\n");
    expect(text).toBe("読み込み中…\n");
  });

  test("コードブロックの中身は変換しない", () => {
    const src = "説明 text です。\n```\n変数 x です\n```\n";
    const { text } = fixMarkdownSource(src);
    expect(text).toBe("説明textです。\n```\n変数 x です\n```\n");
  });

  test("行内コードの中身は変換しない（コードとの境界のスペースも触らない）", () => {
    const { text } = fixMarkdownSource("`変数 x` は 説明 text です。\n");
    expect(text).toBe("`変数 x` は 説明textです。\n");
  });

  test("Markdown リンクの URL 部分は変換しない（リンク文は変換する）", () => {
    const src = "詳細は [参照 doc](https://example.com/a b) を見る。\n";
    const { text } = fixMarkdownSource(src);
    expect(text).toBe("詳細は[参照doc](https://example.com/a b)を見る。\n");
  });

  test("表の罫線行は変換しない", () => {
    const src = "| 見出し A | 値 |\n|---|---|\n| 内容 text | 1 |\n";
    const { text } = fixMarkdownSource(src);
    expect(text).toBe("| 見出しA | 値 |\n|---|---|\n| 内容text | 1 |\n");
  });

  test("表のセルは中身だけ変換し、セル前後のパディングは残す", () => {
    const src = "| 条件 A | 値 |\n|---|---|\n";
    const { text } = fixMarkdownSource(src);
    expect(text).toBe("| 条件A | 値 |\n|---|---|\n");
  });

  test("frontmatter は変換しない", () => {
    const src = "---\ntitle: test 1\n---\n本文 text です。\n";
    const { text } = fixMarkdownSource(src);
    expect(text).toBe("---\ntitle: test 1\n---\n本文textです。\n");
  });

  test("見出し・箇条書きの行頭記号は変換対象から外す", () => {
    const src = "# 見出し 1\n- 項目 A です\n";
    const { text } = fixMarkdownSource(src);
    expect(text).toBe("# 見出し1\n- 項目Aです\n");
  });

  test("変更行数を数える", () => {
    const { changedLines } = fixMarkdownSource("約 26km。\n変更なし。\n読み込み中...\n");
    expect(changedLines).toBe(2);
  });
});
