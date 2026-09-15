# 調査ノート01：先行事例（ノート単位・トピック単位の間隔反復）

- 調査日：2026-09-15
- 作成：Claude Codeのサブエージェント（Sonnet）によるWeb調査を、司令塔（Fable）が体裁のみ整えて保存。内容の事実確認は出典URLに依る。
- 目的：本プロジェクト（「今日やったこと」を記録単位にして間隔反復で再提示するローカルアプリ）と同じ思想の既存ツールから、借りるべきUXと避けるべき失敗を抽出する。

## 結論（借りるべきパターンの要約）

近い前例は「ノート単位／ハイライト単位の間隔反復」に集約される。ObsidianのSpaced Repetition系プラグイン、ReadwiseのDaily Review、SuperMemoのincremental readingが三本柱。借りるべき点は次の4つ。

1. 復習単位を記録の全文（または要約）にし、穴埋めせず「読んで自己評価するだけ」にする（Obsidianノート単位レビュー、Readwise方式）。
2. 1日の提示件数に上限をつける（新規・期限混在の比率を固定するなど）。上限がないと「溜まって挫折」が起きる。
3. 評価は3〜4段階程度の粗い自己申告にとどめ、細かい採点基準を作らない。
4. 記録データはプレーンテキスト（Markdown＋メタデータ）に間隔反復の状態を同居させ、可搬性を確保する。

避けるべき最大の失敗は「復習が溜まって心理的負債になり、離脱する」こと。間隔反復系アプリ全般で繰り返し指摘されている構造的な問題であり、日次上限・期限を過ぎたら緩めるなどの「借金を作らない」設計が要る。

## 事実（出典付き）

**① Obsidian Spaced Repetitionプラグイン（ノート単位レビュー）**
公式プラグイン（st3v3nmw/obsidian-spaced-repetition）は、フラッシュカードとは別に「ノート全体」をSM-2変種の間隔反復スケジュールに乗せる機能を持つ。ノートに `#review` タグを付けるとReview Queueに入り、開いて読んだあとEasy/Good/Hardの3段階で評価すると次の期限がノートのfrontmatter（メタデータ）に書き込まれる。内容を隠す仕組みはなく、ノートをそのまま開いて読む方式。1日の件数上限の記載は見当たらなかった（未確認）。
[Note Review Queue](https://stephenmwangi.com/obsidian-spaced-repetition/notes/) / [プラグイン議論](https://github.com/st3v3nmw/obsidian-spaced-repetition/discussions/1190)

派生プラグイン（open-spaced-repetition/obsidian-spaced-repetition-recall）は、期限が来たノートと新規ノートを既定で3:2の比率で混ぜてキューに出す設計を持ち、スケジュール情報をノート本体ではなく別ファイル（tracked_files.json）に保存する選択肢もある。アルゴリズムもDefault/Anki/FSRSから選べる。
[GitHub](https://github.com/open-spaced-repetition/obsidian-spaced-repetition-recall)

**② ReadwiseのDaily Review（ハイライト単位）**
読書アプリで取ったハイライトを毎朝少数だけメールやアプリで再提示する。選定は間隔反復だが、独自の「ブラックボックス」なアルゴリズム（開発元はAnki/SuperMemoより学習コストを下げることを狙ったと明言）。テーマ別に頻度を調整できる「Themed Review」もある。
[Adding Intention to Spaced Repetition](https://blog.readwise.io/adding-intention-to-spaced-repetition/) / [Reviewing Your Highlights](https://docs.readwise.io/readwise/docs/faqs/reviewing-highlights)

**③ SuperMemoのIncremental Reading**
記事全体を断片に切り出し、優先度をつけて少しずつ読み進めながら間隔反復に乗せる手法。2000年に考案。フラッシュカード以前の「文章のまま反復する」思想の源流。
[SuperMemo: Incremental reading](https://www.super-memory.com/help/read.htm) / [Advantages](https://supermemo.guru/wiki/Advantages_of_incremental_reading)

**④ RemNote / Mochi / Logseq**
RemNoteはノートとフラッシュカードが双方向リンクする一体型。MochiはSM-2をそのまま使うシンプル設計で「セットアップから10分で復習開始」を売りにしている。Logseqには標準の間隔反復機能はない（コミュニティ提案どまり）。
[比較記事](https://skilllearningcompass.com/en/anki-remnote-mochi-spaced-repetition-comparison) / [Logseq forum](https://discuss.logseq.com/t/spaced-repetition-feature/849)

**⑤ 日本の類似アプリ：reminDO**
「忘れそうなタイミングで通知する」暗記・メモアプリ。エビングハウスの忘却曲線に基づき、既定で1日後・3日後・7日後・2週間後・1ヶ月後に通知。テキストだけでなく音声・画像・URLの添付に対応し、クラウド保存でマルチデバイス。「音声・画像添付＋間隔反復」という構想に最も近い日本製の先例。
[reminDO公式](https://remindo.co/?locale=ja&savelocale=1) / [紹介記事](https://thebridge.jp/2016/07/remindo)

**⑥ Studyplus**
学習記録・可視化が主機能で、間隔反復に基づく「復習キュー」機能は検索範囲では確認できなかった（未確認）。
[Studyplus基本ガイド](https://www.studyplus.jp/2796)

**⑦ 個人開発の自作ツール**
GitHub上に「学習トピックをログし、間隔反復スケジュールでリマインドする」個人プロジェクトが複数存在する（例：Danielkweber/Spaced_Repetition＝ポモドーロタイマー併載のログ＋間隔反復リマインダー、dhana-sekharのStreamlit製、1/3/7/14/30/60/90/180/365/730日という固定間隔列を採用）。いずれも小規模で、「記録の再提示」に特化した決定版は見当たらなかった。
[Danielkweber/Spaced_Repetition](https://github.com/Danielkweber/Spaced_Repetition)

## 借りるべきUXパターン

- 復習画面は「全文表示＋自己評価」。フラッシュカードのように答えを隠す必要はない。Obsidianノートレビューがそのまま前例。
- 粗い評価段階（3段階程度）。Easy/Good/Hardのような大雑把な区分にとどめ、細かい点数制にしない。
- 新規と期限切れの混在比率を固定する（recallプラグインの3:2方式）。「今日はゼロ件」「今日は100件」の極端な振れを抑えられる。
- 添付（音声・画像・URL）を持てる設計はreminDOに前例があり、テキストのみのAnki/Obsidianより本要件に近い。
- データをプレーンテキスト＋メタデータで持ち、間隔反復の状態をアルゴリズム差し替え可能な形（別ファイル）にする選択肢がObsidian recallプラグインにある。

## 避けるべき失敗パターン（出典付き）

- 復習の山積み（レビュー負債）による離脱。医療系学習者を扱った記事は「レビューが溜まると乗り越えられない山になり、これが優秀な学習者が間隔反復をやめる主因」と指摘し、「多くの人は方法自体でなく『溜まった量』のせいでやめる」と述べている。
  [Spaced repetition in medicine](https://kevinmd.com/2026/02/spaced-repetition-in-medicine-why-current-apps-fail-clinicians.html)
- 対策として新しいアプリ（Memset）は日次上限やカテゴリ別の上限を導入している、との言及がある（未確認：一次情報未取得）。
- AnkiのReddit上の不満（「バックログで先延ばしする」）は該当ページを直接取得できず、具体的引用は得られなかった（未確認）。
- 「記録が面倒で続かない」という直接的な一次情報は見つからなかった（未確認）。ただしreminDOや自作ツール群が軒並み「入力の手軽さ」を売りにしている点から、入力コストが継続の最大の壁であることが推測される（推論）。

## 日付軸UI（デイリーノート型）の参考

ObsidianのDaily Notes（標準機能）は「今日の日付のノートを開く。存在すれば開く、なければ作る」という単純な分岐で、本要件「その日の記録があれば追記、なければ新規作成のみ」と同型。標準実装には「既に開いているのに新しいタブを作ってしまう」既知の不具合があり、コミュニティプラグインが補修している。
[Daily notes opener](https://community.obsidian.md/plugins/obsidian-daily-notes-opener) / [Single File Daily Notes](https://github.com/pranavmangal/obsidian-single-file-daily-notes)

## 未確認事項一覧

- Obsidian標準プラグインの1日あたり復習件数の上限有無。
- Studyplusに忘却曲線ベースの自動再提示機能が本当にないか。
- AnkiユーザーのReddit上の具体的な不満スレッドの内容。
- Memsetの日次上限機能の実装詳細。
- 「記録が面倒で続かない」という不満を明示したユーザーレビュー文。
