# mnemorize（「やったこと」の記録と間隔反復による再提示）

GitHub: https://github.com/gridhra/mnemorize 。内部の符号は2026-09-15に `srw` から `mnemorize` に改名済み（データ置き場・環境変数 `MNEMORIZE_*`・ファイル名接頭辞）。

Bun 1プロセスのローカルWebアプリ。HonoのAPIサーバー（8790）＋ Preactの単一ページアプリ。
ネットワークは使わない。基準文書 `docs/design/01-architecture.md`、要件 `docs/requirements/01-needs-and-requirements-draft.md`。

## コマンド

- `bun install` … 依存の導入
- `bun dev` … APIサーバー（http://localhost:8790）とVite（http://localhost:5173）を同時起動。
  Viteは `/api` と `/files` を8790にプロキシする。画面は5173を開く。
- `bun run build` … 単一ページアプリを `web/dist/` にビルド
- `bun start` … ビルド済みの `web/dist/` をHonoから配信し、8790だけで動かす
- `bun test` … 単体テスト（`*.test.ts`）
- `bun run typecheck` … 型検査のみ

## ディレクトリ

- `server/index.ts` 起動、`server/app.ts` Honoの組み立て（ルートの登録口。追加は1行）
- `server/routes/` HTTPルート。薄く保ち、ロジックはservicesに置く
- `server/services/` 記録・検索・設定などのロジック
- `server/adapters/` 外界との境界（ファイル、サブプロセス、時刻）。ここだけをTauri化で差し替える
- `server/db/` 接続・マイグレーション実行器・連番SQL・SQL置き場
- `web/src/` 画面。`pages/` 画面（`Calendar.tsx` 月の画面、`Day.tsx` 日の画面を含む）、`components/` 部品、
  `i18n/ja.ts` 文言、`api.ts` fetchラッパー、`router.ts` ハッシュルーター（`#/…`のURLを解釈する）、
  `dates.ts` 日付文字列どうしの計算（学習日の境界は含まない）、`queue-context.ts` 復習件数バッジの更新用Context
- `docs/` 要件・調査・設計、`spikes/` 技術検証（本体からは参照しない）
- `scripts/check-text.ts`（`bun run check:text`）文言の正書法検査、`scripts/fix-text-spacing.ts` その一括修正

## データの置き場

環境変数 `MNEMORIZE_DATA_DIR`、未設定ならリポジトリ直下の `data/`（git管理外。`.gitignore` 済み）。起動時に作成し、
`mnemorize.sqlite` をWALモード・foreign_keys ONで開き、未適用のマイグレーションを適用する。
テストは `MNEMORIZE_DATA_DIR` を一時ディレクトリに向けて独立したDBを使う。

## 規約

- 識別子は英語、コメントとUI文言は日本語。UIに出す文字列は `web/src/i18n/ja.ts` 以外に書かない。
- 外界（ファイル、サブプロセス、時刻）に触れる処理は `server/adapters/` にだけ置く。
  「学習日」は午前4時境界で決まる。日付の計算は必ず `server/adapters/clock.ts` を使う。
- SQLは `server/db/queries/` か各サービス内に文字列で書く。ORMは使わない。
- スキーマ変更は新しい連番マイグレーションファイル（`0004_*.sql` 以降）で。既存ファイルは編集しない。
- マイグレーション連番は0002が欠番。今後0002は使わず0004以降を使う（0003適用済みの既存DBでは、あとから足した0002が0003の後に流れて適用順が崩れるため）。
- idは `Bun.randomUUIDv7()`。時刻はISO 8601のローカルオフセット付き文字列（`toLocalIso`）。
- 日本語IME：入力欄では `web/src/hooks/ime.ts` の `useIme` を使い、変換中のキー操作を無視する。
- 表示するHTMLは必ずエスケープする（`web/src/markdown.ts` を通す）。
- 画面に出る文言は正書法（和文と半角英数の間を詰める、機能する記号は全角）で書く。`bun run check:text` で検査する。hookがEdit/Write後に自動で走る。
