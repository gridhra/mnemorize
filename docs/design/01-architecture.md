# 設計 01：全体構成（v1.0）

- 作成日：2026-09-15
- 状態：技術検証 3 件（`docs/research/05-spike-recorder.md`、`05-spike-fsrs.md`、`06-spike-whisper.md`）の結果を反映済み。実装の基準文書。
- 前提となる要件：`docs/requirements/01-needs-and-requirements-draft.md`（v0.2、判断 10 件確定済み、日本語メイン要件 §3.7 を含む）。

## 1. 一言でいうと

Bun 上で動く 1 プロセスのローカル Web サーバー（Hono）が、SQLite と添付ファイルを管理し、ブラウザの単一ページアプリ（Preact）に JSON API を提供する。音声認識は whisper.cpp のコマンドをサブプロセスとして呼ぶ。スケジューリングは ts-fsrs。すべてローカルで完結し、ネットワークは使わない。

## 2. 技術選定（確定分）

| 層 | 選定 | 理由 |
|---|---|---|
| 実行系 | Bun 1.2 | 導入済み。SQLite（`bun:sqlite`）内蔵。TypeScript をそのまま実行できる。 |
| HTTP | Hono | 軽量。静的配信・SSE（サーバー送信イベント）・multipart に対応。 |
| フロント | Preact + TypeScript + Vite | React と同じ書き方で小さい。IME 対応の入力制御を素直に書ける。Svelte 5 は構文が新しく実装者（サブエージェント）の誤りが増えるため避ける。 |
| DB | SQLite（WAL モード）+ 自前マイグレーション（連番 SQL ファイル） | 単一ファイル。ORM は入れない（クエリが少なく、可搬性を優先）。 |
| 全文検索 | SQLite FTS5 trigram | 日本語に単語境界がないため trigram。司令塔が確認済み：Bun 1.2 同梱の SQLite 3.51.0 で FTS5 trigram が動く（2026-09-15）。 |
| 音声認識 | whisper.cpp 1.9.4（Homebrew）の `whisper-cli`、モデル ggml-large-v3-turbo（q5_0 量子化版でも可） | 決定済み。呼び出しは薄い層に閉じ込める（要件 N4）。検証済み（`06-spike-whisper.md`）：Homebrew 版は Core ML 非対応だが Metal だけで実時間の 12〜14 倍速。**`-nt`（タイムスタンプ省略）は絶対に付けない**（デコードが変わり文が丸ごと落ちる。実測で文字誤り率 49.6% → 外すと 8.8%）。`-l ja` 必須（自動判定は英語に誤判定）。 |
| スケジューリング | ts-fsrs 5.4.2（FSRS-6） | 決定済み。検証済み（`docs/research/05-spike-fsrs.md`）：決めた設定はすべてそのまま実現でき、履歴からの再構築は「評価」と「復習時刻」の 2 列だけで完全一致する。 |
| 録音 | ブラウザ Web Audio API（AudioWorklet）で 16kHz モノラル WAV を生成 | ffmpeg 不要。Chrome 152 実機で検証済み（`docs/research/05-spike-recorder.md`）。Safari は未確認。 |

## 3. ディレクトリ構成（案）

```
spaced-repetition-with-whisper/
  package.json            # ワークスペースのルート（bun）
  server/
    index.ts              # 起動。ポート、データディレクトリの解決
    app.ts                # Hono アプリの組み立て
    routes/               # HTTP ルート（薄く。ロジックは services へ）
    services/
      entries.ts          # 記録の作成・更新・履歴
      reviews.ts          # 復習キューの取り出し、評価の記録
      scheduler.ts        # ts-fsrs の薄いラッパー（要件 S1〜S7）
      transcribe.ts       # 文字起こしジョブの管理（キュー、進捗、失敗保持）
      exporter.ts         # Markdown / JSON 書き出し
      search.ts
    adapters/             # 外界との境界。Tauri 化のときにここだけ差し替える（要件 N4）
      asr-whisper-cli.ts  # whisper-cli をサブプロセスで呼ぶ
      files.ts            # 添付・音声ファイルの読み書き
      clock.ts            # 現在時刻と「一日の境界（午前 4 時）」の計算
    db/
      connection.ts
      migrations/0001_init.sql ...
      queries/            # SQL をまとめる
  web/
    index.html
    src/
      main.tsx
      api.ts              # fetch のラッパー
      pages/ Today.tsx Review.tsx Settings.tsx Search.tsx
      components/ Recorder.tsx EntryEditor.tsx EntryCard.tsx ReviewCard.tsx Attachments.tsx
      audio/ recorder-worklet.js wav-encoder.ts
      i18n/ ja.ts         # 文言はすべてここに集約（要件 J1）
  docs/                   # 要件・調査・設計
  spikes/                 # 技術検証（本体からは参照しない）
```

## 4. データの置き場

- 既定のデータディレクトリ：`~/Library/Application Support/mnemorize/`（正式名称 mnemorize。環境変数 `MNEMORIZE_DATA_DIR` で変更可）。
  - `mnemorize.sqlite`（正本）
  - `attachments/YYYY/MM/<uuid>.<ext>`（画像）
  - `audio/YYYY/MM/<uuid>.wav`（録音。要件 D8 で保存すると決定）
  - `snapshots/mnemorize-YYYYMMDD.sqlite`（日次スナップショット。要件 P3）
  - `export/`（Markdown / JSON 書き出し先の既定）
- 設定は DB の `settings` テーブル（キー・値）。モデルのパス、専門用語リスト、1 日の上限、境界時刻など。

## 5. データモデル

`docs/research/03-tech-stack.md` の素案をもとに、確定した判断を反映して調整した。

```mermaid
erDiagram
    ENTRY ||--o{ ENTRY_REVISION : "加筆修正の全文履歴"
    ENTRY ||--o{ ATTACHMENT : "画像・音声"
    ENTRY ||--o| SCHEDULE_STATE : "現在の予定(履歴から再計算できる導出値)"
    ENTRY ||--o{ REVIEW_LOG : "復習履歴(追記専用)"
    ENTRY ||--o{ TRANSCRIPTION_JOB : "文字起こしジョブ"

    ENTRY {
        text id PK "uuid v7(時系列順)"
        text day_date "ローカル日付 YYYY-MM-DD(午前4時境界で決める)"
        text title "任意。空なら本文先頭1文を手がかりに使う"
        text body_md "編集後の本文(Markdown)"
        integer review_enabled "1=復習対象(既定)"
        text retired_at "卒業した時刻。NULL=現役"
        text created_at
        text updated_at
        integer sort_order "同日内の並び"
        text schedule_reset_at "最後に明示リセットした時刻。再構築はこれ以降のログだけ使う"
    }
    ENTRY_REVISION {
        text id PK
        text entry_id FK
        integer rev_no
        text title
        text body_md
        text created_at
    }
    ATTACHMENT {
        text id PK
        text entry_id FK
        text kind "image | audio"
        text rel_path "attachments/2026/09/xxx.png など"
        text mime
        integer bytes
        text sha256
        real duration_sec "audio のみ"
        text created_at
    }
    TRANSCRIPTION_JOB {
        text id PK
        text entry_id FK "NULL可: 記録作成前に走らせる場合"
        text audio_attachment_id FK
        text status "queued | running | done | failed"
        text raw_text "ASR 出力そのまま(要件 C3)"
        text segments_json "タイムスタンプ付きセグメント"
        text model "使ったモデル名"
        text prompt "使った初期プロンプト"
        text error
        text created_at
        text finished_at
    }
    REVIEW_LOG {
        text id PK
        text entry_id FK
        text reviewed_at "実際の時刻"
        text fsrs_instant "ts-fsrs に渡した正規化時刻(学習日の12:00)"
        integer rating "1=Again 3=Good 4=Easy(ts-fsrs の値をそのまま)"
        text state_before
        real stability_before
        real difficulty_before
        real elapsed_days
        real scheduled_days
        text due_before
        text algo "fsrs-6 / ts-fsrs バージョン"
        text kind "review | reset | retire | unretire"
        text note_md "将来の復習メモ用(要件 R7)。当面 NULL"
    }
    SCHEDULE_STATE {
        text entry_id PK
        text due "次回期限(日時)"
        text state "New | Learning | Review | Relearning"
        real stability
        real difficulty
        real elapsed_days
        real scheduled_days
        integer reps
        integer lapses
        text last_review
        text algo
    }
```

REVIEW_LOG の列は検証（`05-spike-fsrs.md`）で確定した：再構築に必須なのは `rating` と `reviewed_at` の 2 列。`*_before` 列は表示・診断用の冗長列。`elapsed_days` は ts-fsrs 6.0 で削除予定の項目なので保存の前提にしない（列は残してよいが再構築には使わない）。

スケジューラ実装で守る規約（検証で判明した落とし穴への対策）：
- **復習時刻の正規化**：ts-fsrs は経過日数を UTC の暦日で数えるため、日本時間では日付の境目が 09:00 になり「昨夜 22:00 → 今朝 07:00」が経過 0 日と扱われて間隔が縮む（実測：9 日のはずが 3 日）。対策として、ts-fsrs に渡す復習時刻は「その学習日（午前 4 時境界で決めた日付）の 12:00 ローカル」に正規化する。REVIEW_LOG には実時刻 `reviewed_at` と正規化後 `fsrs_instant` の両方を保存する。
- **初回期限**：新規状態では ts-fsrs は `due` を読まないので、作成時に `due` を「翌日の 4:00」に自分で書いてよい。
- **fuzz の seed**：既定 seed（復習時刻＋回数＋記憶状態から決まる決定的な値）を使う。`GenSeedStrategyWithCardId` は再構築時に期限がずれるので使わない。
- **リセット**：`forget(card, now, true)` の結果は新規作成と同一。リセットは FSRS のログ列に混ぜず、ENTRY に `schedule_reset_at` を持ち、再構築ではそれ以降の `kind=review` 行だけを使う。
- **上限 365 日は不変条件ではない**：実装が評価順を強制するため 366〜367 日になることがある。「期限は必ず 365 日以内」を前提にしたコードを書かない。
- **「余裕だった」は強く効く**：3 回で上限間隔に達する。ボタンの説明文で「次は数か月〜1 年先になります」と伝える。
- **負荷の見込み**：毎日 2 件作成・全部「思い出せた」の 90 日シミュレーションで 1 日平均 5.9 件、10 件超は 90 日中 3 日のみ。上限 10 件はほぼ発動しない安全弁。

設計上の決め：
- 記録の作成時に SCHEDULE_STATE を作り、`due` は「作成日の翌日の境界時刻」にする（要件 S5）。
- 復習は「REVIEW_LOG に 1 行追記 → SCHEDULE_STATE を更新」を 1 トランザクションで行う。
- 明示リセット（要件 S4）は ENTRY の `schedule_reset_at` を更新し、REVIEW_LOG に `kind=reset` を記録（監査用。再構築では無視）し、SCHEDULE_STATE を新規状態＋翌日期限に戻す。過去の行は消さない。
- 卒業（要件 R6）は `retired_at` を立て、`kind=retire` を追記。キューから外れるが日付ビューには残る。
- 全文検索用に FTS5 仮想テーブル `entry_fts(title, body_md, raw_text)` をトリガーで同期する。

## 6. HTTP API（案）

すべて `/api` 配下、JSON。日付は `YYYY-MM-DD`、時刻は ISO 8601（ローカルタイムゾーンのオフセット付き）。

| メソッドとパス | 役割 |
|---|---|
| `GET /api/days/:date` | その日の記録一覧（添付・予定含む） |
| `GET /api/days?from=&to=` | 期間内の日ごとの件数（カレンダー表示用） |
| `POST /api/entries` | 記録作成 `{day_date, title?, body_md, review_enabled?}` |
| `PATCH /api/entries/:id` | 更新 `{title?, body_md?, review_enabled?, reset_schedule?: boolean}`。更新前の全文を ENTRY_REVISION に積む |
| `GET /api/entries/:id/revisions` | 履歴一覧 |
| `POST /api/entries/:id/retire` / `unretire` | 卒業 / 取り消し |
| `POST /api/entries/:id/attachments` | 画像追加（multipart） |
| `DELETE /api/attachments/:id` | 添付削除 |
| `GET /files/*` | 添付・音声の配信（データディレクトリ配下のみ） |
| `POST /api/transcriptions` | WAV を受け取りジョブ作成。`{entry_id?}` を付けられる。即座に `{job_id}` を返す |
| `GET /api/transcriptions/:id` | 状態と本文 |
| `GET /api/transcriptions/:id/events` | SSE で進捗と部分結果を配信（要件 C2） |
| `POST /api/transcriptions/:id/retry` | 保存済み WAV で再実行（要件 C4） |
| `GET /api/reviews/today` | 今日の復習キュー（上限適用後）と、上限で繰り越した件数 |
| `POST /api/reviews` | 評価を記録 `{entry_id, rating: 1|3|4}` → 次回期限を返す |
| `GET /api/search?q=` | 全文検索 |
| `GET /api/export/markdown` / `json` | 書き出し（zip または指定ディレクトリへの書き込み） |
| `GET/PUT /api/settings` | 設定 |
| `GET /api/health` | whisper-cli とモデルの有無、DB のパスを返す（初回セットアップの案内に使う） |

## 7. 画面（案）

文言はすべて日本語（要件 J1）。画面は 4 つ。

1. **今日**（既定画面）
   - 上部：日付（「9月15日（月）」）と前後の日への移動、今日に戻る。復習の残り件数バッジ。
   - 中央：その日の記録一覧（カード）。各カードにタイトル（無ければ先頭 1 文）、本文、画像サムネイル、次回予定日。クリックで編集。
   - 下部：新規作成。大きな「録音」ボタン（押して開始・もう一度で停止）、テキストで書くリンク、画像のドロップ領域。
   - 録音停止直後に「文字起こし中…」のカードが一覧に現れ、部分結果が流れ込み、完了で編集可能になる（要件 C2）。失敗時はカード内に「再試行」。
2. **復習**
   - 上部：「今日の復習 3 / 8 件」、繰り越し件数。
   - カード：手がかり（タイトルまたは先頭 1 文、作成日、添付枚数）。中央に「思い出したら開く」ボタン。
   - 開いた後：本文全文と画像。その場で追記できる小さな編集欄（要件 R5）。
   - 下部に 3 ボタン：「思い出せなかった」「思い出せた」「余裕だった」。各ボタンの下に判定基準を 1 行（要件 R3）と次回予定日の予告。
   - メニューに「卒業させる」。
3. **検索**：入力欄と結果一覧（日付、タイトル、一致箇所）。あると良い要件なので後回し可。
4. **設定**：モデルのパスと状態、専門用語リスト（1 行 1 語）、1 日の上限、一日の境界時刻、データディレクトリの場所（表示のみ）、書き出しボタン、スナップショット作成ボタン。

IME への配慮（要件 J5）：テキスト入力では `compositionstart`/`compositionend` を監視し、変換中は Enter や Cmd+Enter の保存ショートカットを無視する。

## 8. 文字起こしの流れ

録音の実装上の注意（検証 `05-spike-recorder.md` からの引き継ぎ）：AudioContext は `sampleRate: 16000` 指定で作り、実際の値が違えば線形補間でリサンプリングする。AudioWorkletNode は出力先（destination）に繋がっていないと処理関数が呼ばれないので、ゲイン 0 の GainNode を経由して繋ぐ。Worklet からメインスレッドへ渡す Float32Array は毎回コピーする。AudioContext の生成と resume はクリック処理の中で行う。停止時はトラック停止・ノード切断・AudioContext.close() を確実に行う（マイク使用中の表示が消えない不具合を防ぐ）。検証コードは `spikes/recorder/` にあり、本番の `web/src/audio/` はこれを土台にする。

1. ブラウザ：録音停止 → 16kHz モノラル 16bit WAV を生成 → `POST /api/transcriptions`。
2. サーバー：WAV を `audio/YYYY/MM/<uuid>.wav` に保存し ATTACHMENT と TRANSCRIPTION_JOB（queued）を作成。ジョブキューは 1 並列（M4 でも同時実行すると遅くなるため）。
3. アダプタ `asr-whisper-cli.ts`：次のコマンドをサブプロセス起動する。
   ```
   whisper-cli -m <モデルパス> -l ja -fa --prompt "<日本語プロンプト＋用語>" -oj -of <出力パス(拡張子なし)> <wav>
   ```
   - `-nt` は付けない（上記）。`-fa`（flash attention）は速度改善が確認済み。スレッド数は既定のまま。
   - 標準出力にはセグメントごとに `[00:00:00.000 --> 00:00:05.120]  本文` の形で行が出るので、行単位で読んで部分結果を SSE へ流す。
   - 完了後、`-oj` が書いた `<出力パス>.json` の `transcription[].text` と `timestamps`/`offsets` を読み、テキストを結合して raw_text に、配列を segments_json に入れる。
   - `whisper-server` は使わない（常駐プロセスとポートの管理が増える割に、モデル読み込みの節約は数秒で、部分結果が取れない）。将来 Tauri 化するときは whisper-rs に置き換えるが、`-nt` 相当の `no_timestamps` を true にしない点は同じ。
4. 完了：raw_text と segments を保存。無音では「ご視聴ありがとうございました」や英語の "you" が出ることを実測しており（`--no-speech-thold` を上げても抑制されない）、定型句リスト（設定で編集可。初期値：「ご視聴ありがとうございました」「チャンネル登録」「you」「Thank you.」）に一致するセグメントは除去し、ジョブに警告フラグを立てる（要件 J4）。先頭・末尾の無音はブラウザ側で RMS（音量の実効値）しきい値により切り落としてから送る。
   初期プロンプトの効果は「英語の専門用語をラテン文字で出す」方向には効いたが句読点には効かなかった。プロンプトは設定の用語リストを主体にし、長い例文にはしない（長いプロンプトはハルシネーションの原因になる）。
5. 記録がまだ無ければ ENTRY を作成して body_md に raw_text を入れる。既存記録に付けた場合は末尾に追記。

## 9. 復習キューの取り出し

- 「今日」の窓：境界時刻 4:00 を使い、`now` が 4:00 より前なら前日扱い。窓は `[今日 4:00, 翌日 4:00)`。
- 対象：`review_enabled=1 AND retired_at IS NULL AND due < 窓の終わり`。
- 並び：`due` の古い順（＝期限超過が長い順）。上限 N 件（既定 10）で切り、残りは繰り越し件数として返す。
- 評価後：ts-fsrs で次回を計算し、REVIEW_LOG 追記と SCHEDULE_STATE 更新。

## 10. 書き出し

- Markdown：`export/YYYY/YYYY-MM-DD.md`。1 日 1 ファイル。各記録は `## タイトル` の節、frontmatter に日付。記録ごとの予定と履歴の要約は節末に HTML コメントか YAML ブロックで添える。画像は相対パスでリンク（`export/attachments/` にコピー）。
- JSON：全テーブルをそのまま 1 ファイルに。将来の取り込み（要件 P4）の正本形式。

## 11. 実装の段階分け（案）

| 段階 | 内容 | 完了の目安 |
|---|---|---|
| 0 | リポジトリ骨格、Bun ワークスペース、DB マイグレーション、`/api/health` | `bun dev` で空の「今日」画面が出る |
| 1 | 記録の手入力 CRUD、日付移動、加筆履歴 | テキストだけで毎日使える |
| 2 | 録音 → 文字起こし → 記録化（SSE 進捗、再試行） | 音声で記録できる |
| 3 | 画像添付 | |
| 4 | スケジューラと復習画面、卒業、リセット | 毎日の復習が回る（ここで実利用開始） |
| 5 | 書き出し、スナップショット、設定画面 | データが外に出せる |
| 6 | 検索、細部の磨き込み | |

段階 1 と 4 を先に通すと、音声なしでも運用が始められる。段階 2 は検証結果次第で並行して進める。

## 12. 未決・検証待ちの一覧

- 実際の人の声での精度（検証は合成音声のみ。実利用開始後に体感で判断し、不満なら q8_0 や Qwen3-ASR を試す）。
- 3 分程度の長い音声での挙動（検証は 70 秒まで）。
- AudioWorklet 録音の Safari 実機確認（Chrome は確認済み。リサンプリング経路は保険として残す）。
