# 調査ノート02：ローカル日本語音声認識（Apple Silicon）

- 調査日：2026-09-15
- 作成：Claude Codeのサブエージェント（Sonnet）によるWeb調査を、司令塔（Fable）が保存。司令塔による訂正は【訂正】と明記。
- 対象環境：macOS 26、Apple M4、32GB。Python 3.10（uv）、Node 22、Bun 1.2、Rust 1.92、Homebrew。ffmpeg・Whisper系は未導入。
- 用途：日本語（英語の専門用語混じり）の30秒〜3分の独り言を文字起こしして記録する。クラウドAPIは使わない。

【訂正】司令塔がローカルで `brew info` を実行して確認した事実：Homebrewの正式名は `whisper.cpp`（旧名 `whisper-cpp` も通る）、安定版1.9.4、macOS 26 arm64のビルド済みバイナリあり。また原文の「Rust実装（C/C++）」は誤りで、whisper.cppはC/C++実装。

## 結論（推奨）

推奨構成：whisper.cpp（Core ML有効ビルド）+ large-v3-turboモデル+ Homebrew導入+ CLIをサブプロセスから呼ぶ。将来配布時は同梱バイナリ化。

- 理由：日本語精度と速度のバランスが良く（後述ベンチマークで上位）、Homebrew一発で入り、Metal（AppleのGPU汎用計算API）とCore ML（Appleの機械学習実行形式。Neural Engineという専用チップを使える）の両方に対応済みで、CLIもHTTPサーバーも同じ配布物に入っている。C/C++実装なのでPython環境非依存で配布物に同梱しやすい。
- 代替案：mlx-whisper（large-v3-turbo）+ Pythonライブラリとして同一プロセス呼び出し。Apple純正のMLX（Apple Silicon専用の配列演算フレームワーク）を使うためM4との相性が良く、`pip install mlx-whisper` のみで動く。ただし配布時はPythonランタイム同梱が必要になり、Node/Rustから呼ぶ場合はサブプロセス経由になる。

## 1. 実行系の比較

### whisper.cpp（C/C++、MIT）
- 事実：Apple SiliconではMetalがデフォルトで有効。Core MLを有効にするとWhisperのエンコーダ部分がNeural Engine上で動き、small/base/mediumモデルでスループットがおおよそ2〜3倍になる（[Whisper.cpp Setup Guide 2026](https://weesperneonflow.ai/en/blog/2026-06-23-whisper-cpp-setup-guide-local-speech-recognition-2026/)）。
- 事実：`whisper-server` コマンドでOpenAI API互換のローカルHTTPサーバーを起動できる（[glama.ai voicemode docs](https://glama.ai/mcp/servers/@mbailey/voicemode/blob/748057b353762fab0e43ae63da7ae6e0c86ed512/docs/.archive/whisper.cpp.md)）。
- Pythonからはサブプロセス経由（`pywhispercpp` 等のバインディングもあるが未確認）。Nodeからも同様。Rustからは `whisper-rs` で直接組み込み可能。

### mlx-whisper（Apple MLX版）
- 事実：MLXはApple公式（GitHub: apple/mlx）。
- 未確認：mlx-whisper単体のM4での実時間比。関連調査では、OpenAI Whisper（Metal経由）はM3/M4でlarge-v3がおよそ2〜3倍速（実時間比）、small/base/tinyは10倍速超という報告がある（[Whisper benchmark on Apple Silicon](https://justvoice.ai/blog/whisper-benchmark-apple-silicon-m3-m4)、[Apple Silicon Whisper Metal Benchmark](https://www.promptquorum.com/local-llms/apple-silicon-whisper-metal-benchmark)）。
- Node/Rustから使う場合はサブプロセス起動が必要。

### faster-whisper（CTranslate2）
- 事実：CTranslate2のMetalバックエンドはfork版（eaglstun/CTranslate2）による実装で、SYSTRAN公式のfaster-whisperに標準搭載されているかは別問題（[faster-whisper Issue #515](https://github.com/SYSTRAN/faster-whisper/issues/515)、[eaglstun/CTranslate2](https://github.com/eaglstun/CTranslate2)）。
- 事実：Apple Silicon上ではwhisper.cppのMetal実装の方が高速とされ、faster-whisperのMetal対応は「実験的」という評価（[Whisper.cpp vs faster-whisper 2026](https://www.promptquorum.com/power-local-llm/local-whisper-stt-comparison-2026)）。

### WhisperKit（Swift, Argmax）
- 事実：Core MLとNeural Engineを使うSwiftパッケージ。2026年5月にv1.0.0となりargmax-oss-swiftに統合（[WhisperKit](https://www.argmaxinc.com/blog/whisperkit)、[argmax-oss-swift](https://github.com/argmaxinc/argmax-oss-swift)）。
- Swift製のため完全ネイティブSwiftアプリに最適。Python/Node/Rustから直接呼ぶ手段は薄い（未確認）。

### 日本語特化・新興モデル（2026年ベンチマーク）
2026年2月公開の日本語ASRベンチマーク（RTX 5090上、9モデル、自然な会話音声20クリップ・計580秒。[Neosophie Best Japanese ASR Models 2026](https://neosophie.com/en/blog/20260226-japanese-asr-benchmark)）：

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

- 注：RTFはRTX 5090（CUDA）上の計測。M4上での数値ではない。
- 事実：Qwen3-ASRはApache 2.0、日本語対応あり、0.6B/1.7B（[HuggingFace](https://huggingface.co/Qwen/Qwen3-ASR-1.7B)、[GitHub](https://github.com/QwenLM/Qwen3-ASR)）。M4上でのMLX等の動作報告は未確認。
- 事実：NVIDIA Parakeet-TDT-0.6b-v3 / Canary-1B-v2は欧州言語中心で日本語は対象外（[NVIDIA FAQ](https://perspectives.nvidia.com/nemotron-speech/task/faq/what-are-the-most-production-ready-open-speech-recognition-models-for-european-l/)）。
- 事実：Kyutai STTは英語・フランス語のみ（[Kyutai STT](https://kyutai.org/stt/)）。
- 未確認：Moonshineの日本語対応。
- 全体（事実+推論）：2026年時点で日本語の総合精度はWhisper-large-v3-turboとQwen3-ASR-1.7Bが上位。ただしこのベンチマークは1本のみでサンプルも少なく、専門用語混じりの独り言での再現性は未確認。

## 2. 統合方式の比較

| 方式 | 個人利用の手軽さ | 将来配布のしやすさ |
|---|---|---|
| (a) CLIをサブプロセスで叩く | 高い。言語非依存で最も手早い | 高い。バイナリを同梱すれば良い |
| (b)ローカルHTTPサーバー | 中。プロセス管理・ポート管理が要る | 中。マルチクライアント対応がしやすい |
| (c) Pythonライブラリとして同一プロセス | 高い（Python内で完結） | 低〜中。Python環境同梱が必要 |
| (d) Rustクレート（whisper-rs）で組み込み | 中（Rust実装が必要） | 高い。単一バイナリに組み込める |

- 事実：`whisper-rs` はwhisper.cppへのRustバインディングで、月間ダウンロード約11万（[crates.io](https://crates.io/crates/whisper-rs)）。
- 推奨（推論）：まず(a)で作り、配布フェーズで(d)に移行する段階的アプローチ。

## 3. 録音の取り方

- 事実：ブラウザの `MediaRecorder` は既定でWebM/Opusを出力し、サンプルレートを制御できない（[Recording Spec-Compliant WAV Files](https://dev.to/orca_forge/recording-spec-compliant-wav-files-16-bitmonouncompressed-using-only-web-audio-40n8)）。
- 事実：whisper.cppは16bit・16kHz WAVを要求するため、WebM/Opusを渡すには変換が要る。
- ffmpegを避ける方法（事実）：Web Audio APIの `AudioWorkletNode`（または旧 `ScriptProcessorNode`）でFloat32のPCMを直接取得し、自前で16bit PCM WAVに組み立てる（同上、[Getting monochannel 16-bit PCM from mic](https://medium.com/@ragymorkos/gettineg-monochannel-16-bit-signed-integer-pcm-audio-samples-from-the-microphone-in-the-browser-8d4abf81164d)）。
- ネイティブ（Tauri）の場合（事実）：`tauri-plugin-audio-recorder` 等は `cpal`（Rustの音声入出力ライブラリ）と `hound`（RustのWAV読み書きライブラリ）で16kHzモノラルWAVを直接書き出せる（[crates.io](https://crates.io/crates/tauri-plugin-audio-recorder)）。
- 結論（推論）：ブラウザでもネイティブでもffmpegなしで16kHzモノラルWAVを得る経路がある。

## 4. 日本語文字起こしでよくある問題と対策

- 句読点が付かない：後処理モデルを挟む、または `initial_prompt` で句読点付きの文を与える（推論を含む一般的回避策）。
- ハルシネーション（存在しない発話の生成）：VAD（Voice Activity Detection、音声区間検出）で無音を事前に除去すると大きく減る（[Reducing hallucinations via VAD](https://theneuralbase.com/faster-whisper/learn/intermediate/reducing-hallucinations-via-vad/)）。
- 無音での繰り返し：VADに加え、デコード時の反復抑制パラメータ調整。
- 専門用語の誤変換：`initial_prompt`（先頭に与える文脈）で改善できるが、長いプロンプトはそれ自体がハルシネーションの原因になり得る。用語リストは短く具体的に。
- 対策まとめ（推論）：(1)録音前後の無音をVADでトリミング、(2) initial_promptは固有名詞・専門用語の短いリスト、(3)句読点は後処理、(4)繰り返し検出時は再デコードまたは破棄。

## 5. 推奨構成の利点・欠点

推奨：whisper.cpp（Core ML）+ large-v3-turbo + Homebrew + CLIサブプロセス
- 利点：Homebrewで即導入。M4でNeural Engineを使える。日本語WER 0.218で上位。Python/Node/Rustいずれからも呼びやすい。将来Tauri化時はwhisper-rsで同じwhisper.cppを組み込める。
- 欠点：Qwen3-ASR-1.7Bより精度が若干低い可能性。ハルシネーション傾向がありVAD前処理が要る。Core MLモデル変換に初回の手間。

代替：mlx-whisper（large-v3-turbo）+ Python同一プロセス
- 利点：`pip install` のみで最速プロトタイピング。
- 欠点：Node/Rustから直接呼べない。配布時にPythonランタイム同梱が必要。

提案（推論）：個人利用段階でQwen3-ASR-1.7BをMLXまたはPyTorchで動かして精度を実測比較し、必要ならモデルだけ差し替える。

## 未確認事項一覧
- mlx-whisperのM4での実時間比データ
- Qwen3-ASRのM4上での動作報告・速度
- WhisperKitをPython/Node/Rustから呼ぶ手段
- Moonshineの日本語対応可否
- ReazonSpeech各バリアントのライセンス
- 句読点付与後処理モデルの日本語精度
- 上記ベンチマークの再現性（20クリップは小規模）
