# 調査ノート05：ts-fsrs実地検証（スパイク）

- 実施日：2026-09-15
- 作業物：`spikes/fsrs/`（Bunプロジェクト）。検証スクリプト `spikes/fsrs/simulate.ts`、実行結果の全文 `spikes/fsrs/output.txt`。
- 使用バージョン：`ts-fsrs@5.4.2`（`bun.lock` に固定）。実行時に自己申告するバージョン文字列は `v5.4.2 using FSRS-6.0`。Bun 1.2.15。
- 再現方法：`cd spikes/fsrs && TZ=Asia/Tokyo bun run simulate.ts`

## この文書の前提（読み始める人向け）

作ろうとしているのは、「今日やったこと」を1件ずつ記録して、後日その記録を再提示して思い出せるか確かめる個人用アプリ。
フラッシュカード（表と裏がある一問一答）ではなく、記録1件がそのまま復習の単位になる。
再提示の日付を決めるのに**FSRS-6**（Free Spaced Repetition Schedulerの第6版。記憶の状態を推定して次の復習日を出すアルゴリズム）を使う。
その公式TypeScript実装が `ts-fsrs`。前回の調査ノート04でこの採用を決めた。この文書は「実際に動かして挙動を確かめた記録」。

用語（この文書の中だけで通じればよいように、初出で説明する）：

- **stability（安定度）**：その記録を思い出せる確率が90%まで落ちるのにかかる日数。大きいほど間隔が伸びる。以下の表では `S` と書く。
- **difficulty（難しさ）**：記録ごとの覚えにくさ。1〜10の値。以下の表では `D` と書く。
- **retrievability（想起可能性）**：その時点で思い出せる確率の推定値。0〜1。以下の表では `R` と書く。
- **lapse（失敗）**：一度覚えたはずの記録を「思い出せなかった」と評価すること。回数が `lapses` に記録される。
- **fuzz**：算出した間隔に ±数日のランダムなばらつきを加えて、同じ日に期限が集中するのを防ぐ仕組み。
- **評価の対応**：UIの「思い出せなかった」= `Rating.Again`、「思い出せた」= `Rating.Good`、「余裕だった」= `Rating.Easy`。`Rating.Hard` は使わない。

検証で使った設定（本番で使う予定のもの）：

```ts
generatorParameters({
  request_retention: 0.9,   // 目標とする想起率
  maximum_interval: 365,    // 間隔の上限（日）
  enable_fuzz: true,        // 間隔をばらつかせる
  enable_short_term: false, // 当日中の再提示をしない
})
// w（21 個のパラメータ）は既定値のまま
```

日付はすべて「記録の作成日をDay 0」とした相対日で書く。検証では毎回09:00に復習したものとしている。

---

## 結論（先に）

1. **予定どおりの実装で問題なく作れる。**決めてあった設定（3段階評価、当日再提示なし、上限365日、目標想起率0.9、初回は作成翌日）はすべてts-fsrs 5.4.2でそのまま実現できた。ライブラリを書き換える必要はない。
2. **初回期限は自分で `due` を翌日に書き換えてよい。**新規状態の記録に対してts-fsrsは `due` を無視して計算するので、`createEmptyCard()` が作る「作成時刻＝期限」を「作成日の翌日」に上書きしても、初回の計算結果は1ビットも変わらない（検証済み）。
3. **fuzzの乱数は既定のままで再現可能。**既定のseed（乱数の種）は「復習時刻のミリ秒+復習回数+ difficulty×stability」から作られる決定的な値で、同じ入力なら必ず同じ結果になった。**`GenSeedStrategyWithCardId`（記録IDを種にする方式）は使ってはいけない**——履歴からの再構築時に記録IDが失われて別の間隔になる（後述(f)）。
4. **履歴からの再構築は「評価と復習時刻」だけあればできる。** `reschedule()` に `{ rating, review }` の列を渡すと、逐次計算した結果とstability・difficulty・reps・lapses・次回期限まで完全一致した。保存すべき最小列は「評価」と「復習時刻」の2つ。他の列（stabilityなど）は表示・分析用の冗長なコピーとして持つ。
5. **タイムゾーンに1つ実害のある落とし穴がある。** ts-fsrsは前回からの経過日数を**UTCの暦日**で数える。日本時間で使うと日付の変わり目が09:00になり、たとえば「昨夜22:00に復習 → 今朝07:00に復習」は経過0日と扱われ、次回間隔が9日ではなく3日になった。**対策：ts-fsrsに渡す復習時刻を「その学習日の12:00（ローカル）」に正規化してから渡す。**この正規化をラッパーの責務にする。
6. **1日10件の上限は、この運用ではほとんど発動しない。**毎日2件ずつ新規作成して全部「思い出せた」で進める90日運用では、1日の提示対象は平均5.87件、10件を超えたのは90日中3日だけだった。ただし最大は16件で、fuzzがあっても集中する日は出る。繰り越しは最大4件・翌日で解消した。
7. **「最初からやり直す」は `forget(card, now, true)` でよい。**結果は新規作成した記録と完全に同一（stability・difficulty・間隔・reps・lapsesすべて一致）。ただし `forget` が設定する期限は「今」なので、**そのあと `due` を翌日に書き換える必要がある**（新規作成と同じ扱い）。

---

## 1. 確認したAPIの事実

出典は2つだけ。`spikes/fsrs/node_modules/ts-fsrs/README.md`（以下「README」）と `spikes/fsrs/node_modules/ts-fsrs/dist/index.d.ts`（以下「型定義」）。実装の中身を読んだ箇所は `dist/index.mjs` と明記する。

### 1.1関数の対応（5.xでの名前）

型定義の `interface IFSRS` にある公開メソッドは以下がすべて。READMEのQuickstartと一致する。

| 用途 | 呼び方 | 戻り値 |
|---|---|---|
| スケジューラを作る | `fsrs(params?)` | `FSRS` クラスのインスタンス |
| 設定オブジェクトを完全な形で作る | `generatorParameters(partial?)` | `FSRSParameters` |
| 新規の記録を作る | `createEmptyCard(now?)` | `Card` |
| 4択すべての結果を先に見る | `scheduler.repeat(card, now)` | `IPreview`（`Rating` をキーにした4つの結果） |
| 評価が決まっている場合 | `scheduler.next(card, now, grade)` | `{ card, log }` |
| 直前の1回を取り消す | `scheduler.rollback(card, log)` | 巻き戻した `Card` |
| 最初からやり直す | `scheduler.forget(card, now, reset_count?)` | `{ card, log }` |
| 履歴から作り直す | `scheduler.reschedule(card, reviews, options?)` | `{ collections, reschedule_item }` |
| 今の想起可能性を見る | `scheduler.get_retrievability(card, now, false)` | `number`（0〜1） |

READMEより：「`fsrs()` already applies `generatorParameters()` internally, so in normal scheduler setup you can pass a partial parameter object directly to `fsrs()`.」つまり `fsrs({ ... })` で足りる。`generatorParameters()` を明示的に呼ぶのは、設定をJSONとして保存・復元したいときだけ。

READMEより：「Use `repeat` when you want to preview all four outcomes before the user answers. Use `next` when you already know the selected rating.」
このアプリでは「3つのボタンにそれぞれ次回の日付を出す」なら `repeat`、出さないなら `next` だけでよい。`repeat` は内部で4択すべてを計算するだけなので、どちらを使っても保存される結果は同じ。

`repeat` の実測（Day 1に初回提示した場合）：

| 押したボタン | 次回 | 間隔 | S | D |
|---|---|---|---|---|
| 思い出せなかった(Again) | Day 2 | 1日 | 0.2120 | 6.4133 |
| （使わない）Hard | Day 3 | 2日 | 1.2931 | 5.1122 |
| 思い出せた(Good) | Day 4 | 3日 | 2.3065 | 2.1181 |
| 余裕だった(Easy) | Day 11 | 10日 | 8.2956 | 1.0000 |

### 1.2 `enable_short_term: false` のときの「思い出せなかった」の挙動

型定義のコメントより：「When enable_short_term = false, the (re)learning steps are not applied.」
`learning_steps` / `relearning_steps`（既定は `['1m','10m']` と `['10m']`）は設定オブジェクトには残るが、無視される。

実測（同じ記録に対して設定だけ変えて比較）：

| 場面 | `enable_short_term: true`（既定） | `enable_short_term: false`（採用する設定） |
|---|---|---|
| 新規の記録に「思い出せなかった」 | 1分後に再提示、状態Learning | 翌日（Day 1に押してDay 2）、状態Review |
| 新規の記録に「思い出せた」 | 10分後に再提示、状態Learning | Day 4（3日後）、状態Review |
| 成熟した記録（S≈57）に「思い出せなかった」 | 10分後に再提示、状態Relearning | 3日後、状態Review |

**このアプリにとっての意味**：`enable_short_term: false` なら、状態はNewとReviewの2つしか現れない。Learning / RelearningをUIやデータ設計で考慮しなくてよい。「思い出せなかった」を押しても必ず翌日以降に回る。

型定義の `next_forget_stability` のコメントにも差が明記されている。失敗後のstabilityの上限が、`true` のときは `S / e^(w17·w18)`、`false` のときは `S` そのもの。つまり `false` では「失敗してもstabilityは今より増えない」という素直な上限になる。

### 1.3新規の記録の初期状態と「作成翌日に初回提示」

`createEmptyCard(Day 0)` の中身（実測）：`state=New`、`reps=0`、`lapses=0`、`stability=0`、`difficulty=0`、`last_review=undefined`、`due=Day 0`（渡した時刻そのもの）。

`due` を自分で書き換えてよいかを実測で確認した。

- `due` をDay 0のままDay 1に「思い出せた」→ 次回Day 4、S=2.3065
- `due` をDay 1に書き換えてDay 1に「思い出せた」→ 次回Day 4、S=2.3065
- **完全一致**

理由は実装で確認できる（`dist/index.mjs` の `AbstractScheduler.init`）。経過日数は `state !== State.New && last_review` のときだけ計算され、新規状態では0に固定される。`due` は読まれない。

**このアプリにとっての意味**：記録を作るときに `createEmptyCard(作成時刻)` を呼び、`due` を作成日の翌日に上書きして保存すればよい。初回提示時は `next(card, 提示時刻, 評価)` を普通に呼ぶだけで、State.Newを明示的に渡すような特別扱いは不要（`Card` に `state` が入っているので、ライブラリ側が自動で新規用の経路に入る）。

### 1.4 `reschedule` による履歴からの再構築

型定義：

```ts
reschedule<T>(current_card: CardInput | Card, reviews?: FSRSHistory[],
              options?: Partial<RescheduleOptions<T>>): IReschedule<T>
```

`FSRSHistory` は最低限 `{ rating: Grade, review: DateInput }` があればよい（残りのフィールドはすべて任意）。
`options` で使うのは3つ：`first_card`（再構築の出発点になる記録。省略すると `createEmptyCard()` が使われ、期限が「今」になる）、`now`、`update_memory_state`。

実装（`dist/index.mjs` の `Reschedule.reschedule`）は、履歴を1件ずつ `this.fsrs.next(card, review.review, review.rating)` に流し込むだけ。つまり**逐次計算と同じ関数を同じ順で呼び直している**。だから一致するのは当然だが、seedの作られ方によってはfuzzだけずれる（次項）。

**保存すべきログの列**：再構築に必要なのは `rating` と `review`（復習した時刻）だけ。
ts-fsrsが返す `ReviewLog` には以下が入る（実測でキーを列挙した）：
`rating, state, due, stability, difficulty, elapsed_days, last_elapsed_days, scheduled_days, learning_steps, review`。
ただし型定義で `elapsed_days` と `last_elapsed_days` は**`@deprecated`（バージョン6.0.0で削除予定）**と明記されている。この2列を再構築の前提にしてはいけない。

なお `ReviewLog` の `state` と `stability` / `difficulty` は**復習する前の値**が入る（実測：初回復習のログは `state=0 (New)`、`stability=0`）。後の値を見たいなら `card` のほうを保存する。

### 1.5 `forget`（最初からやり直す）

実装（`dist/index.mjs` の `FSRS.forget`）が返す記録は：`due = now`、`stability = 0`、`difficulty = 0`、`elapsed_days = 0`、`scheduled_days = 0`、`learning_steps = 0`、`state = State.New`、`last_review` は**そのまま残る**。`reps` と `lapses` は `reset_count` が `true` のときだけ0になる。

実測（「思い出せた」3回のあとDay 30に実行）：

| 呼び方 | state | due | S | D | reps | lapses |
|---|---|---|---|---|---|---|
| `forget(card, Day 30, false)` | New | Day 30 | 0 | 0 | 3（残る） | 0 |
| `forget(card, Day 30, true)` | New | Day 30 | 0 | 0 | 0 | 0 |

`forget` が返すログは `rating = Rating.Manual`（= 0、人手による操作を表す特別な値）。

リセット後に再学習させた結果（実測）：

| 条件 | 間隔 | S | D | reps | lapses |
|---|---|---|---|---|---|
| `forget(…, true)` 後の初回「思い出せた」 | 3日 | 2.3065 | 2.1181 | 1 | 0 |
| 新規作成した記録の初回「思い出せた」 | 3日 | 2.3065 | 2.1181 | 1 | 0 |

**このアプリにとっての意味**：「最初からやり直す」は `forget(card, now, true)` で実現でき、結果は新規作成と区別がつかない。ただし `forget` は期限を「今」にするので、決めてある「初回期限は翌日」に合わせるには**`due` を翌日に書き換える**必要がある。
また、`reschedule` に渡す履歴から `Rating.Manual` のログは既定で除外される（`skipManual` の既定値が `true`）。したがって「リセット後の履歴だけで再構築する」なら、リセット時刻より後のログだけをアプリ側で絞って渡すのが確実。

### 1.6 `rollback`（直前の1回を取り消す）

実測：「思い出せた」を1回押した直後に `rollback(card, log)` を呼ぶと、期限Day 4 → Day 1、状態Review → New、`reps` 1 → 0に戻った。
**このアプリにとっての意味**：「押し間違えた」の取り消しに使える。ただし追記専用の履歴を持つ以上、「最後のログを削除してから `reschedule` で作り直す」でも同じことができる。`rollback` は1回分しか戻せないので、取り消しの汎用手段としては `reschedule` のほうが素直。

### 1.7 fuzzの乱数を固定できるか

**できる。しかも既定のままで固定されている。**

実装（`dist/index.mjs` の `DefaultInitSeedStrategy`）：

```js
function DefaultInitSeedStrategy() {
  const time = this.review_time.getTime();
  const reps = this.current.reps;
  const mul = this.current.difficulty * this.current.stability;
  return `${time}_${reps}_${mul}`;
}
```

乱数はalea（seed文字列から決まる疑似乱数生成器）で、`apply_fuzz` は1回だけ乱数を引く。したがって「同じ復習時刻・同じ回数・同じ記憶状態」なら必ず同じ間隔になる。
実測：同じ入力で2回走らせた10回分の結果が完全に一致した（間隔列 `3,14,55,193,359,364,366,360,366,354` が2回とも同じ）。

型定義には `StrategyMode.SEED` と `GenSeedStrategyWithCardId(field)` という差し替え手段もあるが、**これは使わないほうがよい**。理由は次の(f)を参照。

### 1.8日時の扱いとタイムゾーン

`Date` をそのまま渡してよい（`DateInput = Date | number | string`）。ただし**経過日数の数え方に注意がいる**。

実装（`dist/index.mjs`）には日数計算が2種類ある。

- `dateDiffInDays(last, cur)`：**UTCの暦日**に丸めてから差を取る。スケジューラが前回の復習からの経過日数を出すのに使う。
- `date_diff(now, pre, 'days')`：ミリ秒差を86400000で割って切り捨て。`forget` の `scheduled_days` などに使う。

前者が実害を生む。日本時間（UTC+9）ではUTCの日付の変わり目が09:00なので、09:00より前の復習は「前日」として数えられる。

実測（TZ=Asia/Tokyo、1回目も2回目も「思い出せた」）：

| 1回目 | 2回目 | 経過日数 | 2回目の次回間隔 |
|---|---|---|---|
| 1/1 22:00 | 1/2 07:00 | **0日** | **3日** |
| 1/1 22:00 | 1/2 10:00 | 1日 | 9日 |
| 1/1 12:00 | 1/2 12:00 | 1日 | 5日 |
| 1/1 01:00 | 1/2 01:00 | 1日 | 7日 |

（同じ経過1日でも間隔が9・5・7日とばらつくのはfuzzによる。ここで見るべきは1行目だけが経過0日になっている点。）

**対策（推奨）**：ts-fsrsに渡す復習時刻を「その学習日の12:00（ローカル時刻）」に正規化してから渡す。12:00ならUTCに直しても同じ日付に収まる（日本時間なら03:00 UTC）ので、学習日とUTC暦日が1対1に対応する。
実測：1/1 22:00と1/2 07:00を正規化すると1/1 12:00と1/2 12:00になり、経過日数は正しく1になった。1/3 01:00は（午前4時境界により）学習日1/2とみなされ1/2 12:00に正規化され、1/2 07:00との経過日数は0になった。

**午前4時境界について**：「今日の分」を決めるには、質問のとおり「今日04:00 〜 翌日03:59」の窓で期限を判定すれば足りる。ts-fsrs側には一切の設定が要らない。実測した窓の計算：

| 現在時刻 | 学習日の窓 |
|---|---|
| 3/1 01:00 | [2/28 04:00, 3/1 04:00) |
| 3/1 03:59:59 | [2/28 04:00, 3/1 04:00) |
| 3/1 04:00 | [3/1 04:00, 3/2 04:00) |
| 3/1 23:30 | [3/1 04:00, 3/2 04:00) |

ただし前段の経過日数の問題があるので、**「窓で期限を判定する」だけでは不十分で、「ts-fsrsに渡す時刻を正規化する」もセットで要る**。この2つは別の問題。

---

## 2. シミュレーション結果

条件は全ケース共通で：`request_retention: 0.9`、`maximum_interval: 365`、`enable_fuzz: true`、`enable_short_term: false`、パラメータ既定値、タイムゾーンAsia/Tokyo。記録はDay 0に作成し、初回期限はDay 1。復習は各日の09:00。`R提示時` はその記録を提示した瞬間の想起可能性（初回は前回がないので「-」）。

### (a)毎回「思い出せた」を押し続けた場合（期限ちょうどに復習、10回）

| 回 | 提示日 | 間隔（日） | 次回 | S | D | R提示時 |
|---|---|---|---|---|---|---|
| 1 | Day 1 | 3 | Day 4 | 2.307 | 2.118 | - |
| 2 | Day 4 | 14 | Day 18 | 13.827 | 2.111 | 0.881 |
| 3 | Day 18 | 55 | Day 73 | 56.957 | 2.104 | 0.899 |
| 4 | Day 73 | 193 | Day 266 | 192.711 | 2.097 | 0.902 |
| 5 | Day 266 | 359 | Day 625 | 577.851 | 2.091 | 0.900 |
| 6 | Day 625 | 364 | Day 989 | 1249.850 | 2.084 | 0.929 |
| 7 | Day 989 | 366 | Day 1355 | 1928.011 | 2.077 | 0.962 |
| 8 | Day 1355 | 360 | Day 1715 | 2590.791 | 2.070 | 0.974 |
| 9 | Day 1715 | 366 | Day 2081 | 3226.147 | 2.063 | 0.980 |
| 10 | Day 2081 | 354 | Day 2435 | 3856.733 | 2.056 | 0.984 |

読み取り（推論）：

- 間隔は3日 → 2週間 → 2か月 → 半年強と伸び、**5回目以降は上限365日の付近に貼り付く**（350〜367日でばらつくのはfuzz）。
- 365日をわずかに超える値（366・367日）が出るのはfuzzのせいではなく、実装が「Again < Hard < Good < Easyの順序」を強制するため。実装（`dist/index.mjs`）は `good_interval = Math.max(good_interval, hard_interval + 1)` のように1日ずつ押し上げるので、4択すべてが上限に達すると「思い出せた」は上限+2日、「余裕だった」は上限+3日になりうる。**実用上の影響はないが、「期限は絶対に365日以内」という不変条件をアプリ側で仮定してはいけない。**
- 上限に貼り付いてからは提示時の想起可能性が0.93 → 0.98と上がっていく。目標の0.9より高い＝「本当はもっと空けてよいのに1年で呼び戻している」状態。これは `maximum_interval: 365` を決めた時点で意図した挙動（1年に1回は必ず目に入れる）。
- **1件の記録が一生のうちに要求する復習は、4回目まででDay 266まで到達する。**つまり最初の1年で4〜5回、以後は年1回。これがこのアプリの負荷の基本単位。

### (b)毎回「余裕だった」を押し続けた場合（同条件）

| 回 | 提示日 | 間隔（日） | 次回 | S | D | R提示時 |
|---|---|---|---|---|---|---|
| 1 | Day 1 | 10 | Day 11 | 8.296 | 1.000 | - |
| 2 | Day 11 | 73 | Day 84 | 75.348 | 1.000 | 0.887 |
| 3 | Day 84 | 361 | Day 445 | 437.093 | 1.000 | 0.902 |
| 4 | Day 445 | 365 | Day 810 | 1829.937 | 1.000 | 0.913 |
| 5 | Day 810 | 350 | Day 1160 | 3223.501 | 1.000 | 0.973 |
| 6 | Day 1160 | 354 | Day 1514 | 4490.289 | 1.000 | 0.985 |
| 7 | Day 1514 | 362 | Day 1876 | 5719.793 | 1.000 | 0.989 |
| 8 | Day 1876 | 367 | Day 2243 | 6936.408 | 1.000 | 0.992 |
| 9 | Day 2243 | 353 | Day 2596 | 8136.833 | 1.000 | 0.994 |
| 10 | Day 2596 | 366 | Day 2962 | 9266.390 | 1.000 | 0.994 |

読み取り（推論）：

- difficultyが初回で下限の1.000に張り付く。「余裕だった」を1回押しただけで、その記録は「最も簡単な記録」として扱われる。
- **3回目で上限に到達する。**「余裕だった」を3回押せば、その記録は事実上「年1回だけ見るもの」になる。
- 「思い出せた」との差は最初の1年で大きい（(a)はDay 1・4・18・73・266の5回、(b)はDay 1・11・84・445の4回）。「余裕だった」は3回目の復習をDay 84に置いたあと1年空ける。
- **設計上の含意**：3段階のうち「余裕だった」は強力すぎるほど効く。UIの説明文で「これを押すと次はかなり先になる」ことを伝えたほうがよい（推論。ユーザー行動の検証はしていない）。

### (c) 「思い出せた」×3 →「思い出せなかった」→「思い出せた」×3

| 回 | 提示日 | 評価 | 間隔（日） | 次回 | S | D | R提示時 | lapses |
|---|---|---|---|---|---|---|---|---|
| 1 | Day 1 | 思い出せた | 3 | Day 4 | 2.307 | 2.118 | - | 0 |
| 2 | Day 4 | 思い出せた | 14 | Day 18 | 13.827 | 2.111 | 0.881 | 0 |
| 3 | Day 18 | 思い出せた | 55 | Day 73 | 56.957 | 2.104 | 0.899 | 0 |
| 4 | Day 73 | **思い出せなかった** | **3** | Day 76 | **3.175** | **7.390** | 0.902 | 1 |
| 5 | Day 76 | 思い出せた | 9 | Day 85 | 8.066 | 7.378 | 0.904 | 1 |
| 6 | Day 85 | 思い出せた | 21 | Day 106 | 20.076 | 7.366 | 0.892 | 1 |
| 7 | Day 106 | 思い出せた | 45 | Day 151 | 44.701 | 7.354 | 0.897 | 1 |

読み取り（事実と推論を分けて）：

- 事実：**間隔は55日から3日まで戻る。**stabilityは56.957 → 3.175（約18分の1）。difficultyは2.104 → 7.390と大きく上がる（1〜10の範囲で中央より上）。
- 事実：復帰は速い。9日 → 21日 → 45日と、3回で失敗前の55日近く（45日）まで戻る。
- 事実：ただしdifficultyが7.35付近に残り続けるので、同じ「思い出せた」でも失敗前より間隔の伸び方が鈍い（失敗前は3→14→55日、失敗後は9→21→45日）。difficultyは「思い出せた」を押しても1回あたり0.012程度しか下がらない。「余裕だった」を押さない限り、上がったdifficultyはほぼ戻らない。
- 推論：**1回の失敗は「その記録を数日おきに3〜4回見直す」コストとして現れる。**アプリの負荷見積もりでは、失敗1回あたり追加3回の提示を見込むとよい。
- 推論：difficultyが戻りにくいのは、「その記録は自分にとって難しい」という判定が持続することを意味する。これは望ましい挙動だが、「一度失敗した記録は永久に頻繁に出る」と感じられる可能性がある。気になるなら「余裕だった」を押せばdifficultyが下がることをUIで伝える。

### (d)期限どおりに押した場合と、期限を7日過ぎてから押した場合

条件：1〜3回目は期限どおり「思い出せた」。4回目だけ、片方は期限どおり（Day 73）、もう片方は7日遅れ（Day 80）。5回目は再び期限どおり。

| 条件 | 4回目の提示日 | 提示時のR | 4回目の次回間隔 | 直後のS | 5回目の次回間隔 |
|---|---|---|---|---|---|
| 期限どおり | Day 73 | 0.902 | 193日 | 192.711 | 359日 |
| 期限+7日 | Day 80 | 0.894 | **213日** | 204.773 | 358日 |

読み取り：

- 事実：**遅れて押したほうが次回間隔が長くなる**（193日 → 213日、約10%増）。罰ではなく報酬になっている。
- 事実：遅れによって想起可能性の推定が0.902 → 0.894と下がり、「その低い確率でも思い出せた」という情報がstabilityを押し上げている（192.7 → 204.8）。
- 推論：**溜まった復習を後からまとめて消化しても、スケジュールは壊れない。**アプリ側で「遅延に対するペナルティ」や「期限切れの再計算」を実装する必要はまったくない。ただし遅れたぶん次が先に延びるので、長く放置した記録が「もう出てこない」ように見えることはある。
- 未確認：7日を大きく超える遅延（数か月〜年単位）や、遅れて「思い出せなかった」を押した場合は測っていない。

### (e)毎日2件ずつ新規作成し、全部「思い出せた」で90日運用

条件：Day 0からDay 89まで毎日2件作成（合計180件）。各記録の初回期限は作成翌日。毎日、期限が来ているものを「期限超過が長い順」に処理。上限なしの場合と、上限10件の場合（超過分は翌日以降に繰り越し）を別々に走らせた。

5日おきの抜粋：

| Day | 上限なし・提示対象 | 上限あり・提示対象 | 上限あり・実施 | 上限あり・繰越 |
|---|---|---|---|---|
| 0 | 0 | 0 | 0 | 0 |
| 5 | 4 | 4 | 4 | 0 |
| 10 | 4 | 4 | 4 | 0 |
| 15 | 4 | 4 | 4 | 0 |
| 20 | 6 | 6 | 6 | 0 |
| 25 | 6 | 6 | 6 | 0 |
| 30 | 4 | 4 | 4 | 0 |
| 35 | 6 | 6 | 6 | 0 |
| 40 | 10 | 10 | 10 | 0 |
| 45 | 6 | 6 | 6 | 0 |
| 50 | 6 | 8 | 8 | 0 |
| 55 | 6 | 6 | 6 | 0 |
| 60 | 4 | 4 | 4 | 0 |
| 65 | 6 | 6 | 6 | 0 |
| 70 | 6 | 6 | 6 | 0 |
| 75 | 8 | 8 | 8 | 0 |
| 80 | 8 | 8 | 8 | 0 |
| 85 | 6 | 6 | 6 | 0 |

集計（事実）：

- 上限なし：1日の提示対象は平均5.87件、最大16件。90日で延べ528件を復習（新規作成は180件）。
- 10件を超えた日は90日中**3日だけ**：Day 33（12件）、Day 73（12件）、Day 88（16件）。
- 上限10件を適用した場合：繰り越しが出たのは4日（Day 33に2件、Day 73に2件、Day 88に4件、Day 89に4件）。Day 33とDay 73の繰り越しは翌日に解消した。Day 88・89の繰り越しは90日目の打ち切り時点で残っている（前日の16件の余りが翌日に押し出されたもの）。
- 上限ありの延べ復習件数は524件。上限なしとの差は4件（未消化の繰り越し）。

読み取り（推論）：

- **上限10件はほとんど発動しない安全弁として機能する。**90日中87日は上限に触れない。したがって「上限を設けたせいで復習が溜まり続ける」ことは、この負荷（毎日2件）では起きない。
- 提示件数は4〜8件の間を上下し、ときどき跳ねる。跳ねるのはfuzzを入れてもなお、同じ日に作った記録が同じ間隔で戻ってくるため。**負荷を平準化したいなら、fuzz以上の仕組み（load balancing）が要る**が、この負荷では不要と判断できる。
- Day 88の16件は、Day 73前後に作られた記録の2回目（間隔14日前後）と、Day 33前後の記録の3回目（間隔55日前後）と、その日の新規が重なった結果。**運用が長くなると、こうした重なりの頻度は上がる。**90日より先は測っていない（未確認）。
- 日2件の運用なら、1日あたりの復習は6件前後。1件1〜2分としてセッションは10分前後。上限を10件に置くのは妥当な水準（推論）。

### (f)履歴からの再構築が逐次計算と一致するか

条件：「思い出せた」×3 →「思い出せなかった」→「思い出せた」×4の計8回。逐次 `next()` で進めた結果と、そのログから `{ rating, review }` だけを取り出して `reschedule()` に流した結果を比較した。

**(f-1)記録IDでseedを固定した場合（`GenSeedStrategyWithCardId('card_id')` を使った場合）**

| 方法 | 次回 | S | D | reps | lapses | state |
|---|---|---|---|---|---|---|
| 逐次計算 | Day 213 | 75.925599 | 7.341402 | 8 | 1 | Review |
| reschedule | **Day 215** | 75.925599 | 7.341402 | 8 | 1 | Review |

**一致しない。**記憶状態（S・D）と回数は一致するが、次回期限が2日ずれる。
原因は実装を読めば分かる（`dist/index.mjs` の `Reschedule.reschedule`）。再構築は `createEmptyCard(current_card.due)` で出発点を作り直すので、`card_id` のような**独自に足したフィールドが落ちる**。するとseedが `card_id=0` として計算され、fuzzのばらつきが逐次計算時と変わる。

**(f-2)既定のseedをそのまま使った場合**

**完全に一致した**（次回期限・S・D・reps・lapses・stateのすべて）。
既定のseedは復習時刻・回数・記憶状態から作られ、これらはすべて再構築時にも同じ値になるため。

**このアプリにとっての意味（結論）**：

- **`StrategyMode.SEED` は差し替えない。既定のままにする。**これで「履歴から作り直しても同じ日付になる」が保証され、しかもテストは再現可能になる。
- 保存すべきログの最小列は `rating` と `review`（復習時刻）の2つ。
- `reschedule` を呼ぶときは `options.first_card` に「初回期限を翌日にした新規記録」を渡す。渡さないと出発点の期限が「今」になる。

### (g)午前4時境界

1.8節の表を参照。窓の計算だけで足り、ts-fsrs側の設定は不要。ただしts-fsrsに渡す時刻の正規化が別途必要（同節）。

---

## 3. 本番実装用の薄いラッパーの設計案

以下は提案であって、実装はしていない。

### 3.1方針

ラッパーが負う責任は4つに絞る。

1. **時刻の正規化**：アプリの「学習日」（午前4時境界）と、ts-fsrsが使う「UTC暦日」のずれを吸収する。ts-fsrsに渡す時刻はすべて「学習日の12:00（ローカル）」に揃える。
2. **初回期限の規約**：新規作成とリセットの直後は、期限を「その学習日の翌日」に置く。
3. **設定の一元化**：`fsrs()` の引数を1か所に固定し、seed戦略は差し替えない。
4. **型の橋渡し**：ts-fsrsの `Card` / `ReviewLog` と、アプリの保存形式（`Date` ではなくISO文字列や数値）を相互変換する。

ラッパーが負わない責任：遅延の補正（ts-fsrsが吸収する）、上限10件の絞り込み（アプリの提示ロジック側の仕事）、優先順位付け。

### 3.2関数一覧

```ts
/** 復習の評価。UI の 3 ボタンに 1 対 1 で対応する。 */
type ReviewGrade = 'forgot' | 'recalled' | 'easy'
//                 思い出せなかった | 思い出せた | 余裕だった

/** アプリが保存するスケジュール状態。ts-fsrs の Card と 1 対 1。 */
type ScheduleState = {
  due: Date              // 次回の期限
  stability: number      // 安定度（90% まで落ちる日数）
  difficulty: number     // 難しさ 1〜10
  scheduledDays: number  // 前回決めた間隔（日）
  reps: number           // 通算の復習回数
  lapses: number         // 通算の失敗回数
  state: 'new' | 'review' // enable_short_term: false なのでこの 2 つだけ
  lastReview: Date | null
}

/** 追記専用の復習ログ 1 件。再構築に必要なのは grade と reviewedAt だけ。 */
type ReviewLogEntry = {
  grade: ReviewGrade
  reviewedAt: Date       // 正規化前の実時刻
  // 以下は表示・分析用の冗長なコピー（再構築には使わない）
  stabilityAfter: number
  difficultyAfter: number
  scheduledDaysAfter: number
  dueAfter: Date
}

/** 新規記録を作る。初回期限は createdAt の学習日の翌日。 */
function createSchedule(createdAt: Date): ScheduleState

/** 1 回分の復習を適用する。now は実時刻でよい（内部で正規化する）。 */
function scheduleNext(
  state: ScheduleState,
  grade: ReviewGrade,
  now: Date,
): { state: ScheduleState; log: ReviewLogEntry }

/** 3 ボタンそれぞれの「次はいつになるか」を先に計算する（UI 表示用）。 */
function previewNext(
  state: ScheduleState,
  now: Date,
): Record<ReviewGrade, { due: Date; intervalDays: number }>

/** 追記専用ログから現在のスケジュール状態を作り直す。
 *  logs は「最後のリセット以降」だけを、時刻の昇順で渡すこと。 */
function rebuildFromLogs(createdAt: Date, logs: ReviewLogEntry[]): ScheduleState

/** 最初からやり直す。結果は新規作成した記録と同一になる。 */
function reset(state: ScheduleState, now: Date): ScheduleState

/** 学習日の窓（既定は午前 4 時から翌午前 4 時まで）。 */
function dueWindow(now: Date, boundaryHour = 4): { start: Date; end: Date }

/** ts-fsrs に渡すための正規化時刻（学習日の 12:00）。 */
function normalizeReviewInstant(now: Date, boundaryHour = 4): Date

/** 今この瞬間に思い出せる確率の推定値（0〜1）。表示用。 */
function retrievability(state: ScheduleState, now: Date): number | null
```

提示対象の選び方（ラッパーの外、アプリ側のクエリ）：

```ts
// 学習日の窓の終わり（翌 04:00）より前に期限が来ているものを、
// 期限が古い順（＝超過が長い順）に、最大 10 件。
const { end } = dueWindow(now)
const todo = records
  .filter(r => r.schedule.due < end)
  .sort((a, b) => a.schedule.due.getTime() - b.schedule.due.getTime())
  .slice(0, 10)
```

### 3.3保存するテーブルの列（提案）

**記録本体（`records`）にスケジュール状態を持たせる場合の追加列**：

| 列 | 型 | 由来 | 備考 |
|---|---|---|---|
| `due_at` | TIMESTAMP | `Card.due` | 提示対象の絞り込みに使う。索引を張る |
| `stability` | REAL | `Card.stability` | |
| `difficulty` | REAL | `Card.difficulty` | |
| `scheduled_days` | INTEGER | `Card.scheduled_days` | 前回決めた間隔 |
| `reps` | INTEGER | `Card.reps` | |
| `lapses` | INTEGER | `Card.lapses` | |
| `state` | TEXT | `Card.state` | `'new'` / `'review'` のみ |
| `last_review_at` | TIMESTAMP NULL | `Card.last_review` | |
| `schedule_reset_at` | TIMESTAMP NULL | アプリ独自 | 最後にリセットした時刻。再構築時にこれ以降のログだけを使う |

この9列は、後述の `review_logs` から再構築できる**派生データ**。壊れたら作り直せる。`due_at` に索引を張るための実体化と考える。

**復習ログ（`review_logs`、追記専用）**：

| 列 | 型 | 必須か | 備考 |
|---|---|---|---|
| `id` | INTEGER PK | — | |
| `record_id` | INTEGER FK | **再構築に必須** | |
| `grade` | TEXT | **再構築に必須** | `'forgot'` / `'recalled'` / `'easy'` |
| `reviewed_at` | TIMESTAMP | **再構築に必須** | 実時刻をそのまま保存。正規化はラッパーが読み出し時に行う |
| `study_day` | DATE | 任意 | 午前4時境界で決めた学習日。集計用 |
| `stability_after` | REAL | 冗長 | 復習「後」の値。グラフ用 |
| `difficulty_after` | REAL | 冗長 | 同上 |
| `scheduled_days_after` | INTEGER | 冗長 | このとき決めた間隔 |
| `due_after` | TIMESTAMP | 冗長 | このとき決めた次回期限 |
| `elapsed_days` | INTEGER | **入れない** | ts-fsrsで `@deprecated`（6.0.0で削除予定）。必要なら `reviewed_at` の差から計算する |

注意点を2つ：

- ts-fsrsの `ReviewLog` に入る `state` / `stability` / `difficulty` は**復習する前**の値。上の表で `_after` と名付けたものは `ReviewLog` からではなく、`next()` が返す `card` のほうから取る。
- リセット（`forget`）は復習ではないので `review_logs` には入れず、`records.schedule_reset_at` に記録する。`reschedule` は既定で手動操作のログを捨てるため、ログに混ぜると扱いが分かりにくくなる。

### 3.4スケジューラの設定（1か所に固定）

```ts
import { fsrs } from 'ts-fsrs'

export const scheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 365,
  enable_fuzz: true,
  enable_short_term: false,
  // w（21 パラメータ）は既定値。seed 戦略は差し替えない（(f) の理由による）
})
```

---

## 4. 確認できなかったこと・やっていないこと

- **90日より先の負荷**は測っていない。(e)のDay 88に16件の山が出たのは、複数世代の復習が重なった結果。1年・3年スケールで山がどこまで高くなるかは未確認。上限10件で足りるかどうかの最終判断には、もっと長い期間の試算が要る。
- **失敗を含む運用の負荷**は測っていない。(e)はすべて「思い出せた」で走らせた。実際には失敗が混ざり、(c)の結果からすると失敗1回につき追加3回前後の提示が発生する。現実の負荷はこの試算より高い。
- **数か月〜年単位の遅延**の挙動は測っていない。(d)で確かめたのは7日の遅れだけ。
- **遅れて「思い出せなかった」を押した場合**は測っていない。
- **パラメータの最適化**（`@open-spaced-repetition/binding` を使った個人履歴からの再学習）は一切触っていない。調査ノート04の方針どおり、当面やらない。
- **`reschedule` の `update_memory_state` を `false` にした場合**の挙動は比べていない。(f)では `true` で一致を確認した。
- **夏時間のあるタイムゾーン**は考えていない。日本時間（UTC+9、夏時間なし）を前提にしている。夏時間のある地域では、1.8節の「12:00に正規化」がずれる可能性がある（未検証）。
- `simulate.ts` は使い捨てのスクリプトで、TypeScriptの厳格な型チェック（`tsc --noEmit`）は通していない（配列の添字アクセスに関する警告が出る）。実行には支障がない。ライブラリ側の型の問題ではない。
