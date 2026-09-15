#!/usr/bin/env bash
# whisper.cpp スパイク検証で実行した全コマンドの再実行用スクリプト。
# 実行場所: spikes/whisper/ (このファイルがあるディレクトリ)
# 前提: Homebrew (brew) がインストール済みであること。
set -euo pipefail
cd "$(dirname "$0")"

MODEL_DIR="$HOME/.cache/whisper-cpp"
MODEL="$MODEL_DIR/ggml-large-v3-turbo.bin"
MODEL_Q5="$MODEL_DIR/ggml-large-v3-turbo-q5_0.bin"
PROMPT="以下は、今日の学習内容を日本語で話した記録です。句読点を付けて書き起こしてください。React、useEffect、SQLite、API。"

mkdir -p samples results "$MODEL_DIR"

# --- 1. インストール ---
brew install whisper.cpp
# 確認コマンド:
#   which whisper-cli whisper-server
#   whisper-cli --help  (system_info 行に COREML = 0 / MTL(Metal) EMBED_LIBRARY = 1 と出る)
#   brew cat whisper.cpp (formula の cmake オプションに -DWHISPER_COREML が無いことを確認)

# --- 2. モデルのダウンロード（ホーム配下のキャッシュに保存、プロジェクト内には置かない）---
curl -L -o "$MODEL"    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"
curl -L -o "$MODEL_Q5" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin"

# --- 3. テスト音声の作成 ---
# (a) 学習記録の音読（約60〜70秒、Kyoko音声、16kHzモノラルPCM16 WAV）
say -v Kyoko -o samples/sample_a.wav --data-format=LEI16@16000 -f samples/script_a.txt

# (b) 完全な無音10秒、(c) (a)の前後に3秒ずつ無音を付けたもの（Pythonのwaveモジュールで生成）
python3 samples/make_silence.py silence 10 samples/sample_b_silence.wav
python3 samples/make_silence.py pad samples/sample_a.wav 3 3 samples/sample_c_padded.wav

# --- 4. 文字起こしの実行 ---

# 4-1. 言語自動判定 vs -l ja 指定
whisper-cli -m "$MODEL" -f samples/sample_a.wav -nt                 > results/01_nolang_noprompt.txt 2>results/01_nolang_noprompt.log
whisper-cli -m "$MODEL" -f samples/sample_a.wav -l ja -nt           > results/02_ja_noprompt.txt     2>results/02_ja_noprompt.log

# 4-2. 初期プロンプト（--prompt）あり/なし
whisper-cli -m "$MODEL" -f samples/sample_a.wav -l ja -nt --prompt "$PROMPT" > results/03_ja_prompt.txt 2>results/03_ja_prompt.log

# 4-3. 無音ファイルでのハルシネーション確認
whisper-cli -m "$MODEL" -f samples/sample_b_silence.wav -l ja -nt   > results/04_silence.txt          2>results/04_silence.log
whisper-cli -m "$MODEL" -f samples/sample_b_silence.wav -nt         > results/05_silence_autolang.txt 2>results/05_silence_autolang.log

# 4-4. 前後無音パディングの影響
whisper-cli -m "$MODEL" -f samples/sample_c_padded.wav -l ja -nt    > results/06_padded.txt           2>results/06_padded.log

# 4-5. --no-speech-thold を上げてハルシネーションが抑制されるか
whisper-cli -m "$MODEL" -f samples/sample_b_silence.wav -l ja -nt -nth 0.9 > results/07_silence_nth09.txt 2>results/07_silence_nth09.log

# 4-6. JSON出力（セグメント・タイムスタンプ確認）
whisper-cli -m "$MODEL" -f samples/sample_a.wav -l ja -oj -of results/08_json 2>results/08_json.log

# 4-7. スレッド数の比較
whisper-cli -m "$MODEL" -f samples/sample_a.wav -l ja -nt -t 1 > /dev/null 2>results/09_t1.log
whisper-cli -m "$MODEL" -f samples/sample_a.wav -l ja -nt -t 8 > /dev/null 2>results/10_t8.log

# 4-8. Flash Attention の有無比較（デフォルトは有効 = -fa）
whisper-cli -m "$MODEL" -f samples/sample_a.wav -l ja -nt -nfa > /dev/null 2>results/11_noflash.log
whisper-cli -m "$MODEL" -f samples/sample_a.wav -l ja -nt -fa  > /dev/null 2>results/12_flash.log

# 4-9. 量子化モデル(q5_0)での比較
whisper-cli -m "$MODEL_Q5" -f samples/sample_a.wav -l ja -nt > results/13_q5_0.txt 2>results/13_q5_0.log

# 4-10. greedy探索（beam-size=-1, best-of=2、whisper-serverのデフォルトに合わせた設定）との比較
whisper-cli -m "$MODEL" -f samples/sample_a.wav -l ja -nt -bs -1 -bo 2 > results/15_greedy.txt 2>results/15_greedy.log

# CER (文字誤り率) の計算例
python3 cer.py samples/script_a.txt results/02_ja_noprompt.txt

# --- 5. whisper-server の起動確認 ---
whisper-server -m "$MODEL" --port 8089 > results/14_server.log 2>&1 &
SERVER_PID=$!
sleep 8
curl -s http://127.0.0.1:8089/inference \
  -F file=@samples/sample_a.wav \
  -F language=ja \
  -F response_format=json
kill "$SERVER_PID"

# --- 6. 追加調査：文の脱落の切り分け（whisper-cli の -nt が原因と判明） ---

# 6-1. whisper-cli の再現性（3回、既定のビームサーチ設定 + -nt）
for i in 1 2 3; do
  whisper-cli -m "$MODEL" -f samples/sample_a.wav -l ja -nt > "results/16_cli_repeat_$i.txt" 2>"results/16_cli_repeat_$i.log"
done
# → 3回とも文字単位で完全に同一（該当の1文が毎回欠落）。

# 6-2. whisper-server の再現性（3回）
whisper-server -m "$MODEL" --port 8089 > results/17_server_repeat.log 2>&1 &
SERVER_PID=$!
sleep 8
for i in 1 2 3; do
  curl -s http://127.0.0.1:8089/inference -F file=@samples/sample_a.wav -F language=ja -F response_format=json > "results/17_server_run_$i.json"
done
kill "$SERVER_PID"
# → 3回とも文字単位で完全に同一（全文出力、脱落なし）。

# 6-3. ビームサーチ設定を server と揃えても脱落は消えない
whisper-cli -m "$MODEL" -f samples/sample_a.wav -l ja -nt -bs -1 -bo 2 > results/15_greedy.txt 2>results/15_greedy.log

# 6-4. -ml 60（server の内部既定セグメント長）を -nt と併用しても脱落は消えない
whisper-cli -m "$MODEL" -f samples/sample_a.wav -l ja -nt -ml 60 > results/18_cli_ml60.txt 2>results/18_cli_ml60.log

# 6-5. -ml 60 を -nt なしで使うと脱落しない（タイムスタンプ付き出力）
whisper-cli -m "$MODEL" -f samples/sample_a.wav -l ja -ml 60 > results/19_cli_ml60_ts.txt 2>results/19_cli_ml60_ts.log

# 6-6. 【結論を再現する最小の条件】-nt を外すだけで脱落が消える（他は既定値のまま）
whisper-cli -m "$MODEL" -f samples/sample_a.wav -l ja > results/20_cli_with_ts.txt 2>results/20_cli_with_ts.log
# タイムスタンプ行を取り除いてテキストだけを取り出す例:
grep -oP '(?<=\] ).*' results/20_cli_with_ts.txt | tr -d '\n' > results/20_cli_with_ts_plain.txt
python3 cer.py samples/script_a.txt results/20_cli_with_ts_plain.txt
# → CER 8.8%（-nt ありの場合の49.6%から大幅改善）。
# 参考: whisper.cpp v1.9.4 のソース (examples/cli/cli.cpp と examples/server/server.cpp) を
#   https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.4.tar.gz から取得し、
#   -nt が wparams.no_timestamps にそのまま渡ることを確認した（表示上の省略ではなく、
#   whisper.cpp のデコード自体に影響するパラメータだった）。
