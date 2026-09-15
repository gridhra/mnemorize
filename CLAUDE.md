# mnemorize（「やったこと」の記録と間隔反復による再提示）

GitHub: https://github.com/gridhra/mnemorize 。内部の符号は 2026-09-15 に `srw` から `mnemorize` に改名済み（データ置き場・環境変数 `MNEMORIZE_*`・ファイル名接頭辞）。

Bun 1 プロセスのローカル Web アプリ。Hono の API サーバー（8790）＋ Preact の単一ページアプリ。
ネットワークは使わない。基準文書 `docs/design/01-architecture.md`、要件 `docs/requirements/01-needs-and-requirements-draft.md`。

## コマンド

- `bun install` … 依存の導入
- `bun dev` … API サーバー（http://localhost:8790）と Vite（http://localhost:5173）を同時起動。
  Vite は `/api` と `/files` を 8790 にプロキシする。画面は 5173 を開く。
- `bun run build` … 単一ページアプリを `web/dist/` にビルド
- `bun start` … ビルド済みの `web/dist/` を Hono から配信し、8790 だけで動かす
- `bun test` … 単体テスト（`*.test.ts`）
- `bun run typecheck` … 型検査のみ

## ディレクトリ

- `server/index.ts` 起動、`server/app.ts` Hono の組み立て（ルートの登録口。追加は 1 行）
- `server/routes/` HTTP ルート。薄く保ち、ロジックは services に置く
- `server/services/` 記録・検索・設定などのロジック
- `server/adapters/` 外界との境界（ファイル、サブプロセス、時刻）。ここだけを Tauri 化で差し替える
- `server/db/` 接続・マイグレーション実行器・連番 SQL・SQL 置き場
- `web/src/` 画面。`pages/` 画面、`components/` 部品、`i18n/ja.ts` 文言、`api.ts` fetch ラッパー
- `docs/` 要件・調査・設計、`spikes/` 技術検証（本体からは参照しない）

## データの置き場

環境変数 `MNEMORIZE_DATA_DIR`、未設定なら `~/Library/Application Support/mnemorize/`。起動時に作成し、
`mnemorize.sqlite` を WAL モード・foreign_keys ON で開き、未適用のマイグレーションを適用する。
テストは `MNEMORIZE_DATA_DIR` を一時ディレクトリに向けて独立した DB を使う。

## 規約

- 識別子は英語、コメントと UI 文言は日本語。UI に出す文字列は `web/src/i18n/ja.ts` 以外に書かない。
- 外界（ファイル、サブプロセス、時刻）に触れる処理は `server/adapters/` にだけ置く。
  「学習日」は午前 4 時境界で決まる。日付の計算は必ず `server/adapters/clock.ts` を使う。
- SQL は `server/db/queries/` か各サービス内に文字列で書く。ORM は使わない。
- スキーマ変更は新しい連番マイグレーションファイル（`0004_*.sql` 以降）で。既存ファイルは編集しない。
- マイグレーション連番は 0002 が欠番。今後 0002 は使わず 0004 以降を使う（0003 適用済みの既存 DB では、あとから足した 0002 が 0003 の後に流れて適用順が崩れるため）。
- id は `Bun.randomUUIDv7()`。時刻は ISO 8601 のローカルオフセット付き文字列（`toLocalIso`）。
- 日本語 IME：入力欄では `web/src/hooks/ime.ts` の `useIme` を使い、変換中のキー操作を無視する。
- 表示する HTML は必ずエスケープする（`web/src/markdown.ts` を通す）。
