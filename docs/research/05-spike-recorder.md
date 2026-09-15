# 調査ノート 05：ブラウザ側で 16kHz モノラル WAV を作る検証（録音スパイク）

- 調査日：2026-09-15
- 作成：Claude Code のサブエージェント（Sonnet）による実装・検証。
- 前提：個人用ローカルアプリで「今日やったこと」を音声入力し、whisper.cpp で文字起こしする。whisper.cpp は 16kHz・モノラル・16bit PCM の WAV しか受け付けない。ffmpeg を使わず、ブラウザの `AudioContext` + `AudioWorkletNode` で最初からその形式の WAV を作れるかを検証した（`MediaRecorder` は WebM/Opus しか出せないため使わない）。検証コードは `spikes/recorder/`（Bun 1.2 + Hono のサーバーとブラウザ UI）に置いた。

## 結論（先に）

ブラウザ側だけで 16kHz モノラル 16bit PCM の WAV を作り、サーバーへ送って whisper.cpp に渡せることを、Chrome 上で実機確認できた。この方式は成立する。ただし確認したのは Chrome（macOS）のみで、Safari では未確認。マイクを使った実録音（ユーザーの声）はマイク権限ダイアログが伴うため今回は自動実行せず、手順だけを用意した（下記「ユーザーが手で確認する手順」）。

## 確認できたこと（ブラウザ名・バージョンつき）

- Chrome 152.0.7977.84（macOS、Claude in Chrome 拡張経由で操作）で `http://localhost:8787` を開き、「テスト信号で録音（3秒・マイク不要）」ボタン（440Hz の正弦波を `OscillatorNode` から `AudioWorkletNode` に流す経路）を実行した。
- サーバーの `/upload` が返した JSON は、サンプルレート 16000Hz・チャンネル数 1・ビット深度 16bit・長さ 2.744 秒・ファイルサイズ 87852 バイトだった（画面表示でも確認）。3 秒ちょうどにならなかったのは `setTimeout(3000ms)` で `oscillator.stop()` を呼んでから停止処理が完了するまでの遅延によるもので、WAV 生成自体の問題ではない。
- 生成された WAV ファイル（`spikes/recorder/out/rec-*.wav`）を `file` コマンドで見ると `RIFF (little-endian) data, WAVE audio, Microsoft PCM, 16 bit, mono 16000 Hz` と表示され、Python の `wave` モジュールでも `framerate=16000, channels=1, sampwidth=2` と一致した。
- ブラウザのコンソールに「AudioContext のサンプルレート指定が尊重されず〜」という警告（実装した自前のフォールバック用ログ）は出なかった。つまり Chrome では `new AudioContext({ sampleRate: 16000 })` の指定がそのまま有効になり、線形補間リサンプリングの経路は今回は使われなかった（コード自体は実装済みで、条件分岐に入っていないことを警告の不在で確認した）。
- 事前に別途用意されていた `whisper-cli`（Homebrew 版 whisper.cpp、モデルは `~/.cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin`）に、(1) Python の `wave` モジュールで作った既知の 16kHz モノラル 1 秒の正弦波 WAV、(2) 上記のブラウザ生成 WAV、の両方を渡し、どちらもエラーなく処理が完了した（出力は正弦波なので意味のある文字起こしにはならないが、フォーマットエラーは一切出なかった）。
- サーバー側の WAV ヘッダ解析（`server.ts` に自前実装、依存ライブラリなし）は、curl で送った既知ファイルとブラウザ生成ファイルの両方でサンプルレート・チャンネル数・ビット深度・長さ・ファイルサイズを正しく返した。

## 確認できなかったこと

- Safari での動作は未確認。Safari は AudioWorklet は 14.1 以降で対応しているはずだが、`AudioContext({ sampleRate: 16000 })` の指定を尊重するかどうかは今回試せていない。もし尊重しない（既定の 44.1kHz や 48kHz になる）場合は、実装済みの線形補間リサンプリング経路が実際に機能するかどうかも未検証。
- マイクを使った実録音（人の声）はマイク権限ダイアログが必要なため、自動化ツールからは実行していない。パイプライン自体（Worklet でのサンプル収集、Int16 変換、WAV ヘッダ付与、アップロード）はテスト信号の経路と共通なので恐らく同様に動くと推論できるが、マイク由来の入力で確認したわけではない。
- 生成した WAV を whisper.cpp に通したのは「エラーが出ないか」の確認のみ。正弦波なので文字起こし精度・実際の音声認識の質は未確認（もともと今回の検証対象ではない）。

## ユーザーが手で確認する手順（5行以内）

1. `cd spikes/recorder && bun run server.ts` でサーバーを起動する（ポート 8787）。
2. ブラウザで `http://localhost:8787` を開く。
3. 「マイクで録音開始」を押し、マイクへのアクセスを許可する。
4. 数秒話してから「録音停止」を押す。
5. 画面下部の「結果」欄にサーバーが解析したサンプルレート・チャンネル数・ビット深度・長さ・ファイルサイズが表示されれば成功。サンプルレートが 16000Hz になっているかを確認する。

## 実装上の注意点（本番実装への引き継ぎ）

- **AudioContext のサンプルレート指定は Chrome では効いた**が、ブラウザ依存の挙動なので、本番実装でも「`audioContext.sampleRate` を毎回読んで 16000 と一致しているか確認し、一致しなければリサンプリングする」というフォールバック経路は削らずに残すべきである。今回の検証コード（`spikes/recorder/public/index.html` の `encodeWav()` 関数）はこの分岐を持っており、そのまま流用できる。
- **AudioWorkletNode は destination に繋がっていないと処理自体が止まる**という落とし穴がある。Web Audio API は「オーディオの出力先（`audioContext.destination`）から逆算してグラフを引っ張る」方式で動くため、録音用の Worklet ノードを音声出力に使わないからといって `destination` に繋がずに放置すると、ブラウザによっては `process()` が呼ばれなくなる。検証コードでは、Worklet の出力をゲイン 0 の `GainNode` を経由させてから `destination` に繋ぐことで、無音のまま処理を回し続けている（`startCollecting()` 内）。この配線を省略すると「録音ボタンを押しても音量メーターが動かない・データが集まらない」という分かりにくい不具合になるので、本番実装でも必ず踏襲する。
- **Worklet からメインスレッドへの Float32Array の受け渡しはコピーが必須**。`AudioWorkletProcessor.process()` に渡される `Float32Array` は内部バッファを使い回すため、`postMessage` で転送する前に `slice()` でコピーしないと、次の `process()` 呼び出しで中身が上書きされたり、Transferable 化した際にバッファ自体が失われたりする。検証コード（`recorder-worklet.js`）は `channelData.slice()` してから `postMessage(copy, [copy.buffer])` している。
- **WAV ヘッダは 44 バイト固定ではなく、チャンク構造として書く・読むべき**。ブラウザ側で書き出す分には 44 バイト固定（`fmt` チャンクの拡張フィールドなし）で問題ないが、サーバー側の解析はチャンクを順番に読み進める実装にした（`fmt` と `data` の順序が入れ替わっていたり、他のチャンクが挟まっていても壊れないようにするため）。他のツールが生成した WAV を将来受け付ける可能性があるなら、この汎用的な解析ロジックをそのまま流用するとよい。
- **AudioContext の生成・resume はユーザー操作（クリックハンドラ）の中で行う**必要がある。ブラウザの自動再生ポリシーにより、クリック外で作成すると `suspended` 状態のまま音声処理が始まらないことがある。検証コードでは各ボタンの `click` イベントハンドラ内で `new AudioContext(...)` と `ctx.resume()` を呼んでいる。
- **録音停止後の後片付け（トラック停止・ノード切断・AudioContext のクローズ）を確実に行う**こと。マイクの `MediaStreamTrack` を `stop()` し忘れると、ブラウザのマイク使用中インジケーター（タブや OS のマイクアイコン）が点灯したままになる。検証コードの `teardownAudio()` にまとめてある。

## 関連ファイル

- サーバー・WAV ヘッダ解析：`spikes/recorder/server.ts`
- 録音ページ：`spikes/recorder/public/index.html`
- AudioWorkletProcessor：`spikes/recorder/public/recorder-worklet.js`
- 検証で生成した WAV（curl 経由・ブラウザ経由）：`spikes/recorder/out/`
