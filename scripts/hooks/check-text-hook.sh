#!/usr/bin/env bash
# check-text-hook.sh — Claude Code の PostToolUse hook（Edit|Write）。
#
# 標準入力から渡される hook イベントの JSON を読み、編集されたファイルが
# web/src/i18n/ja.ts か画面（.tsx）か Markdown（.md）なら scripts/check-text.ts で
# そのファイルだけを検査する（.tsx は「UI 文言の直書き」の検査）。違反があれば
# 標準エラーに出して終了コード 2 を返す（Claude Code は終了コード 2 の標準エラーを
# モデルへの追加指示として渡す）。
# 対象外のファイルは何もせず終了コード 0。
#
# jq に依存しないよう、JSON の取り出しは bun -e の小さなスクリプトで行う。
set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

INPUT_JSON="$(cat)"

FILE_PATH="$(bun -e '
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  try {
    const data = JSON.parse(input);
    process.stdout.write(data?.tool_input?.file_path ?? "");
  } catch {
    process.stdout.write("");
  }
' <<< "$INPUT_JSON")"

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# プロジェクト配下のファイルだけを検査する（~/.claude/plans/ の計画ファイルなど、
# プロジェクト外の Markdown には反応しない）。相対パスはプロジェクト配下とみなす。
case "$FILE_PATH" in
  /*)
    case "$FILE_PATH" in
      "$PROJECT_DIR"/*) ;;
      *) exit 0 ;;
    esac
    ;;
esac

case "$FILE_PATH" in
  */web/src/i18n/ja.ts|web/src/i18n/ja.ts)
    ;;
  *.tsx)
    ;;
  *.md)
    ;;
  *)
    exit 0
    ;;
esac

if ! OUTPUT="$(cd "$PROJECT_DIR" && bun run scripts/check-text.ts "$FILE_PATH" 2>&1)"; then
  echo "$OUTPUT" >&2
  exit 2
fi

exit 0
