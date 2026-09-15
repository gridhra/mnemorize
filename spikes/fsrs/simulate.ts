/**
 * ts-fsrs 5.4.2 の挙動確認スパイク。
 * 「その日やったこと」1 件を復習単位とする個人用アプリ向けに、
 * FSRS-6 のスケジューリングがどう動くかを再現可能な形で確かめる。
 *
 * 実行: bun run simulate.ts
 */
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  StrategyMode,
  GenSeedStrategyWithCardId,
  FSRSVersion,
  dateDiffInDays,
  type Card,
  type Grade,
  type ReviewLog,
  type FSRSHistory,
} from 'ts-fsrs'

// ---------------------------------------------------------------------------
// 設定（本番で使う予定の値）
// ---------------------------------------------------------------------------
const PARAMS = generatorParameters({
  request_retention: 0.9,
  maximum_interval: 365,
  enable_fuzz: true,
  enable_short_term: false, // 当日中の再提示をしない（learning steps を無効化）
})

/**
 * 既定の seed 戦略を使うスケジューラ。
 * 既定 seed は「復習時刻のミリ秒 + 復習回数 + difficulty*stability」から作られるので、
 * 同じ入力なら同じ fuzz になる（＝テストで再現可能）。
 */
function scheduler() {
  return fsrs(PARAMS)
}

/** 参考: 記録 ID で seed を固定するスケジューラ（reschedule と食い違う。(f) で検証）。 */
function schedulerWithCardIdSeed() {
  return fsrs(PARAMS).useStrategy(StrategyMode.SEED, GenSeedStrategyWithCardId('card_id'))
}

const F = scheduler()

// ---------------------------------------------------------------------------
// 日付ユーティリティ。Day 0 = 記録の作成日。
// ---------------------------------------------------------------------------
const DAY0 = new Date('2026-01-01T09:00:00')
const MS_DAY = 86_400_000
/** Day n の 09:00（復習セッションの時刻と仮定）。 */
const day = (n: number) => new Date(DAY0.getTime() + n * MS_DAY)
/** 日付 → Day 番号（小数を切り捨て）。 */
const dayNo = (d: Date) => Math.round((d.getTime() - DAY0.getTime()) / MS_DAY)

type SimCard = Card & { card_id: number }

/** 作成日 Day 0、初回期限 Day 1 の新規記録を作る。 */
function newRecord(id: number, createdAt: Date, firstDueAt: Date): SimCard {
  const c = createEmptyCard<Card>(createdAt) as SimCard
  c.card_id = id
  c.due = firstDueAt // ← 初回期限を自前で「作成日の翌日」にずらす
  return c
}

const clone = (c: SimCard): SimCard => ({ ...c, due: new Date(c.due), last_review: c.last_review ? new Date(c.last_review) : undefined })

function line(s = '') {
  console.log(s)
}
function table(rows: Record<string, string | number>[]) {
  if (rows.length === 0) return
  const cols = Object.keys(rows[0])
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)))
  const fmt = (vals: (string | number)[]) => '| ' + vals.map((v, i) => String(v).padStart(w[i])).join(' | ') + ' |'
  line(fmt(cols))
  line('|' + w.map((n) => '-'.repeat(n + 2)).join('|') + '|')
  for (const r of rows) line(fmt(cols.map((c) => r[c])))
}

// ---------------------------------------------------------------------------
// 0. API の事実確認
// ---------------------------------------------------------------------------
line('=== 0. API / 設定の確認 ===')
line(`FSRSVersion: ${FSRSVersion}`)
line(`params: ${JSON.stringify({ ...PARAMS, w: `[${PARAMS.w.length} 個]` })}`)

{
  const c = newRecord(1, day(0), day(1))
  line(`createEmptyCard(Day0) → state=${State[c.state]} reps=${c.reps} lapses=${c.lapses} stability=${c.stability} difficulty=${c.difficulty} last_review=${c.last_review ?? 'undefined'}`)

  // 初回期限を自前でずらしても初回スケジューリングに影響しないか
  const asIs = createEmptyCard<Card>(day(0)) as SimCard
  asIs.card_id = 1
  const r1 = F.next(asIs, day(1), Rating.Good)
  const r2 = F.next(c, day(1), Rating.Good)
  line(`due を Day0 のまま Day1 に Good → 次回 Day ${dayNo(r1.card.due)} / S=${r1.card.stability}`)
  line(`due を Day1 に変更後 Day1 に Good → 次回 Day ${dayNo(r2.card.due)} / S=${r2.card.stability}`)
  line(`→ 一致するか: ${r1.card.due.getTime() === r2.card.due.getTime() && r1.card.stability === r2.card.stability}`)

  // repeat のプレビュー（Day1 時点の 4 択）
  const preview = F.repeat(c, day(1))
  for (const g of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Grade[]) {
    const it = preview[g]
    line(`  repeat[${Rating[g]}] → 次回 Day ${dayNo(it.card.due)} (間隔 ${it.card.scheduled_days} 日) state=${State[it.card.state]} S=${it.card.stability.toFixed(4)} D=${it.card.difficulty.toFixed(4)}`)
  }

  // forget（リセット）
  const after3 = (() => {
    let cc = clone(c)
    let at = 1
    for (let i = 0; i < 3; i++) {
      const r = F.next(cc, day(at), Rating.Good)
      cc = { ...(r.card as SimCard), card_id: 1 }
      at = dayNo(cc.due)
    }
    return cc
  })()
  line(`Good×3 後: reps=${after3.reps} lapses=${after3.lapses} S=${after3.stability.toFixed(4)} D=${after3.difficulty.toFixed(4)} state=${State[after3.state]}`)
  const forgotKeep = F.forget(after3, day(30), false)
  const forgotReset = F.forget(after3, day(30), true)
  line(`forget(reset_count=false) → state=${State[forgotKeep.card.state]} due=Day ${dayNo(forgotKeep.card.due)} S=${forgotKeep.card.stability} D=${forgotKeep.card.difficulty} reps=${forgotKeep.card.reps} lapses=${forgotKeep.card.lapses} last_review=Day ${forgotKeep.card.last_review ? dayNo(forgotKeep.card.last_review) : 'なし'}`)
  line(`forget(reset_count=true)  → reps=${forgotReset.card.reps} lapses=${forgotReset.card.lapses}`)
  line(`forget のログ: rating=${Rating[forgotKeep.log.rating]} state=${State[forgotKeep.log.state]}`)

  // rollback
  const one = F.next(clone(c), day(1), Rating.Good)
  const rolled = F.rollback(one.card, one.log)
  line(`rollback: due Day ${dayNo(one.card.due)} → Day ${dayNo(rolled.due)} / state ${State[one.card.state]} → ${State[rolled.state]} / reps ${one.card.reps} → ${rolled.reps}`)

  // ReviewLog に何が入るか
  line(`ReviewLog のキー: ${Object.keys(one.log).join(', ')}`)
  line(`ReviewLog 実例: ${JSON.stringify({ ...one.log, due: `Day ${dayNo(one.log.due)}`, review: `Day ${dayNo(one.log.review)}` })}`)
}

// ---------------------------------------------------------------------------
// 共通: 評価列を与えて逐次計算する
// ---------------------------------------------------------------------------
type Step = {
  回: number
  提示日: string
  評価: string
  間隔日: number
  次回: string
  S: string
  D: string
  R提示時: string
  reps: number
  lapses: number
  state: string
}

function run(id: number, ratings: Grade[], opts: { lateBy?: number[] } = {}) {
  return runWith(F, id, ratings, opts)
}

function runWith(f: ReturnType<typeof scheduler>, id: number, ratings: Grade[], opts: { lateBy?: number[] } = {}) {
  const F = f
  let card = newRecord(id, day(0), day(1))
  const logs: ReviewLog[] = []
  const steps: Step[] = []
  for (let i = 0; i < ratings.length; i++) {
    const late = opts.lateBy?.[i] ?? 0
    const at = day(dayNo(card.due) + late)
    const r = card.state === State.New ? null : F.get_retrievability(card, at, false)
    const res = F.next(card, at, ratings[i])
    logs.push(res.log)
    const prev = card
    card = { ...(res.card as SimCard), card_id: id }
    steps.push({
      回: i + 1,
      提示日: `Day ${dayNo(at)}`,
      評価: Rating[ratings[i]],
      間隔日: card.scheduled_days,
      次回: `Day ${dayNo(card.due)}`,
      S: card.stability.toFixed(3),
      D: card.difficulty.toFixed(3),
      R提示時: r === null ? '-' : (r as number).toFixed(3),
      reps: card.reps,
      lapses: card.lapses,
      state: State[card.state],
    })
    void prev
  }
  return { card, logs, steps }
}

const rep = (g: Grade, n: number) => Array<Grade>(n).fill(g)

// ---------------------------------------------------------------------------
// (a) 毎回 Good
// ---------------------------------------------------------------------------
line('')
line('=== (a) 毎回「思い出せた」(Good)、期限ちょうどに復習、10 回 ===')
const A = run(101, rep(Rating.Good, 10))
table(A.steps)

// ---------------------------------------------------------------------------
// (b) 毎回 Easy
// ---------------------------------------------------------------------------
line('')
line('=== (b) 毎回「余裕だった」(Easy)、期限ちょうどに復習、10 回 ===')
const B = run(102, rep(Rating.Easy, 10))
table(B.steps)

// ---------------------------------------------------------------------------
// (c) Good×3 → Again → Good×3
// ---------------------------------------------------------------------------
line('')
line('=== (c) Good×3 →「思い出せなかった」(Again) → Good×3 ===')
const C = run(103, [...rep(Rating.Good, 3), Rating.Again, ...rep(Rating.Good, 3)])
table(C.steps)
line(`lapse 直前の間隔 ${C.steps[2].間隔日} 日 → lapse 後の間隔 ${C.steps[3].間隔日} 日（S: ${C.steps[2].S} → ${C.steps[3].S}）`)

// ---------------------------------------------------------------------------
// (d) 遅延吸収
// ---------------------------------------------------------------------------
line('')
line('=== (d) 期限どおり vs 期限 +7 日（4 回目だけ遅らせる。1〜3 回目は期限どおり Good）===')
const onTime = run(104, rep(Rating.Good, 5))
const late = run(104, rep(Rating.Good, 5), { lateBy: [0, 0, 0, 7, 0] })
table([
  { 条件: '期限どおり', '4回目の提示日': onTime.steps[3].提示日, '提示時のR': onTime.steps[3].R提示時, '4回目の次回間隔(日)': onTime.steps[3].間隔日, S後: onTime.steps[3].S, '5回目の次回間隔(日)': onTime.steps[4].間隔日 },
  { 条件: '期限+7日', '4回目の提示日': late.steps[3].提示日, '提示時のR': late.steps[3].R提示時, '4回目の次回間隔(日)': late.steps[3].間隔日, S後: late.steps[3].S, '5回目の次回間隔(日)': late.steps[4].間隔日 },
])

// ---------------------------------------------------------------------------
// (e) 毎日 2 件新規 × 90 日、全部 Good。上限あり/なし
// ---------------------------------------------------------------------------
line('')
line('=== (e) 毎日 2 件新規作成 × 90 日、全部 Good ===')

function operate(dailyNew: number, days: number, cap: number | null) {
  let nextId = 1000
  // due の Day 番号 → カード配列
  let cards: SimCard[] = []
  const perDay: { day: number; 新規: number; 提示対象: number; 実施: number; 繰越: number }[] = []
  for (let d = 0; d < days; d++) {
    // その日の新規作成（初回期限は翌日）
    for (let i = 0; i < dailyNew; i++) cards.push(newRecord(nextId++, day(d), day(d + 1)))
    // 期限が来ているもの（期限超過が長い順）
    const dueList = cards
      .filter((c) => dayNo(c.due) <= d)
      .sort((a, b) => dayNo(a.due) - dayNo(b.due))
    const todo = cap === null ? dueList : dueList.slice(0, cap)
    for (const c of todo) {
      const res = F.next(c, day(d), Rating.Good)
      Object.assign(c, res.card)
      c.due = res.card.due
    }
    perDay.push({ day: d, 新規: dailyNew, 提示対象: dueList.length, 実施: todo.length, 繰越: dueList.length - todo.length })
  }
  return perDay
}

const noCap = operate(2, 90, null)
const withCap = operate(2, 90, 10)
line('日ごとの「提示対象件数」（Day 0 から 90 日。抜粋: 5 日おき）')
table(
  noCap
    .filter((r) => r.day % 5 === 0)
    .map((r, i) => {
      const c = withCap[r.day]
      return { Day: r.day, '上限なし_提示対象': r.提示対象, '上限あり_提示対象': c.提示対象, '上限あり_実施': c.実施, '上限あり_繰越': c.繰越 }
    }),
)
const maxNoCap = Math.max(...noCap.map((r) => r.提示対象))
const totalCarry = withCap.filter((r) => r.繰越 > 0).length
line(`上限なし: 1 日の提示対象の最大 ${maxNoCap} 件、平均 ${(noCap.reduce((s, r) => s + r.提示対象, 0) / noCap.length).toFixed(2)} 件`)
line(`上限 10 件: 繰り越しが発生した日数 ${totalCarry} / 90 日、最終日(Day 89)の繰越 ${withCap[89].繰越} 件`)
line(`上限なしで 10 件を超えた日数: ${noCap.filter((r) => r.提示対象 > 10).length} / 90 日 → ${noCap.filter((r) => r.提示対象 > 10).map((r) => `Day ${r.day}:${r.提示対象}件`).join(', ')}`)
line(`上限ありで繰り越しが出た日: ${withCap.filter((r) => r.繰越 > 0).map((r) => `Day ${r.day}:${r.繰越}件`).join(', ')}`)
line(`90 日間の復習実施総数: 上限なし ${noCap.reduce((s, r) => s + r.実施, 0)} 件 / 上限あり ${withCap.reduce((s, r) => s + r.実施, 0)} 件（新規作成は 180 件）`)
line(`上限なしの提示対象（Day 0-89 の全系列）: ${noCap.map((r) => r.提示対象).join(',')}`)

// ---------------------------------------------------------------------------
// (f) 履歴からの再構築
// ---------------------------------------------------------------------------
line('')
line('=== (f) reschedule による履歴からの再構築 ===')
{
  const seq = runWith(schedulerWithCardIdSeed(), 105, [...rep(Rating.Good, 3), Rating.Again, ...rep(Rating.Good, 4)])
  const history: FSRSHistory[] = seq.logs.map((l) => ({ rating: l.rating as Grade, review: l.review }))
  const F2 = schedulerWithCardIdSeed()
  const rebuilt = F2.reschedule(newRecord(105, day(0), day(1)), history, {
    first_card: newRecord(105, day(0), day(1)),
    now: day(dayNo(seq.card.due)),
    update_memory_state: true,
  })
  const last = rebuilt.collections[rebuilt.collections.length - 1].card
  line('(f-1) 記録 ID で seed を固定した場合')
  table([
    { 方法: '逐次計算', 次回: `Day ${dayNo(seq.card.due)}`, S: seq.card.stability.toFixed(6), D: seq.card.difficulty.toFixed(6), reps: seq.card.reps, lapses: seq.card.lapses, state: State[seq.card.state] },
    { 方法: 'reschedule', 次回: `Day ${dayNo(last.due)}`, S: last.stability.toFixed(6), D: last.difficulty.toFixed(6), reps: last.reps, lapses: last.lapses, state: State[last.state] },
  ])
  const same =
    last.due.getTime() === seq.card.due.getTime() &&
    last.stability === seq.card.stability &&
    last.difficulty === seq.card.difficulty &&
    last.reps === seq.card.reps &&
    last.lapses === seq.card.lapses &&
    last.state === seq.card.state
  line(`完全一致: ${same}`)

  line('(f-2) 既定 seed の場合')
  const F3 = fsrs(PARAMS)
  let plain = createEmptyCard<Card>(day(0))
  plain.due = day(1)
  const plainLogs: ReviewLog[] = []
  for (const g of [...rep(Rating.Good, 3), Rating.Again, ...rep(Rating.Good, 4)]) {
    const r = F3.next(plain, day(dayNo(plain.due)), g)
    plain = r.card
    plainLogs.push(r.log)
  }
  const F4 = fsrs(PARAMS)
  const firstPlain = createEmptyCard<Card>(day(0))
  firstPlain.due = day(1)
  const rb2 = F4.reschedule(firstPlain, plainLogs.map((l) => ({ rating: l.rating as Grade, review: l.review })), {
    first_card: firstPlain,
    now: day(dayNo(plain.due)),
    update_memory_state: true,
  })
  const last2 = rb2.collections[rb2.collections.length - 1].card
  line(`既定 seed（GenSeedStrategyWithCardId なし）でも一致: ${last2.due.getTime() === plain.due.getTime() && last2.stability === plain.stability}`)

  // 同じ入力で 2 回走らせたときの再現性
  const again1 = run(106, rep(Rating.Good, 10))
  const again2 = run(106, rep(Rating.Good, 10))
  line(`同一入力の 2 回実行が一致（fuzz の再現性）: ${JSON.stringify(again1.steps) === JSON.stringify(again2.steps)}`)
  const unseeded = fsrs(PARAMS)
  const u = (n: number) => {
    let c = createEmptyCard<Card>(day(0))
    c.due = day(1)
    const out: number[] = []
    for (let i = 0; i < 10; i++) {
      const r = unseeded.next(c, day(dayNo(c.due)), Rating.Good)
      c = r.card
      out.push(c.scheduled_days)
    }
    return out
  }
  line(`既定 seed の間隔列 1 回目: ${u(1).join(',')}`)
  line(`既定 seed の間隔列 2 回目: ${u(2).join(',')}`)
}

// ---------------------------------------------------------------------------
// (g) 午前 4 時境界の窓
// ---------------------------------------------------------------------------
line('')
line('=== (g) 午前 4 時境界の窓 ===')
function dueWindow(now: Date, boundaryHour = 4) {
  const start = new Date(now)
  if (now.getHours() < boundaryHour) start.setDate(start.getDate() - 1)
  start.setHours(boundaryHour, 0, 0, 0)
  const end = new Date(start.getTime() + MS_DAY)
  return { start, end }
}
for (const t of ['2026-03-01T01:00:00', '2026-03-01T03:59:59', '2026-03-01T04:00:00', '2026-03-01T23:30:00']) {
  const w = dueWindow(new Date(t))
  line(`now=${t} → 学習日の窓 [${w.start.toLocaleString('ja-JP')}, ${w.end.toLocaleString('ja-JP')})`)
}

// ---------------------------------------------------------------------------
// (h) forget をリセットとして使えるか / enable_short_term の比較
// ---------------------------------------------------------------------------
line('')
line('=== (h) forget 後の再学習と、enable_short_term の比較 ===')
{
  const seq = run(107, rep(Rating.Good, 3))
  const reset = F.forget(seq.card, day(100), true)
  const resetCard = { ...reset.card, due: day(101) } // 初回期限を「翌日」に置き直す
  const afterReset = F.next(resetCard, day(101), Rating.Good)
  const fresh = F.next(newRecord(108, day(100), day(101)), day(101), Rating.Good)
  table([
    { 条件: 'forget(true) 後の初回 Good', 間隔日: afterReset.card.scheduled_days, S: afterReset.card.stability.toFixed(4), D: afterReset.card.difficulty.toFixed(4), reps: afterReset.card.reps, lapses: afterReset.card.lapses },
    { 条件: '新規記録の初回 Good', 間隔日: fresh.card.scheduled_days, S: fresh.card.stability.toFixed(4), D: fresh.card.difficulty.toFixed(4), reps: fresh.card.reps, lapses: fresh.card.lapses },
  ])

  const shortTerm = fsrs({ ...PARAMS, enable_short_term: true })
  const longTerm = F
  const c1 = newRecord(109, day(0), day(1))
  const st = shortTerm.repeat(c1, day(1))
  const lt = longTerm.repeat(c1, day(1))
  table(([Rating.Again, Rating.Good, Rating.Easy] as Grade[]).map((g) => ({
    評価: Rating[g],
    'short_term=true の次回': `${st[g].card.due.toLocaleString('ja-JP')} (state ${State[st[g].card.state]})`,
    'short_term=false の次回': `Day ${dayNo(lt[g].card.due)} (state ${State[lt[g].card.state]})`,
  })))

  // 成熟カードで Again を押したときの short_term 差
  const mature = run(110, rep(Rating.Good, 3)).card
  const stAgain = shortTerm.next(mature, day(dayNo(mature.due)), Rating.Again)
  const ltAgain = longTerm.next(mature, day(dayNo(mature.due)), Rating.Again)
  line(`成熟カード(S≈${mature.stability.toFixed(1)})で Again: short_term=true → ${stAgain.card.due.toLocaleString('ja-JP')} (state ${State[stAgain.card.state]}) / short_term=false → Day ${dayNo(ltAgain.card.due)}（提示日 Day ${dayNo(mature.due)}、state ${State[ltAgain.card.state]}）`)
}

// ---------------------------------------------------------------------------
// (i) タイムゾーンの落とし穴：elapsed_days は UTC の暦日で数えられる
// ---------------------------------------------------------------------------
line('')
line(`=== (i) elapsed_days の数え方（実行時のタイムゾーン offset ${-new Date().getTimezoneOffset() / 60} 時間）===`)
{
  const pairs: [string, string][] = [
    ['2026-01-01T22:00:00', '2026-01-02T07:00:00'],
    ['2026-01-01T22:00:00', '2026-01-02T10:00:00'],
    ['2026-01-01T12:00:00', '2026-01-02T12:00:00'],
    ['2026-01-01T01:00:00', '2026-01-02T01:00:00'],
  ]
  table(
    pairs.map(([a, b]) => {
      const c = createEmptyCard<Card>(new Date(a))
      const r1 = F.next(c, new Date(a), Rating.Good)
      const r2 = F.next(r1.card, new Date(b), Rating.Good)
      return { '1回目': a, '2回目': b, 'dateDiffInDays': dateDiffInDays(new Date(a), new Date(b)), '2回目のelapsed_days': r2.log.elapsed_days, '次回間隔(日)': r2.card.scheduled_days }
    }),
  )
  // 対策：学習日 D を「D の 12:00（ローカル）」に正規化して ts-fsrs に渡す
  const normalize = (now: Date, boundaryHour = 4) => {
    const { start } = dueWindow(now, boundaryHour)
    const d = new Date(start)
    d.setHours(12, 0, 0, 0)
    return d
  }
  const t1 = normalize(new Date('2026-01-01T22:00:00'))
  const t2 = normalize(new Date('2026-01-02T07:00:00'))
  const t3 = normalize(new Date('2026-01-03T01:00:00'))
  line(`正規化: 1/1 22:00 → ${t1.toLocaleString('ja-JP')} / 1/2 07:00 → ${t2.toLocaleString('ja-JP')} / 1/3 01:00 → ${t3.toLocaleString('ja-JP')}`)
  line(`正規化後の dateDiffInDays: (1/1 22:00, 1/2 07:00) = ${dateDiffInDays(t1, t2)}、(1/2 07:00, 1/3 01:00) = ${dateDiffInDays(t2, t3)}`)
}
