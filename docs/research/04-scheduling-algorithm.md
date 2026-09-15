# 調査ノート 04：間隔反復アルゴリズムの選定（トピック単位の自由再生向け）

- 調査日：2026-09-15
- 作成：Claude Code のサブエージェント（Opus）による調査を、司令塔（Fable）が保存。
- 前提：復習単位はフラッシュカードではなく「その日やった学習・作業の記録 1 件」。復習時の行動は「手がかりを見て内容を思い出す（自由再生）→本文や添付を開いて答え合わせ→自己評価」。

## 結論（先に）

推奨：FSRS-6 を ts-fsrs ライブラリで採用し、評価は 3 段階（Again / Good / Easy）に絞る。パラメータは既定値のまま固定し、最適化は当面やらない。
代替案：固定ラダー（1-3-7-14-30-60-120 日）+ 失敗時の後退。実装 100 行で済み、破綻しない。

理由の核心：(a) FSRS は「前回からの実経過日数」を入力に取るので、サボって溜まった遅延を自然に吸収する。固定ラダーは遅延を自前で扱う必要がある。(b) FSRS の既定パラメータは大規模な実レビューから学習済みで、自分のデータが 0 件でも妥当に動く。個人利用で日 1〜3 件しか作られないアプリでは、自前学習に足るデータは何年も集まらない。

## 1. スケジューリング方式の比較

### 事実
- FSRS（Free Spaced Repetition Scheduler）は記憶を 3 変数で表す。Retrievability（今この瞬間に思い出せる確率）、Stability（想起確率が 100% から 90% に落ちるまでの日数）、Difficulty（項目固有の難しさ）。FSRS-6 は 21 パラメータ。既定パラメータは約 1 万ユーザー・数億件のレビューから最適化されたもので、個人履歴が無いときはこれが使われる（[ABC of FSRS](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/ABC-of-FSRS)）。
- ベンチマーク（Anki revlogs 10k、約 7.27 億件）で FSRS-6 は FSRS-5 に対し log loss でユーザーの 88.2% で優位。最適化済み FSRS-6 は既定パラメータ版に対し 84.3% で優位。SM-2 は 16 方式中下位（[Benchmark of Spaced Repetition Algorithms](https://expertium.github.io/Benchmark.html)）。
- 最適化に必要なレビュー件数：Anki 24.06.3 以降は下限撤廃。ただし Anki マニュアルは「数百件未満では性能が悪い」としている（[Anki FSRS FAQ](https://faqs.ankiweb.net/frequently-asked-questions-about-fsrs.html)、[Deck Options](https://docs.ankiweb.net/deck-options.html)）。
- ts-fsrs（open-spaced-repetition 公式 TypeScript 実装）は FSRS-6 実装。fuzz（間隔のランダム分散）、learning steps（当日中の再提示）、最大間隔上限、`forget()`／`reschedule()`／履歴からの状態再構築を備える。Node.js >= 20 必須（[ts-fsrs README](https://github.com/open-spaced-repetition/ts-fsrs)）。司令塔確認：npm 最新 5.4.2（2026-09-10）。
- ノート単位レビューの先行例：Obsidian Spaced Repetition プラグインは 3 段階（Hard / Good / Easy）の SM-2 改変版。Easy は ease +20 かつ間隔 ×(新 ease/100×1.3)、Good は ×(ease/100)、Hard は ease −20 かつ間隔 ×0.5、ease 下限 130。8 日以上の間隔には ±ceil(0.05×間隔) の fuzz（[Repetition Algorithms](https://stephenmwangi.com/obsidian-spaced-repetition/algorithms/)）。
- SuperMemo の incremental reading は、トピックに A-Factor（間隔の伸び率）を持たせ、相対優先度キューで管理。「1 日に処理しきれない量が出てくるのが常態」という前提に立ち、auto-postpone は上位優先度だけ残して低優先度を先送りする（[SuperMemo: Priority queue](https://super-memory.com/archive/help15/priority.htm)）。
- 自由再生の粒度：文章全体を思い出す条件と節ごとに思い出す条件を比べた研究では、後日のテスト成績は「全体を思い出す」条件のほうが良かった（対象は ADHD のある学生。[PMC10715433](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10715433/)）。

### 推論・未確認
- 未確認：「1 日の学習記録全体を自由再生する」粒度に対して間隔反復アルゴリズムを当てた研究・実装の評価データは見つからなかった。FSRS のパラメータは一問一答カードの履歴から学習されたもので、トピック単位への転用は外挿。ただし FSRS が推定するのは「思い出せる確率」という抽象量なので、評価が一貫していれば大きく外れないだろう（推論）。
- FSRS の主な弱点はこのアプリでは軽い：カードが数千件あって毎日の負荷を削りたい場面で最も効く方式なので、日 1〜3 件しか増えないなら固定ラダーとの差は実効的に小さい。差が出るのは「遅延の扱い」と「個人差への適応」。

## 2. 評価の段階数

### 事実
- FSRS / Anki は 4 段階。Again = 忘れた。Hard = 思い出せたが手間取った（合格扱い）。Good = 普通に正解。Easy = 迷いなく即答。「忘れたのに Hard を押すと FSRS では間隔が不当に長くなる」と明記（[Deck Options](https://docs.ankiweb.net/deck-options.html)）。
- FSRS の最適化時、評価は二値に変換される（Again なら 0、それ以外は 1）（[Benchmark](https://expertium.github.io/Benchmark.html)）。
- Obsidian のノートレビューは 3 段階。

### 推論
- 3 段階（Again / Good / Easy）を推奨。自由再生で「手間取った」（Hard）と「思い出せた」（Good）の境界は主観的で日内変動に埋もれる。Anki 自身が Hard の誤用を警告している以上、境界が曖昧な選択肢は害になる。Again と Good の境界は二値の事実として定義できる。
- 境界の定義案（UI にそのまま出す文言）：
  - Again：本文を開いて「これ何だっけ」となった。主要な要点を 1 つも挙げられなかった。
  - Good：本文を開く前に、その日やったことの要点を 2〜3 個、自分の言葉で言えた。細部の抜けは許容。
  - Easy：ほぼ全部説明でき、しかも次に見るのは当分先でいいと自分で思える。
  - 「言えた要点の個数」という数えられる基準にするのがコツ（未確認：この基準を検証した研究はなく、設計提案）。
- ts-fsrs は 4 段階 API なので、UI の 3 ボタンを Again / Good / Easy にマップし、Hard は使わないだけで済む。

## 3. 運用上の問題を既存実装がどう扱っているか

(a) 溜まった復習（backlog）
- 事実：FSRS は遅延を減衰ペナルティではなく入力として扱う。遅延が伸びると Retrievability が下がり、それでも正解できたなら次の Stability はより高くなる（[fsrs4anki issue #691](https://github.com/open-spaced-repetition/fsrs4anki/issues/691)）。
- 事実：Anki 用の FSRS Helper アドオンは Postpone（先送り）機能を持つ（[fsrs4anki-helper](https://github.com/open-spaced-repetition/fsrs4anki-helper)）。
- 推論：本アプリでは「1 日の提示上限（例 10 件）」と「期限超過が長い順」で十分。減衰処理は FSRS に任せられる。

(b) 記録を後日「加筆修正」した場合
- 事実：Anki は編集しても履歴をリセットしない。作り変えた場合はユーザーが明示的に Reset を実行する（[Resetting progress](https://faqs.ankiweb.net/resetting-progress-in-a-deck.html)）。
- 推論：自動リセットは実装すべきでない。編集画面に「内容が大きく変わったので復習をやり直す」チェックを置き、既定オフ。

(c) Again を当日中に再提示するか（learning steps）
- 事実：Anki マニュアルは FSRS 使用時、learning steps を 1 日未満に保つことを推奨し、同日内の反復を増やしても長期記憶への寄与は小さいとしている（[Deck Options](https://docs.ankiweb.net/deck-options.html)）。
- 推論：本アプリは「1 日 1 セッション」運用なので、当日再提示は入れない。Again は翌日再提示（ts-fsrs の `enable_short_term: false`）。

(d) 同日作成カードの期限集中（load balancing / fuzz）
- 事実：Anki は 10 日の間隔なら 8〜12 日のどこかにランダムにずらす。Load Balanced Scheduler は同じ範囲から期限が最も少ない日を選ぶ（[load-balanced-scheduler](https://github.com/xquercus/load-balanced-scheduler/blob/master/README.md)）。
- 推論：ts-fsrs の `enable_fuzz: true` で足りる。日 1〜3 件なら本格的な load balancing は不要。

(e) 卒業（retire）
- 事実：Anki は最大間隔設定、suspend（保留）、leech（何度も失敗するカード）の自動保留を持つ。ts-fsrs も `maximum_interval` を持つ。
- 推論：「間隔が 365 日を超えたら自動アーカイブ」＋「手動の卒業ボタン」の二段構え。個人の学習記録は「覚え続ける価値がなくなる」ことがあるので手動卒業は必須。

## 4. 推奨する初期実装（1 案）と代替（1 案）

### 推奨案：ts-fsrs（FSRS-6）+ 3 ボタン評価 + 既定パラメータ固定
- ライブラリ設定：`enable_fuzz: true`、`enable_short_term: false`、`maximum_interval: 365`、`request_retention: 0.9`。
- 評価 UI：Again / Good / Easy の 3 ボタン。判定基準を短文で添える。
- 保存：カードごとに FSRS の状態（stability, difficulty, due, state, reps, lapses）と、レビューログ全件。ログを必ず残すことが将来の最適化と方式乗り換えの保険。
- backlog：1 日の提示上限、期限超過が長い順。
- 卒業：間隔 365 日超で自動アーカイブ＋手動の卒業ボタン。
- 編集：既定では履歴を維持。「作り直した」チェックで明示リセット。

利点：遅延を自前ロジックなしで扱える。データ 0 件から妥当に動く。fuzz・最大間隔・リセット・履歴再構築がライブラリ側にある。レビューが数百件溜まった時点で最適化へ移行できる。
欠点：依存が増える（Node 20+）。21 パラメータのブラックボックスで「なぜこの間隔か」を説明しにくい。トピック単位の自由再生に対する妥当性は未検証。最適化の効果は当分得られない。

### 代替案：固定ラダー（1-3-7-14-30-60-120-365 日）
Again で 1 段下がる、Good で 1 段上がる、Easy で 2 段上がる。期限超過は「超過日数が現在の間隔を超えたら 1 段下げる」等の単純規則、±5% の fuzz。
利点：挙動が完全に説明可能、依存ゼロ、100 行程度。欠点：個人差・項目差に適応しない、遅延の扱いを自分で設計、後で FSRS に移る際に過去ログの意味づけが変わる（ログさえあれば移行は可能）。

### 判断の分かれ目
「まずリリースして自分で使う」最優先なら代替案、「長く使い続けてデータを貯める」なら推奨案。両案ともレビューログの保存形式は同じにできるので、固定ラダーで始めて後から FSRS に差し替える道も現実的。推奨案を上に置いたのは、ts-fsrs の導入コストが実質「1 依存 + 数十行」で、固定ラダーを自作するコストとほぼ変わらないため。

## 未確認事項のまとめ
- トピック単位の自由再生に対する間隔反復アルゴリズムの比較評価（研究・実装とも見つからず）。
- 「言えた要点の個数」で Again/Good を切る基準の妥当性。
- FSRS-4 / 4.5 / 5 / 6 の数式レベルの差分（実装上は最新の ts-fsrs を使えば足りる）。
- Anki の「編集だけではスケジューリングが変わらない」は、リセット手順の記述からの推定を含む。

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
