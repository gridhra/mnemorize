# 設計 02：実装計画と進行状況

- 作成日：2026-09-15
- 目的：実装を複数のサブエージェントに分担させるための、段階・担当範囲（ファイルの所有権）・状態の一覧。別セッションの Claude Code や、途中から参加する担当者が「いま何がどこまでできていて、次に何をするか」を把握するために読む。
- 基準文書：`docs/design/01-architecture.md`（構成・データモデル・API・画面）。

## 進め方の原則

1. **土台を先に 1 本で作る**（段階 0〜1）。依存関係ファイル（package.json、マイグレーション、ルート登録）への同時書き込みを避けるため。
2. **その後に 3 本を並列**（段階 2〜5 を機能単位で分割）。各担当は自分の所有ファイルだけを編集し、共有ファイル（`server/app.ts` のルート登録、`web/src/main.tsx` のタブ登録、`i18n/ja.ts`）には**追記のみ**行う。
3. 各担当は自分の範囲の `bun test` を書き、`bun test` 全体が通る状態で終える。
4. 最後に司令塔（Fable）が結合確認と、ブラウザでの通し確認を行う。

## 段階と担当

| 段階 | 内容 | 担当モデル | 所有するファイル | 状態 |
|---|---|---|---|---|
| 0〜1 | 骨格、DB とマイグレーション、記録の手入力 CRUD、日付移動、履歴、検索、「今日」画面、IME 対応、CLAUDE.md | Opus | ルート設定一式、`server/db/*`、`server/routes/{days,entries,settings,search,health}.ts`、`server/services/entries.ts`、`server/adapters/clock.ts`、`web/src/{main.tsx,api.ts,i18n/ja.ts,pages/Today.tsx,pages/Search.tsx,components/Entry*.tsx}` | 完了（2026-09-15。テスト 31 件、Chrome で IME 動作確認済み） |
| 4 | ts-fsrs ラッパー、復習キュー API、評価の記録、リセット、卒業、「復習」画面 | Opus | `server/services/{scheduler,reviews}.ts`、`server/routes/reviews.ts`、`web/src/pages/Review.tsx`、`web/src/components/ReviewCard.tsx` | 完了（2026-09-15） |
| 2 | 録音（AudioWorklet → 16kHz WAV）、文字起こしジョブ、whisper-cli アダプタ、SSE 進捗、再試行、定型ハルシネーション句の除去 | Opus | `server/adapters/asr-whisper-cli.ts`、`server/services/transcribe.ts`、`server/routes/transcriptions.ts`、`web/src/audio/*`、`web/src/components/Recorder.tsx` | 完了（2026-09-15） |
| 3・5 | 画像添付、ファイル配信、Markdown/JSON 書き出し、スナップショット、「設定」画面 | Sonnet | `server/adapters/files.ts`、`server/services/exporter.ts`、`server/routes/{attachments,files,export}.ts`、`web/src/pages/Settings.tsx`、`web/src/components/Attachments.tsx` | 完了（2026-09-15） |
| 6 | 結合確認、ブラウザ通し確認、コードレビュー、細部の磨き込み | Fable + Sonnet（受け入れ確認）+ Opus（レビュー） | 全体 | 進行中（2026-09-15）。司令塔の結合確認で、テスト全 100 件通過（1 件は実機 whisper のためスキップ）、型検査・ビルド通過。修正 2 件：fuzz の下限を誤っていたテスト期待値、`/api/health` の時刻取得を `clock.now()` に統一。 |
| 6（修正） | コードレビュー（`docs/design/04-code-review-2026-09-15.md`）と受け入れ確認（`docs/design/03-acceptance-check-2026-09-15.md`）で挙がった指摘の修正 | Opus | 全体 | 完了（2026-09-15）。誤動作 8 件（取り消しで自動卒業が戻らない、画像欠けで書き出しが 500、時刻規約違反、文字起こし反映とジョブ完了の非トランザクション、SSE の後始末、設定値の未検証、WAV 不正・壊れた URL 符号の 500、スナップショット名の衝突）、画面 6 件（復習バッジの件数、取り消しボタン、復習のやり直しチェック、ライトボックスの Escape、段落の空行、失敗した文字起こしの再表示）、整理 3 件を修正。テスト 115 件通過（ほかに実機 whisper の 1 件はスキップ）、型検査・ビルド通過。 |

## 各担当が守る境界

- **ルート追加**：`server/routes/<名前>.ts` に Hono のサブアプリを作り、`server/app.ts` に 1 行追加する。他のルートファイルは編集しない。
- **DB 変更**：段階 0〜1 で全テーブルを作ってあるので、追加の列が必要なときだけ新しい連番マイグレーション（`0002_*.sql` 以降）を足す。既存のマイグレーションは編集しない。
- **文言**：`web/src/i18n/ja.ts` に自分の画面の文言をまとめて追記する（キーの接頭辞を画面名にする。例：`review.*`）。
- **タブ登録**：`web/src/main.tsx` のプレースホルダーを自分のページ部品に差し替えるだけ。
- **時刻**：現在時刻と学習日の計算は必ず `server/adapters/clock.ts` を通す。

## 完了の定義（段階 6 で確認する項目）

- `bun install && bun test && bun run build && bun start` が通る。
- ブラウザで：録音 → 文字起こし → 記録が作られる → 翌日相当の復習キューに出る → 3 段階で評価できる → 次回期限が更新される、が通しで動く（日付は `MNEMORIZE_FAKE_NOW` のような検証用の時刻上書きで確認する）。
- Markdown 書き出しが人の目で読める形になっている。
- UI に英語の文言が残っていない。

## 段階 2〜5 の実装で決まったこと（設計書からの差分）

- 専門用語リストの設定キーは `asr_prompt_terms` ではなく、土台が先に用意していた `glossary` を使う（同義のキーを 2 つ作らないため）。
- 音声ファイルの保存は添付担当の `files.ts` ではなく、録音担当が `server/adapters/audio-files.ts` として独立させた（並列作業の衝突回避）。画像は `files.ts`。
- マイグレーションは `0001_init.sql` と `0003_transcription.sql`（transcription_jobs に `warnings_json`、`day_date`）の 2 本。0002 は欠番（復習担当が不要と判断）。
- 自動卒業（要件 S6）は復習担当が実装済み。設定 `auto_retire`（既定 true）で、評価で決まった間隔が 365 日以上なら `retired_at` を立てる。
- 「復習」画面のその場の追記は本文末尾に足す（履歴はリセットしない）。`review_logs.note_md` は未使用。
- 検証用の時刻上書き：環境変数 `MNEMORIZE_FAKE_NOW`（ISO 文字列）。`server/adapters/clock.ts` の `now()` を通る箇所すべてに効く。

## 人の手で確認が必要なこと

- **マイクでの実録音**：自動操作ではマイク権限ダイアログを扱えないため、誰も実際の声で「録音 → 文字起こし → 記録」を通していない。手順：`bun dev` → http://localhost:5173 →「録音する」→ 権限を許可 → 30 秒ほど話す →「停止して文字起こし」→ 文字起こし中カードが記録に変わる。無音トリムのしきい値（`web/src/audio/recorder.ts` 先頭の定数）はこのとき調整する。
- Safari での表示と録音（未確認のまま）。

## 2026-09-15 時点の残課題（コードレビュー 04 で指摘され、未修正のもの。いずれも軽微）

- 「予定を最初からやり直す」の直後に「直前の評価を取り消す」を押すと、リセット前の評価ログだけが消える（予定は変わらない）。取り消しはリセット後の評価に限定するのが妥当。
- 添付削除は「ファイル削除 → 行削除」の順のため、ファイル削除後に行削除が失敗すると行だけ残る。順序を逆にするか、行削除後にファイルを消す。
- 文字起こし失敗時のエラー文に whisper-cli の標準エラー出力の末尾がそのまま入り、画面にも出る。利用者向けの短い文に置き換え、詳細はジョブの `error` に残す。

## 作業中に起きた事故と再発防止

- 実装・修正担当のサブエージェントが 2 回、`MNEMORIZE_DATA_DIR` を指定せずにサーバーやスクリプトを実行し、本番のデータ置き場（`~/Library/Application Support/mnemorize/`）に空の DB やテスト記録 3 件を作った。どちらも司令塔が中身を確認（利用者の記録は 0 件）したうえで削除済み。以後、サブエージェントへの依頼文には「`MNEMORIZE_DATA_DIR` を付けずに起動しない」を明記する。

## 改名（2026-09-15）

正式名称が mnemorize に決まり、内部の符号 `srw` をすべて `mnemorize` に改名した（package 名、画面タイトル、データ置き場 `~/Library/Application Support/mnemorize/`、DB ファイル `mnemorize.sqlite`、環境変数 `MNEMORIZE_DATA_DIR` / `MNEMORIZE_FAKE_NOW` / `MNEMORIZE_RUN_WHISPER` / `MNEMORIZE_SERVE_STATIC` / `MNEMORIZE_PORT`、書き出し・スナップショットのファイル名接頭辞）。改名時点で実データは存在しなかったため移行処理は無い。リポジトリは https://github.com/gridhra/mnemorize 。
