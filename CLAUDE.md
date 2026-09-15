# mnemorize（「やったこと」の記録と間隔反復による再提示）

GitHub: https://github.com/gridhra/mnemorize 。内部の符号は2026-09-15に `srw` から `mnemorize` に改名済み（データ置き場・環境変数 `MNEMORIZE_*`・ファイル名接頭辞）。

Bun 1プロセスのローカルWebアプリ。HonoのAPIサーバー（8790）＋ Preactの単一ページアプリ。
ネットワークは使わない。基準文書 `docs/design/01-architecture.md`、要件 `docs/requirements/01-needs-and-requirements-draft.md`。

## 運用の前提

本番環境は無い。個人がローカルで使うだけのアプリで、公開URLもデプロイ先も存在しない。
`main` へのpushはGitHubへのバックアップであり、公開やデプロイではない。ただしgit操作は指示された動詞の範囲だけ行う（commitとpushは別の指示。「マージ」にpushは含まれない）。

## コマンド

操作はmiseのタスクに集約している（初回だけ `mise trust` が要る）。`mise tasks` で一覧、`mise run <名前>` で実行。

- `mise run install` … 依存の導入
- `mise run dev` … APIサーバー（http://localhost:8790）とVite（http://localhost:5173）を同時起動。Viteは `/api` と `/files` を8790にプロキシする。画面は5173を開く
- `mise run dev:stop` … 8790と5173で待ち受けているプロセスを止める（無ければ何もしない）
- `mise run build` … 単一ページアプリを `web/dist/` にビルド
- `mise run start` … ビルド済みの `web/dist/` をHonoから配信し、8790だけで動かす
- `mise run test` … 単体テスト（`*.test.ts`）
- `mise run typecheck` … 型検査のみ
- `mise run check:text` / `mise run fix:text` … 文言の正書法検査／一括修正
- `mise run check` … typecheck・test・check:text・buildを順に実行（変更を出す前の一括確認）
- `mise run verify -- [ISO日時]` … 一時データ置き場（`.verify-data/`）・別ポート（8798）・静的配信で検証用サーバーを起動。引数でMNEMORIZE_FAKE_NOWを渡せる
- `mise run verify:reset` … `.verify-data/` を消す

miseを使わない場合は `bun install` / `bun run scripts/dev.ts` / `bun run build` / `bun start` / `bun test` / `bun run typecheck` で同等に動く。

## 開発サーバー

ユーザーが `mise run dev` を常時動かしていることが多い。サブエージェントや検証はこれを止めず、
`mise run verify` の別ポート（8798）を使う。マイグレーションはサーバー起動時にだけ当たるので、
マイグレーションを足したら手元の開発サーバーを `mise run dev:stop && mise run dev` で起動し直す必要がある。
検証で起動したプロセスは、自分が起動したPIDだけを止める（`pkill -f server/index.ts` のようなパターン一括停止は他の担当の検証サーバーを巻き添えにした事故がある。2026-09-15）。

## データ

環境変数 `MNEMORIZE_DATA_DIR`、未設定ならリポジトリ直下の `data/`（git管理外。`.gitignore` 済み）。起動時に作成し、
`mnemorize.sqlite` をWALモード・foreign_keys ONで開き、未適用のマイグレーションを適用する。
テストは `MNEMORIZE_DATA_DIR` を一時ディレクトリに向けて独立したDBを使う。
検証やアドホックな実行で `data/`（本番の記録が入っている）を汚さないこと。過去に `MNEMORIZE_DATA_DIR` を付けずにサーバーやスクリプトを動かし、本番置き場に空DBやテスト記録を作った事故が2回ある。検証は必ず `mise run verify` を使う。
`~/Library/Application Support/mnemorize/` は2026-09-15より前の旧置き場で、いまは使わない。

## ブラウザでの動作確認

Claude in Chrome拡張は接続されていないことが多い。Chromeを `--remote-debugging-port` と別プロファイルで起動し、DevTools Protocolで操作する。録音ボタンは合成クリック（`element.click()`）では反応しないため `Input.dispatchMouseEvent`（先に `Page.bringToFront` を送る。背面だと入力が届かない）を使う。マイクは `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` を付ける。

## 文章

画面文言・文書は `docs/design/05-ui-grand-design.md` §5の規範と正書法（下記）に従う。文言や文章表現で判断が要る変更は、
自分で決めて理由を添えて報告し、細部を「案です」とユーザーに投げ返さない（2026-09-15にユーザーから指摘済み）。

## ディレクトリ

- `mise.toml` 起動・検査タスクの定義
- `server/index.ts` 起動、`server/app.ts` Honoの組み立て（ルートの登録口。追加は1行）
- `server/routes/` HTTPルート。薄く保ち、ロジックはservicesに置く
- `server/services/` 記録・検索・設定などのロジック
- `server/adapters/` 外界との境界（ファイル、サブプロセス、時刻）。ここだけをTauri化で差し替える
- `server/db/` 接続・マイグレーション実行器・連番SQL・SQL置き場
- `web/src/` 画面。`pages/` 画面（`Calendar.tsx` 月の画面、`Day.tsx` 日の画面を含む）、`components/` 部品、
  `i18n/ja.ts` 文言、`api.ts` fetchラッパー、`router.ts` ハッシュルーター（`#/…`のURLを解釈する）、
  `dates.ts` 日付文字列どうしの計算（学習日の境界は含まない）、`queue-context.ts` 復習件数バッジの更新用Context
- `docs/` 要件・調査・設計、`spikes/` 技術検証（本体からは参照しない）
- `scripts/check-text.ts`（`mise run check:text`）文言の正書法検査、`scripts/fix-text-spacing.ts` その一括修正

## 規約

- 識別子は英語、コメントとUI文言は日本語。UIに出す文字列は `web/src/i18n/ja.ts` 以外に書かない。
  `mise run check:text` が、画面（`web/src/**/*.tsx`）のJSXのテキストノードと属性値に日本語が直書きされていないかを検査する。
- 外界（ファイル、サブプロセス、時刻）に触れる処理は `server/adapters/` にだけ置く。
  「学習日」は午前4時境界で決まる。日付の計算は必ず `server/adapters/clock.ts` を使う。
- SQLは `server/db/queries/` か各サービス内に文字列で書く。ORMは使わない。
- スキーマ変更は新しい連番マイグレーションファイル（`0004_*.sql` 以降）で。既存ファイルは編集しない。
- マイグレーション連番は0002が欠番。今後0002は使わず0004以降を使う（0003適用済みの既存DBでは、あとから足した0002が0003の後に流れて適用順が崩れるため）。
- idは `Bun.randomUUIDv7()`。時刻はISO 8601のローカルオフセット付き文字列（`toLocalIso`）。
- 日本語IME：入力欄では `web/src/hooks/ime.ts` の `useIme` を使い、変換中のキー操作を無視する。
- 表示するHTMLは必ずエスケープする（`web/src/markdown.ts` を通す）。
- 画面に出る文言は正書法（和文と半角英数の間を詰める、機能する記号は全角）で書く。`mise run check:text` で検査する。hookがEdit/Write後に自動で走る。
