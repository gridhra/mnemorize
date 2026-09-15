# 設計02：実装計画と進行状況

- 作成日：2026-09-15
- 目的：実装を複数のサブエージェントに分担させるための、段階・担当範囲（ファイルの所有権）・状態の一覧。別セッションのClaude Codeや、途中から参加する担当者が「いま何がどこまでできていて、次に何をするか」を把握するために読む。
- 基準文書：`docs/design/01-architecture.md`（構成・データモデル・API・画面）。

## 進め方の原則

1. **土台を先に1本で作る**（段階0〜1）。依存関係ファイル（package.json、マイグレーション、ルート登録）への同時書き込みを避けるため。
2. **その後に3本を並列**（段階2〜5を機能単位で分割）。各担当は自分の所有ファイルだけを編集し、共有ファイル（`server/app.ts` のルート登録、`web/src/main.tsx` のタブ登録、`i18n/ja.ts`）には**追記のみ**行う。
3. 各担当は自分の範囲の `bun test` を書き、`bun test` 全体が通る状態で終える。
4. 最後に司令塔（Fable）が結合確認と、ブラウザでの通し確認を行う。

## 段階と担当

| 段階 | 内容 | 担当モデル | 所有するファイル | 状態 |
|---|---|---|---|---|
| 0〜1 | 骨格、DBとマイグレーション、記録の手入力CRUD、日付移動、履歴、検索、「今日」画面、IME対応、CLAUDE.md | Opus | ルート設定一式、`server/db/*`、`server/routes/{days,entries,settings,search,health}.ts`、`server/services/entries.ts`、`server/adapters/clock.ts`、`web/src/{main.tsx,api.ts,i18n/ja.ts,pages/Today.tsx,pages/Search.tsx,components/Entry*.tsx}` | 完了（2026-09-15。テスト31件、ChromeでIME動作確認済み） |
| 4 | ts-fsrsラッパー、復習キューAPI、評価の記録、リセット、卒業、「復習」画面 | Opus | `server/services/{scheduler,reviews}.ts`、`server/routes/reviews.ts`、`web/src/pages/Review.tsx`、`web/src/components/ReviewCard.tsx` | 完了（2026-09-15） |
| 2 | 録音（AudioWorklet → 16kHz WAV）、文字起こしジョブ、whisper-cliアダプタ、SSE進捗、再試行、定型ハルシネーション句の除去 | Opus | `server/adapters/asr-whisper-cli.ts`、`server/services/transcribe.ts`、`server/routes/transcriptions.ts`、`web/src/audio/*`、`web/src/components/Recorder.tsx` | 完了（2026-09-15） |
| 3・5 | 画像添付、ファイル配信、Markdown/JSON書き出し、スナップショット、「設定」画面 | Sonnet | `server/adapters/files.ts`、`server/services/exporter.ts`、`server/routes/{attachments,files,export}.ts`、`web/src/pages/Settings.tsx`、`web/src/components/Attachments.tsx` | 完了（2026-09-15） |
| 6 | 結合確認、ブラウザ通し確認、コードレビュー、細部の磨き込み | Fable + Sonnet（受け入れ確認）+ Opus（レビュー） | 全体 | 進行中（2026-09-15）。司令塔の結合確認で、テスト全100件通過（1件は実機whisperのためスキップ）、型検査・ビルド通過。修正2件：fuzzの下限を誤っていたテスト期待値、`/api/health` の時刻取得を `clock.now()` に統一。 |
| 6（修正） | コードレビュー（`docs/design/04-code-review-2026-09-15.md`）と受け入れ確認（`docs/design/03-acceptance-check-2026-09-15.md`）で挙がった指摘の修正 | Opus | 全体 | 完了（2026-09-15）。誤動作8件（取り消しで自動卒業が戻らない、画像欠けで書き出しが500、時刻規約違反、文字起こし反映とジョブ完了の非トランザクション、SSEの後始末、設定値の未検証、WAV不正・壊れたURL符号の500、スナップショット名の衝突）、画面6件（復習バッジの件数、取り消しボタン、復習のやり直しチェック、ライトボックスのEscape、段落の空行、失敗した文字起こしの再表示）、整理3件を修正。テスト115件通過（ほかに実機whisperの1件はスキップ）、型検査・ビルド通過。 |
| 7 | 画面の再設計（設計05）。ハッシュルーター・上部の帯・今日画面の分離・カレンダー・日の画面・設定画面の再構成・復習の記録と本文の履歴・文言の全面見直し・視覚規範の適用。2026-09-15完了。担当Opus/Sonnet、確認Fable | 全体（`web/src/*`、`server/routes/reviews.ts`、`server/services/reviews.ts`、`docs/design/05-ui-grand-design.md`） | 完了（2026-09-15） |

## 各担当が守る境界

- **ルート追加**：`server/routes/<名前>.ts` にHonoのサブアプリを作り、`server/app.ts` に1行追加する。他のルートファイルは編集しない。
- **DB変更**：段階0〜1で全テーブルを作ってあるので、追加の列が必要なときだけ新しい連番マイグレーション（`0002_*.sql` 以降）を足す。既存のマイグレーションは編集しない。
- **文言**：`web/src/i18n/ja.ts` に自分の画面の文言をまとめて追記する（キーの接頭辞を画面名にする。例：`review.*`）。
- **タブ登録**：`web/src/main.tsx` のプレースホルダーを自分のページ部品に差し替えるだけ。
- **時刻**：現在時刻と学習日の計算は必ず `server/adapters/clock.ts` を通す。

## 完了の定義（段階6で確認する項目）

- `bun install && bun test && bun run build && bun start` が通る。
- ブラウザで：録音 → 文字起こし → 記録が作られる → 翌日相当の復習キューに出る → 3段階で評価できる → 次回期限が更新される、が通しで動く（日付は `MNEMORIZE_FAKE_NOW` のような検証用の時刻上書きで確認する）。
- Markdown書き出しが人の目で読める形になっている。
- UIに英語の文言が残っていない。

## 段階2〜5の実装で決まったこと（設計書からの差分）

- 専門用語リストの設定キーは `asr_prompt_terms` ではなく、土台が先に用意していた `glossary` を使う（同義のキーを2つ作らないため）。
- 音声ファイルの保存は添付担当の `files.ts` ではなく、録音担当が `server/adapters/audio-files.ts` として独立させた（並列作業の衝突回避）。画像は `files.ts`。
- マイグレーションは `0001_init.sql` と `0003_transcription.sql`（transcription_jobsに `warnings_json`、`day_date`）の2本。0002は欠番（復習担当が不要と判断）。
- 自動卒業（要件S6）は復習担当が実装済み。設定 `auto_retire`（既定true）で、評価で決まった間隔が365日以上なら `retired_at` を立てる。
- 「復習」画面のその場の追記は本文末尾に足す（履歴はリセットしない）。`review_logs.note_md` は未使用。
- 検証用の時刻上書き：環境変数 `MNEMORIZE_FAKE_NOW`（ISO文字列）。`server/adapters/clock.ts` の `now()` を通る箇所すべてに効く。

## 画面の再設計で決まったこと（設計05からの差分。段階7）

- URLはハッシュルーター`web/src/router.ts`（`hashchange`を監視する自前実装。ライブラリ不使用）で持つ。不正なハッシュは`#/today`に正規化する。
- 「今日」の入口に出す未評価の復習件数は、Context `web/src/queue-context.ts`（`useReviewQueueRefresh`）で下位のページ・部品から更新を呼べるようにした。復習を1件評価・記録を1件作成・画面遷移のいずれでも更新する。
- 日付の文字列計算（`addDays`・`toDateString`・月の日付一覧など）は`web/src/dates.ts`に集約した。時刻や境界時刻には触れない（学習日の境界計算は引き続き`server/adapters/clock.ts`）。
- 新設API`GET /api/reviews/upcoming?from=&to=`（`server/services/reviews.ts`の`upcoming()`、`server/routes/reviews.ts`）：指定した学習日の範囲で、日ごとに期限が来る件数と記録の見出しを返す。カレンダーの「これからの復習」と、今日画面の「次の復習は◯月◯日にN件」の両方がこれを使う。
- 新設`POST /api/transcriptions/:id/dismiss`（マイグレーション`0004_transcription_dismissed.sql`）：失敗した文字起こしジョブを一覧から閉じる。**2026-09-15に画面から使わなくなった**（文字起こしの状態はフォームの中の1行になり、「閉じる」操作そのものが無い）。APIと`dismissed_at`列は、既に閉じた記録を持つ手元のDBと食い違わないように残してある。
- 2026-09-15：文字起こしは記録を作らなくなった。結果はフォームの本文欄に流れ込み、`POST /api/entries`・`PATCH /api/entries/:id` の `transcription_job_ids` で音声が記録に結びつく（設計01 §8、設計05 §3.4）。画面の`TranscribingCard.tsx`と`useTranscribingJobs.ts`、サーバーの自動作成・自動追記の経路は削除した。
- 新設`POST /api/export/open`：書き出し・控えの保存先をFinderで開く。データ置き場配下のパスだけを許可する。
- `GET /api/entries/:id`のレスポンスに`retrievability`（今の想起見込み。0〜1）を追加した。既存の`server/services/scheduler.ts`の計算をそのまま使う読み出し専用の追加で、スケジューラのパラメータやDBスキーマは変えていない。
- 設定画面（`web/src/pages/Settings.tsx`）は、サーバーの400エラー応答が持つ`field`（どの設定キーの誤りか。例：`daily_review_limit`）でどの入力欄に赤字を出すか決めている。`server/services/settings.ts`の`SettingsValidationError`が検証時に`field`を持たせ、`server/app.ts`の共通エラーハンドラがそれを`{ error, field }`のJSONにする。`web/src/api.ts`の`ApiError`が例外にも`field`を載せる。ラベル文言（`web/src/i18n/ja.ts`）とは独立しているので、ラベルの文言を変えても表示先は壊れない。

## 人の手で確認が必要なこと

- **マイクでの実録音**：自動操作ではマイク権限ダイアログを扱えないため、誰も実際の声で「録音 → 文字起こし → 記録」を通していない。手順：`mise run dev` → http://localhost:5173 →「録音して記録する」→ 権限を許可 → 30秒ほど話す →「停止して文字起こし」→ 本文欄に文字が流れ込む → 手直しして「記録する」。無音トリムのしきい値（`web/src/audio/recorder.ts` 先頭の定数）はこのとき調整する。
- Safariでの表示と録音（未確認のまま）。

## 2026-09-15時点の残課題（コードレビュー04で指摘され、未修正のもの。いずれも軽微）

- 「予定を最初からやり直す」の直後に「直前の評価を取り消す」を押すと、リセット前の評価ログだけが消える（予定は変わらない）。取り消しはリセット後の評価に限定するのが妥当。
- 添付削除は「ファイル削除 → 行削除」の順のため、ファイル削除後に行削除が失敗すると行だけ残る。順序を逆にするか、行削除後にファイルを消す。
- 文字起こし失敗時のエラー文にwhisper-cliの標準エラー出力の末尾がそのまま入り、画面にも出る。利用者向けの短い文に置き換え、詳細はジョブの `error` に残す。
- 孤児の音声の掃除は未実装：録音したが保存されなかった文字起こしジョブ（`transcription_jobs.entry_id` がNULLのまま）と、そのWAVファイルが残り続ける。個人用なので当面は許容する。

## 作業中に起きた事故と再発防止

- 実装・修正担当のサブエージェントが2回、`MNEMORIZE_DATA_DIR` を指定せずにサーバーやスクリプトを実行し、本番のデータ置き場（`~/Library/Application Support/mnemorize/`）に空のDBやテスト記録3件を作った。どちらも司令塔が中身を確認（利用者の記録は0件）したうえで削除済み。以後、サブエージェントへの依頼文には「`MNEMORIZE_DATA_DIR` を付けずに起動しない」を明記する。

## 改名（2026-09-15）

正式名称がmnemorizeに決まり、内部の符号 `srw` をすべて `mnemorize` に改名した（package名、画面タイトル、データ置き場 `~/Library/Application Support/mnemorize/`、DBファイル `mnemorize.sqlite`、環境変数 `MNEMORIZE_DATA_DIR` / `MNEMORIZE_FAKE_NOW` / `MNEMORIZE_RUN_WHISPER` / `MNEMORIZE_SERVE_STATIC` / `MNEMORIZE_PORT`、書き出し・スナップショットのファイル名接頭辞）。改名時点で実データは存在しなかったため移行処理は無い。リポジトリは https://github.com/gridhra/mnemorize 。

## 画面の再設計で決まったこと（設計05からの差分。段階7）（続き）

- 2026-09-15：既定パスをこのマシンの実パスに固定し、候補探索はフォールバックに位置づけ直した（表示と実態の不一致バグの修正）。
