// UI の文言はすべてここに集める（要件 J1）。ほかのファイルに日本語の表示文字列を書かないこと。
export const ja = {
  appName: 'mnemorize',
  nav: {
    today: '今日',
    review: '復習',
    search: '検索',
    settings: '設定',
  },
  today: {
    prevDay: '前の日',
    nextDay: '次の日',
    backToToday: '今日へ',
    empty: 'まだ記録がありません',
    newEntry: '新しい記録',
    loading: '読み込み中…',
  },
  entry: {
    titleLabel: 'タイトル（任意）',
    titlePlaceholder: '未入力なら本文の先頭 1 文を手がかりに使います',
    bodyLabel: '本文',
    bodyPlaceholder: '今日やったことを書く（Markdown が使えます）',
    reviewEnabled: '復習の対象にする',
    save: '保存',
    saving: '保存中…',
    cancel: 'やめる',
    edit: '編集',
    create: '記録する',
    historyOpen: '履歴を見る',
    historyClose: '履歴を閉じる',
    historyEmpty: 'まだ加筆修正の履歴はありません',
    historyItem: (revNo: number, at: string) => `第 ${revNo} 版（${at} に置き換え）`,
    retire: '卒業させる',
    unretire: '卒業を取り消す',
    resetSchedule: '内容を作り直したので復習を最初からやり直す',
    resetScheduleHint: 'これまでの復習の予定が翌日からやり直しになります。',
    retired: '卒業済み',
    notReviewed: '復習の対象外',
    nextDue: (date: string) => `次回 ${date}`,
    saveHint: '⌘ + Enter で保存',
  },
  capture: {
    dropZone: '画像をここにドロップ',
  },
  recorder: {
    start: '録音する',
    stop: '停止して文字起こし',
    recording: '録音中',
    elapsed: (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`,
    preparing: 'マイクを準備しています…',
    sending: '送っています…',
    permissionDenied: 'マイクを使えませんでした。ブラウザの設定でこのページのマイク利用を許可してください。',
    emptyRecording: '音が録れませんでした。もう一度お試しください。',
    autoStopped: '最長 10 分に達したので自動で停止しました。',
    appendToEntry: 'この記録に話して追記する',
    maxMinutes: '最長 10 分',
  },
  transcribe: {
    title: '文字起こし中…',
    elapsed: (sec: number) => `経過 ${sec} 秒`,
    waiting: '順番を待っています…',
    listening: '音声を聞き取っています…',
    failed: '文字起こしに失敗しました',
    retry: '再試行',
    retrying: '再試行しています…',
    dismiss: '閉じる',
    warningPrefix: '注意：',
  },
  search: {
    placeholder: '本文・タイトル・文字起こし原文を検索',
    run: '検索',
    empty: '見つかりませんでした',
    hint: '2 文字でも検索できます',
    resultCount: (n: number) => `${n} 件`,
  },
  review: {
    loading: '読み込み中…',
    // 上部の進み具合。「今日の復習 2 / 8 件」
    progress: (done: number, total: number) => `今日の復習 ${done} / ${total} 件`,
    carriedOver: (n: number) => `繰り越し ${n} 件`,
    carriedOverHint: '1 日の上限を超えた分です。明日以降に出ます。',
    empty: '今日の復習はありません',
    finished: '今日の復習は終わりです',
    finishedCarriedOver: (n: number) => `上限を超えた ${n} 件は明日以降に出ます。`,
    // カードの手がかり
    createdOn: (date: string) => `${date}に記録`,
    attachmentCount: (n: number) => `画像 ${n} 枚`,
    open: '思い出したら開く',
    openHint: 'Space または Enter でも開けます',
    // 3 段階の評価（要件 J1：英語の Again / Good / Easy は内部名にとどめる）
    again: '思い出せなかった',
    againCriterion: '開く前に、何の話だったか出てこなかった。',
    good: '思い出せた',
    goodCriterion: '開く前に要点を 2〜3 個、自分の言葉で言えた。',
    easy: '余裕だった',
    easyCriterion: 'ほぼ全部説明できた。次は数か月〜1 年先になります。',
    /** ボタンの下に出す次回予定日。date は「9月18日（金）」の形。 */
    nextOn: (date: string) => `次回 ${date}`,
    keyHint: '1 / 2 / 3 のキーでも選べます',
    // 評価のあとの知らせ
    recorded: (date: string) => `次回は ${date} です`,
    autoRetired: '最長の間隔に達したので、この記録は卒業しました。',
    undo: '取り消す',
    undone: '直前の評価を取り消しました',
    // その場の追記（要件 R5。復習の履歴はリセットしない）
    appendLabel: '思い出したことを書き足す（任意）',
    appendPlaceholder: '補足や、思い出せなかった理由など',
    appendSave: '書き足す',
    appendSaving: '書き足しています…',
    appendSaved: '書き足しました',
    // 卒業
    retire: '卒業させる（もう復習しない）',
    retireConfirm: 'この記録をもう復習しないようにします。日付の一覧には残ります。よろしいですか。',
    retired: '卒業させました',
  },
  attachments: {
    dropZone: '画像をここにドロップ／貼り付け',
    choose: 'ファイルを選ぶ',
    uploading: 'アップロード中…',
    delete: '削除',
    confirmDelete: 'この画像を削除しますか？',
    moreCount: (n: number) => `他 ${n} 枚`,
    manage: '画像を管理',
    manageClose: '画像の管理を閉じる',
  },
  settings: {
    placeholder: '準備中：設定の画面はこのあとの段階で作ります。',
    dataDir: 'データの置き場',
    dbPath: 'データベース',
    whisperCli: '音声認識コマンド',
    whisperModel: 'モデルファイル',
    found: '見つかりました',
    notFound: '見つかりません',
    notConfigured: '未設定',
    boundaryHour: (h: number) => `一日の境界：午前 ${h} 時`,
    sectionStatus: '状態',
    sectionEdit: '設定の編集',
    sectionExport: '書き出し・バックアップ',
    whisperModelPathLabel: 'Whisper モデルのパス',
    glossaryLabel: '専門用語リスト（1 行に 1 語）',
    hallucinationLabel: 'ハルシネーション定型句（1 行に 1 句）',
    dailyReviewLimitLabel: '1 日の復習上限',
    boundaryHourLabel: '一日の境界時刻（0〜23 時）',
    snapshotCopyDirLabel: 'スナップショットのコピー先（任意）',
    save: '設定を保存',
    saving: '保存中…',
    saved: '保存しました',
    exportMarkdown: 'Markdown で書き出す',
    exportJson: 'JSON で書き出す',
    createSnapshot: 'スナップショットを作る',
    working: '実行中…',
    exportResult: (path: string, files: number, bytes: number) =>
      `書き出し先：${path}（${files} ファイル、${bytes.toLocaleString('ja-JP')} バイト）`,
    snapshotResult: (path: string, copiedTo: string | null) =>
      copiedTo ? `作成しました：${path}（コピー先：${copiedTo}）` : `作成しました：${path}`,
  },
  error: {
    generic: 'うまくいきませんでした',
    prefix: 'エラー：',
  },
  weekdays: ['日', '月', '火', '水', '木', '金', '土'],
} as const

/** 「9月15日（月）」の形（要件 J7）。 */
export function formatJapaneseDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return isoDate
  const w = ja.weekdays[new Date(y, m - 1, d).getDay()] ?? ''
  return `${m}月${d}日（${w}）`
}

/** 「2026年9月15日 14:30」の形。履歴の表示に使う。 */
export function formatJapaneseDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
