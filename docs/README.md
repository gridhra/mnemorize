# docs の案内

- `requirements/01-needs-and-requirements-draft.md`：要件ドラフト。ニーズの読み取り、要件案、ユーザーの判断待ち論点（§5）。**最初に読む文書。**
- `research/01-prior-art.md`：ノート単位・トピック単位で間隔反復をする既存ツールの調査。
- `research/02-local-asr.md`：Apple Silicon でのローカル日本語音声認識（whisper.cpp 等）の調査。
- `research/03-tech-stack.md`：アプリ形態・データ保存・データモデル素案。
- `research/04-scheduling-algorithm.md`：FSRS と固定ラダーの比較、自己評価の段階、運用上の扱い。
- `research/05-spike-recorder.md`：ブラウザだけで 16kHz WAV を作り whisper.cpp に渡す検証（Chrome で成功）。検証コードは `spikes/recorder/`。
- `research/05-spike-fsrs.md`：ts-fsrs 5.4.2 の API 確認とシミュレーション。UTC 暦日の落とし穴と対策を含む。検証コードは `spikes/fsrs/`。
- `research/06-spike-whisper.md`：whisper.cpp 1.9.4 の実機検証。`-nt` オプションで文が落ちる問題の切り分けを含む。検証コードは `spikes/whisper/`。
- `design/01-architecture.md`：全体構成、データモデル、API、画面、実装の段階分け。**実装はこれを基準にする。**

調査ノート 01〜04 は 2026-09-15 にサブエージェントの Web 調査を保存したもの。05〜06 は同日の実機検証。各ノート末尾の「未確認事項」を、断定と区別して読むこと。
