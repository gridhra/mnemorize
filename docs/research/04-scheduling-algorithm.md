# 調査ノート04：間隔反復アルゴリズムの選定（トピック単位の自由再生向け）

- 調査日：2026-09-15
- 作成：Claude Codeのサブエージェント（Opus）による調査を、司令塔（Fable）が保存。
- 前提：復習単位はフラッシュカードではなく「その日やった学習・作業の記録1件」。復習時の行動は「手がかりを見て内容を思い出す（自由再生）→本文や添付を開いて答え合わせ→自己評価」。

## 結論（先に）

推奨：FSRS-6をts-fsrsライブラリで採用し、評価は3段階（Again / Good / Easy）に絞る。パラメータは既定値のまま固定し、最適化は当面やらない。
代替案：固定ラダー（1-3-7-14-30-60-120日）+失敗時の後退。実装100行で済み、破綻しない。

理由の核心：(a) FSRSは「前回からの実経過日数」を入力に取るので、サボって溜まった遅延を自然に吸収する。固定ラダーは遅延を自前で扱う必要がある。(b) FSRSの既定パラメータは大規模な実レビューから学習済みで、自分のデータが0件でも妥当に動く。個人利用で日1〜3件しか作られないアプリでは、自前学習に足るデータは何年も集まらない。

## 1. スケジューリング方式の比較

### 事実
- FSRS（Free Spaced Repetition Scheduler）は記憶を3変数で表す。Retrievability（今この瞬間に思い出せる確率）、Stability（想起確率が100%から90%に落ちるまでの日数）、Difficulty（項目固有の難しさ）。FSRS-6は21パラメータ。既定パラメータは約1万ユーザー・数億件のレビューから最適化されたもので、個人履歴が無いときはこれが使われる（[ABC of FSRS](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/ABC-of-FSRS)）。
- ベンチマーク（Anki revlogs 10k、約7.27億件）でFSRS-6はFSRS-5に対しlog lossでユーザーの88.2%で優位。最適化済みFSRS-6は既定パラメータ版に対し84.3%で優位。SM-2は16方式中下位（[Benchmark of Spaced Repetition Algorithms](https://expertium.github.io/Benchmark.html)）。
- 最適化に必要なレビュー件数：Anki 24.06.3以降は下限撤廃。ただしAnkiマニュアルは「数百件未満では性能が悪い」としている（[Anki FSRS FAQ](https://faqs.ankiweb.net/frequently-asked-questions-about-fsrs.html)、[Deck Options](https://docs.ankiweb.net/deck-options.html)）。
- ts-fsrs（open-spaced-repetition公式TypeScript実装）はFSRS-6実装。fuzz（間隔のランダム分散）、learning steps（当日中の再提示）、最大間隔上限、`forget()`／`reschedule()`／履歴からの状態再構築を備える。Node.js >= 20必須（[ts-fsrs README](https://github.com/open-spaced-repetition/ts-fsrs)）。司令塔確認：npm最新5.4.2（2026-09-10）。
- ノート単位レビューの先行例：Obsidian Spaced Repetitionプラグインは3段階（Hard / Good / Easy）のSM-2改変版。Easyはease +20かつ間隔×（新ease/100×1.3）、Goodは×（ease/100）、Hardはease −20かつ間隔×0.5、ease下限130。8日以上の間隔には ±ceil（0.05×間隔）のfuzz（[Repetition Algorithms](https://stephenmwangi.com/obsidian-spaced-repetition/algorithms/)）。
- SuperMemoのincremental readingは、トピックにA-Factor（間隔の伸び率）を持たせ、相対優先度キューで管理。「1日に処理しきれない量が出てくるのが常態」という前提に立ち、auto-postponeは上位優先度だけ残して低優先度を先送りする（[SuperMemo: Priority queue](https://super-memory.com/archive/help15/priority.htm)）。
- 自由再生の粒度：文章全体を思い出す条件と節ごとに思い出す条件を比べた研究では、後日のテスト成績は「全体を思い出す」条件のほうが良かった（対象はADHDのある学生。[PMC10715433](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10715433/)）。

### 推論・未確認
- 未確認：「1日の学習記録全体を自由再生する」粒度に対して間隔反復アルゴリズムを当てた研究・実装の評価データは見つからなかった。FSRSのパラメータは一問一答カードの履歴から学習されたもので、トピック単位への転用は外挿。ただしFSRSが推定するのは「思い出せる確率」という抽象量なので、評価が一貫していれば大きく外れないだろう（推論）。
- FSRSの主な弱点はこのアプリでは軽い：カードが数千件あって毎日の負荷を削りたい場面で最も効く方式なので、日1〜3件しか増えないなら固定ラダーとの差は実効的に小さい。差が出るのは「遅延の扱い」と「個人差への適応」。

## 2. 評価の段階数

### 事実
- FSRS / Ankiは4段階。Again =忘れた。Hard =思い出せたが手間取った（合格扱い）。Good =普通に正解。Easy =迷いなく即答。「忘れたのにHardを押すとFSRSでは間隔が不当に長くなる」と明記（[Deck Options](https://docs.ankiweb.net/deck-options.html)）。
- FSRSの最適化時、評価は二値に変換される（Againなら0、それ以外は1）（[Benchmark](https://expertium.github.io/Benchmark.html)）。
- Obsidianのノートレビューは3段階。

### 推論
- 3段階（Again / Good / Easy）を推奨。自由再生で「手間取った」（Hard）と「思い出せた」（Good）の境界は主観的で日内変動に埋もれる。Anki自身がHardの誤用を警告している以上、境界が曖昧な選択肢は害になる。AgainとGoodの境界は二値の事実として定義できる。
- 境界の定義案（UIにそのまま出す文言）：
  - Again：本文を開いて「これ何だっけ」となった。主要な要点を1つも挙げられなかった。
  - Good：本文を開く前に、その日やったことの要点を2〜3個、自分の言葉で言えた。細部の抜けは許容。
  - Easy：ほぼ全部説明でき、しかも次に見るのは当分先でいいと自分で思える。
  - 「言えた要点の個数」という数えられる基準にするのがコツ（未確認：この基準を検証した研究はなく、設計提案）。
- ts-fsrsは4段階APIなので、UIの3ボタンをAgain / Good / Easyにマップし、Hardは使わないだけで済む。

## 3. 運用上の問題を既存実装がどう扱っているか

(a)溜まった復習（backlog）
- 事実：FSRSは遅延を減衰ペナルティではなく入力として扱う。遅延が伸びるとRetrievabilityが下がり、それでも正解できたなら次のStabilityはより高くなる（[fsrs4anki issue #691](https://github.com/open-spaced-repetition/fsrs4anki/issues/691)）。
- 事実：Anki用のFSRS HelperアドオンはPostpone（先送り）機能を持つ（[fsrs4anki-helper](https://github.com/open-spaced-repetition/fsrs4anki-helper)）。
- 推論：本アプリでは「1日の提示上限（例10件）」と「期限超過が長い順」で十分。減衰処理はFSRSに任せられる。

(b)記録を後日「加筆修正」した場合
- 事実：Ankiは編集しても履歴をリセットしない。作り変えた場合はユーザーが明示的にResetを実行する（[Resetting progress](https://faqs.ankiweb.net/resetting-progress-in-a-deck.html)）。
- 推論：自動リセットは実装すべきでない。編集画面に「内容が大きく変わったので復習をやり直す」チェックを置き、既定オフ。

(c) Againを当日中に再提示するか（learning steps）
- 事実：AnkiマニュアルはFSRS使用時、learning stepsを1日未満に保つことを推奨し、同日内の反復を増やしても長期記憶への寄与は小さいとしている（[Deck Options](https://docs.ankiweb.net/deck-options.html)）。
- 推論：本アプリは「1日1セッション」運用なので、当日再提示は入れない。Againは翌日再提示（ts-fsrsの `enable_short_term: false`）。

(d)同日作成カードの期限集中（load balancing / fuzz）
- 事実：Ankiは10日の間隔なら8〜12日のどこかにランダムにずらす。Load Balanced Schedulerは同じ範囲から期限が最も少ない日を選ぶ（[load-balanced-scheduler](https://github.com/xquercus/load-balanced-scheduler/blob/master/README.md)）。
- 推論：ts-fsrsの `enable_fuzz: true` で足りる。日1〜3件なら本格的なload balancingは不要。

(e)卒業（retire）
- 事実：Ankiは最大間隔設定、suspend（保留）、leech（何度も失敗するカード）の自動保留を持つ。ts-fsrsも `maximum_interval` を持つ。
- 推論：「間隔が365日を超えたら自動アーカイブ」＋「手動の卒業ボタン」の二段構え。個人の学習記録は「覚え続ける価値がなくなる」ことがあるので手動卒業は必須。

## 4. 推奨する初期実装（1案）と代替（1案）

### 推奨案：ts-fsrs（FSRS-6）+ 3ボタン評価+既定パラメータ固定
- ライブラリ設定：`enable_fuzz: true`、`enable_short_term: false`、`maximum_interval: 365`、`request_retention: 0.9`。
- 評価UI：Again / Good / Easyの3ボタン。判定基準を短文で添える。
- 保存：カードごとにFSRSの状態（stability, difficulty, due, state, reps, lapses）と、レビューログ全件。ログを必ず残すことが将来の最適化と方式乗り換えの保険。
- backlog：1日の提示上限、期限超過が長い順。
- 卒業：間隔365日超で自動アーカイブ＋手動の卒業ボタン。
- 編集：既定では履歴を維持。「作り直した」チェックで明示リセット。

利点：遅延を自前ロジックなしで扱える。データ0件から妥当に動く。fuzz・最大間隔・リセット・履歴再構築がライブラリ側にある。レビューが数百件溜まった時点で最適化へ移行できる。
欠点：依存が増える（Node 20+）。21パラメータのブラックボックスで「なぜこの間隔か」を説明しにくい。トピック単位の自由再生に対する妥当性は未検証。最適化の効果は当分得られない。

### 代替案：固定ラダー（1-3-7-14-30-60-120-365日）
Againで1段下がる、Goodで1段上がる、Easyで2段上がる。期限超過は「超過日数が現在の間隔を超えたら1段下げる」等の単純規則、±5%のfuzz。
利点：挙動が完全に説明可能、依存ゼロ、100行程度。欠点：個人差・項目差に適応しない、遅延の扱いを自分で設計、後でFSRSに移る際に過去ログの意味づけが変わる（ログさえあれば移行は可能）。

### 判断の分かれ目
「まずリリースして自分で使う」最優先なら代替案、「長く使い続けてデータを貯める」なら推奨案。両案ともレビューログの保存形式は同じにできるので、固定ラダーで始めて後からFSRSに差し替える道も現実的。推奨案を上に置いたのは、ts-fsrsの導入コストが実質「1依存+数十行」で、固定ラダーを自作するコストとほぼ変わらないため。

## 未確認事項のまとめ
- トピック単位の自由再生に対する間隔反復アルゴリズムの比較評価（研究・実装とも見つからず）。
- 「言えた要点の個数」でAgain/Goodを切る基準の妥当性。
- FSRS-4 / 4.5 / 5 / 6の数式レベルの差分（実装上は最新のts-fsrsを使えば足りる）。
- Ankiの「編集だけではスケジューリングが変わらない」は、リセット手順の記述からの推定を含む。

## 出典一覧
- [ABC of FSRS](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/ABC-of-FSRS)
- [Benchmark of Spaced Repetition Algorithms](https://expertium.github.io/Benchmark.html)
- [Anki Manual: Deck Options](https://docs.ankiweb.net/deck-options.html)
- [Anki FAQ: FSRS](https://faqs.ankiweb.net/frequently-asked-questions-about-fsrs.html)
- [Anki FAQ: Resetting progress](https://faqs.ankiweb.net/resetting-progress-in-a-deck.html)
- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)
- [fsrs4anki-helper](https://github.com/open-spaced-repetition/fsrs4anki-helper)
- [fsrs4anki issue #691](https://github.com/open-spaced-repetition/fsrs4anki/issues/691)
- [Obsidian Spaced Repetition: Algorithms](https://stephenmwangi.com/obsidian-spaced-repetition/algorithms/)
- [load-balanced-scheduler](https://github.com/xquercus/load-balanced-scheduler/blob/master/README.md)
- [SuperMemo: Priority queue](https://super-memory.com/archive/help15/priority.htm)
- [Free-recall: whole-text versus section recall](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10715433/)
