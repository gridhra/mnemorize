# 調査ノート 02：ローカル日本語音声認識（Apple Silicon）

- 調査日：2026-09-15
- 作成：Claude Code のサブエージェント（Sonnet）による Web 調査を、司令塔（Fable）が保存。司令塔による訂正は【訂正】と明記。
- 対象環境：macOS 26、Apple M4、32GB。Python 3.10（uv）、Node 22、Bun 1.2、Rust 1.92、Homebrew。ffmpeg・Whisper 系は未導入。
- 用途：日本語（英語の専門用語混じり）の 30 秒〜3 分の独り言を文字起こしして記録する。クラウド API は使わない。

【訂正】司令塔がローカルで `brew info` を実行して確認した事実：Homebrew の正式名は `whisper.cpp`（旧名 `whisper-cpp` も通る）、安定版 1.9.4、macOS 26 arm64 のビルド済みバイナリあり。また原文の「Rust 実装（C/C++）」は誤りで、whisper.cpp は C/C++ 実装。

## 結論（推奨）

推奨構成：whisper.cpp（Core ML 有効ビルド）+ large-v3-turbo モデル + Homebrew 導入 + CLI をサブプロセスから呼ぶ。将来配布時は同梱バイナリ化。

- 理由：日本語精度と速度のバランスが良く（後述ベンチマークで上位）、Homebrew 一発で入り、Metal（Apple の GPU 汎用計算 API）と Core ML（Apple の機械学習実行形式。Neural Engine という専用チップを使える）の両方に対応済みで、CLI も HTTP サーバーも同じ配布物に入っている。C/C++ 実装なので Python 環境非依存で配布物に同梱しやすい。
- 代替案：mlx-whisper（large-v3-turbo）+ Python ライブラリとして同一プロセス呼び出し。Apple 純正の MLX（Apple Silicon 専用の配列演算フレームワーク）を使うため M4 との相性が良く、`pip install mlx-whisper` のみで動く。ただし配布時は Python ランタイム同梱が必要になり、Node/Rust から呼ぶ場合はサブプロセス経由になる。

## 1. 実行系の比較

### whisper.cpp（C/C++、MIT）
- 事実：Apple Silicon では Metal がデフォルトで有効。Core ML を有効にすると Whisper のエンコーダ部分が Neural Engine 上で動き、small/base/medium モデルでスループットがおおよそ 2〜3 倍になる（[Whisper.cpp Setup Guide 2026](https://weesperneonflow.ai/en/blog/2026-06-23-whisper-cpp-setup-guide-local-speech-recognition-2026/)）。
- 事実：`whisper-server` コマンドで OpenAI API 互換のローカル HTTP サーバーを起動できる（[glama.ai voicemode docs](https://glama.ai/mcp/servers/@mbailey/voicemode/blob/748057b353762fab0e43ae63da7ae6e0c86ed512/docs/.archive/whisper.cpp.md)）。
- Python からはサブプロセス経由（`pywhispercpp` 等のバインディングもあるが未確認）。Node からも同様。Rust からは `whisper-rs` で直接組み込み可能。

### mlx-whisper（Apple MLX 版）
- 事実：MLX は Apple 公式（GitHub: apple/mlx）。
- 未確認：mlx-whisper 単体の M4 での実時間比。関連調査では、OpenAI Whisper（Metal 経由）は M3/M4 で large-v3 がおよそ 2〜3 倍速（実時間比）、small/base/tiny は 10 倍速超という報告がある（[Whisper benchmark on Apple Silicon](https://justvoice.ai/blog/whisper-benchmark-apple-silicon-m3-m4)、[Apple Silicon Whisper Metal Benchmark](https://www.promptquorum.com/local-llms/apple-silicon-whisper-metal-benchmark)）。
- Node/Rust から使う場合はサブプロセス起動が必要。

### faster-whisper（CTranslate2）
- 事実：CTranslate2 の Metal バックエンドは fork 版（eaglstun/CTranslate2）による実装で、SYSTRAN 公式の faster-whisper に標準搭載されているかは別問題（[faster-whisper Issue #515](https://github.com/SYSTRAN/faster-whisper/issues/515)、[eaglstun/CTranslate2](https://github.com/eaglstun/CTranslate2)）。
- 事実：Apple Silicon 上では whisper.cpp の Metal 実装の方が高速とされ、faster-whisper の Metal 対応は「実験的」という評価（[Whisper.cpp vs faster-whisper 2026](https://www.promptquorum.com/power-local-llm/local-whisper-stt-comparison-2026)）。

### WhisperKit（Swift, Argmax）
- 事実：Core ML と Neural Engine を使う Swift パッケージ。2026 年 5 月に v1.0.0 となり argmax-oss-swift に統合（[WhisperKit](https://www.argmaxinc.com/blog/whisperkit)、[argmax-oss-swift](https://github.com/argmaxinc/argmax-oss-swift)）。
- Swift 製のため完全ネイティブ Swift アプリに最適。Python/Node/Rust から直接呼ぶ手段は薄い（未確認）。

### 日本語特化・新興モデル（2026 年ベンチマーク）
2026 年 2 月公開の日本語 ASR ベンチマーク（RTX 5090 上、9 モデル、自然な会話音声 20 クリップ・計 580 秒。[Neosophie Best Japanese ASR Models 2026](https://neosophie.com/en/blog/20260226-japanese-asr-benchmark)）：

| モデル | WER | CER | RTF（実行時間/音声長） | 備考 |
|---|---|---|---|---|
| Qwen3-ASR-1.7B | 0.185 | 0.140 | 0.036 | 最高精度、安定性も高い |
| Whisper-large-v3-turbo | 0.218 | 0.184 | 0.013 | 雑音・複数話者に強いが時々ハルシネーションあり |
| Voxtral-Mini-4B | 0.239 | 0.212 | 0.209 | まれに非日本語出力あり |
| Granite-4.1-2B | 0.281 | 0.262 | 0.051 | 雑音で破綻 |
| Cohere-Transcribe-03 | 0.327 | 0.297 | 0.063 | 中位 |
| Parakeet-TDT-0.6B | 0.344 | 0.321 | 0.003 | 最速だが精度は劣る |
| ReazonSpeech-NeMo-V2 | 0.348 | 0.329 | 0.020 | 日本語ドメイン適応、フィラーを積極除去 |
| Granite-4.0-1B | 0.378 | 0.337 | 0.046 | 反復ループあり |
| ReazonSpeech-K2-V2 | 0.461 | 0.445 | 0.027 | 漢数字表記 |
| Kotoba-Whisper-V2.0 | 0.534 | 0.495 | 0.008 | 自然な会話に弱い |

- 注：RTF は RTX 5090（CUDA）上の計測。M4 上での数値ではない。
- 事実：Qwen3-ASR は Apache 2.0、日本語対応あり、0.6B/1.7B（[HuggingFace](https://huggingface.co/Qwen/Qwen3-ASR-1.7B)、[GitHub](https://github.com/QwenLM/Qwen3-ASR)）。M4 上での MLX 等の動作報告は未確認。
- 事実：NVIDIA Parakeet-TDT-0.6b-v3 / Canary-1B-v2 は欧州言語中心で日本語は対象外（[NVIDIA FAQ](https://perspectives.nvidia.com/nemotron-speech/task/faq/what-are-the-most-production-ready-open-speech-recognition-models-for-european-l/)）。
- 事実：Kyutai STT は英語・フランス語のみ（[Kyutai STT](https://kyutai.org/stt/)）。
- 未確認：Moonshine の日本語対応。
- 全体（事実+推論）：2026 年時点で日本語の総合精度は Whisper-large-v3-turbo と Qwen3-ASR-1.7B が上位。ただしこのベンチマークは 1 本のみでサンプルも少なく、専門用語混じりの独り言での再現性は未確認。

## 2. 統合方式の比較

| 方式 | 個人利用の手軽さ | 将来配布のしやすさ |
|---|---|---|
| (a) CLI をサブプロセスで叩く | 高い。言語非依存で最も手早い | 高い。バイナリを同梱すれば良い |
| (b) ローカル HTTP サーバー | 中。プロセス管理・ポート管理が要る | 中。マルチクライアント対応がしやすい |
| (c) Python ライブラリとして同一プロセス | 高い（Python 内で完結） | 低〜中。Python 環境同梱が必要 |
| (d) Rust クレート（whisper-rs）で組み込み | 中（Rust 実装が必要） | 高い。単一バイナリに組み込める |

- 事実：`whisper-rs` は whisper.cpp への Rust バインディングで、月間ダウンロード約 11 万（[crates.io](https://crates.io/crates/whisper-rs)）。
- 推奨（推論）：まず (a) で作り、配布フェーズで (d) に移行する段階的アプローチ。

## 3. 録音の取り方

- 事実：ブラウザの `MediaRecorder` は既定で WebM/Opus を出力し、サンプルレートを制御できない（[Recording Spec-Compliant WAV Files](https://dev.to/orca_forge/recording-spec-compliant-wav-files-16-bitmonouncompressed-using-only-web-audio-40n8)）。
- 事実：whisper.cpp は 16bit・16kHz WAV を要求するため、WebM/Opus を渡すには変換が要る。
- ffmpeg を避ける方法（事実）：Web Audio API の `AudioWorkletNode`（または旧 `ScriptProcessorNode`）で Float32 の PCM を直接取得し、自前で 16bit PCM WAV に組み立てる（同上、[Getting monochannel 16-bit PCM from mic](https://medium.com/@ragymorkos/gettineg-monochannel-16-bit-signed-integer-pcm-audio-samples-from-the-microphone-in-the-browser-8d4abf81164d)）。
- ネイティブ（Tauri）の場合（事実）：`tauri-plugin-audio-recorder` 等は `cpal`（Rust の音声入出力ライブラリ）と `hound`（Rust の WAV 読み書きライブラリ）で 16kHz モノラル WAV を直接書き出せる（[crates.io](https://crates.io/crates/tauri-plugin-audio-recorder)）。
- 結論（推論）：ブラウザでもネイティブでも ffmpeg なしで 16kHz モノラル WAV を得る経路がある。

## 4. 日本語文字起こしでよくある問題と対策

- 句読点が付かない：後処理モデルを挟む、または `initial_prompt` で句読点付きの文を与える（推論を含む一般的回避策）。
- ハルシネーション（存在しない発話の生成）：VAD（Voice Activity Detection、音声区間検出）で無音を事前に除去すると大きく減る（[Reducing hallucinations via VAD](https://theneuralbase.com/faster-whisper/learn/intermediate/reducing-hallucinations-via-vad/)）。
- 無音での繰り返し：VAD に加え、デコード時の反復抑制パラメータ調整。
- 専門用語の誤変換：`initial_prompt`（先頭に与える文脈）で改善できるが、長いプロンプトはそれ自体がハルシネーションの原因になり得る。用語リストは短く具体的に。
- 対策まとめ（推論）：(1) 録音前後の無音を VAD でトリミング、(2) initial_prompt は固有名詞・専門用語の短いリスト、(3) 句読点は後処理、(4) 繰り返し検出時は再デコードまたは破棄。

## 5. 推奨構成の利点・欠点

推奨：whisper.cpp（Core ML）+ large-v3-turbo + Homebrew + CLI サブプロセス
- 利点：Homebrew で即導入。M4 で Neural Engine を使える。日本語 WER 0.218 で上位。Python/Node/Rust いずれからも呼びやすい。将来 Tauri 化時は whisper-rs で同じ whisper.cpp を組み込める。
- 欠点：Qwen3-ASR-1.7B より精度が若干低い可能性。ハルシネーション傾向があり VAD 前処理が要る。Core ML モデル変換に初回の手間。

代替：mlx-whisper（large-v3-turbo）+ Python 同一プロセス
- 利点：`pip install` のみで最速プロトタイピング。
- 欠点：Node/Rust から直接呼べない。配布時に Python ランタイム同梱が必要。

提案（推論）：個人利用段階で Qwen3-ASR-1.7B を MLX または PyTorch で動かして精度を実測比較し、必要ならモデルだけ差し替える。

## 未確認事項一覧
- mlx-whisper の M4 での実時間比データ
- Qwen3-ASR の M4 上での動作報告・速度
- WhisperKit を Python/Node/Rust から呼ぶ手段
- Moonshine の日本語対応可否
- ReazonSpeech 各バリアントのライセンス
- 句読点付与後処理モデルの日本語精度
- 上記ベンチマークの再現性（20 クリップは小規模）
