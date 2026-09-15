// UI の文言はすべてここに集める（要件 J1）。ほかのファイルに日本語の表示文字列を書かないこと。

/**
 * 「もう復習しない」の確認文。今日の画面（復習カード）と記録カードで同じ文を使う
 * （同じ操作はどの画面でも同じ確認文にする）。
 */
const RETIRE_CONFIRM = 'この記録をもう復習しないようにします。日付の一覧には残ります。よろしいですか。'

/** 「◯日後」。今日ぶんと、期限を過ぎているぶんも同じ言い方で書く。 */
function relativeDays(days: number): string {
  if (days > 0) return `${days}日後`
  if (days === 0) return '今日'
  return `${-days}日過ぎています`
}

export const ja = {
  appName: 'mnemorize',
  nav: {
    today: '今日',
    calendar: 'カレンダー',
    search: '検索',
    settings: '設定',
  },
  /** カレンダーの画面（月のマス目と、これからの復習）。 */
  calendar: {
    prevMonth: '前の月',
    nextMonth: '次の月',
    thisMonth: '今月へ',
    /** 帯の中央に出す月。「2026年9月」 */
    monthLabel: (year: number, month: number) => `${year}年${month}月`,
    /** マス目の曜日見出し。月曜始まり。 */
    weekdayHeads: ['月', '火', '水', '木', '金', '土', '日'],
    /** マスの中の記録の件数。 */
    entryCount: (n: number) => `記録${n}件`,
    /** マスの中の、その日に期限が来る復習の件数。 */
    dueCount: (n: number) => `復習${n}件`,
    loading: '読み込み中…',
    upcomingTitle: 'これからの復習',
    upcomingRange: (days: number) => `今日から${days}日分の予定です。`,
    upcomingEmpty: (days: number) => `この先${days}日に復習の予定はありません。`,
    /** 開くと見出しの一覧が出る行。「9月18日（金）・3件」 */
    upcomingDay: (date: string, count: number) => `${date}・${count}件`,
  },
  /** 日の画面（過去・未来・今日のどれか 1 日）。 */
  day: {
    prevDay: '前の日',
    nextDay: '次の日',
    toCalendar: 'カレンダーへ',
    entrySection: 'この日の記録',
    empty: 'この日の記録はありません',
    loading: '読み込み中…',
    /** 過去の日と今日に出す、新規作成欄の見出し。 */
    addHere: 'この日に記録を追加する',
    /** 今日を開いたときだけ上に出す案内。 */
    todayNotice: '今日の復習は「今日」の画面で行います。',
    /** まだ来ていない日では、新規作成欄の代わりに同じ位置へこの一文を出す。 */
    futureNotice: 'この日はまだ来ていません。復習の予定だけを表示しています。',
    futureSection: 'この日に期限が来る復習',
    futureEmpty: 'この日に期限が来る復習はありません',
    /** 検索結果などから開いた記録が、この日の一覧に無いとき（削除済み）。 */
    entryMissing: 'この記録は削除されています。',
  },
  today: {
    reviewSection: '今日の復習',
    recordSection: '今日の記録',
    empty: 'まだ記録がありません',
    loading: '読み込み中…',
  },
  entry: {
    titleLabel: '見出し（省略可）',
    titleHint: '省略すると本文の先頭1文を使います。復習のとき最初に見えるのはこの1行です。',
    bodyLabel: '本文',
    bodyPlaceholder: '今日やったことを書く。あとで思い出せるように、要点を2〜3個。',
    reviewEnabled: '復習の対象にする',
    save: '保存',
    saving: '保存中…',
    cancel: 'やめる',
    edit: '編集',
    create: '記録する',
    reviewLog: '復習の記録',
    history: '本文の履歴',
    more: 'その他',
    historyEmpty: 'まだ本文の履歴はありません',
    historyLoading: '読み込み中…',
    /** 履歴の各版の見出し。「第3版（2026年9月15日 14:30に保存）」 */
    historyItem: (revNo: number, at: string) => `第${revNo}版（${at}に保存）`,
    /** いまの本文と中身が同じ版に添える札。この版には「戻す」ことがないので操作は無効にする。 */
    historyCurrent: 'いまの内容',
    historyRevert: 'この版に戻す',
    historyRevertConfirm:
      'この版の内容に戻します。いまの内容は履歴に新しい版として残るので、あとから戻すこともできます。よろしいですか。',
    // 「復習の記録」の中身（いまの状態と、これまでの履歴）
    reviewLogLoading: '読み込み中…',
    /** 1度も復習していない記録では、状態の代わりにこの1行だけを出す。 */
    reviewLogNever: 'まだ復習していません',
    /** 安定度＝忘れにくさの目安。FSRS が持つ日数をそのまま丸めて出す。 */
    reviewLogStability: (days: number) => `安定度：およそ${days}日`,
    reviewLogStabilityHint: '思い出せる確率が90%まで下がるまでの日数の目安です。長いほど忘れにくい状態です。',
    reviewLogRetrievability: (percent: number) => `今の想起見込み：${percent}%`,
    reviewLogRetrievabilityHint: 'いま本文を見ずに思い出せる確率の推定です。',
    reviewLogReps: (n: number) => `復習した回数：${n}回`,
    reviewLogLapses: (n: number) => `忘れた回数：${n}回`,
    /** 追記の録音が文字起こし中であることを、編集中のカードに出す。 */
    appendTranscribing: '書き足す音声を文字起こししています…',
    retire: 'もう復習しない',
    retireHint: '記録は残り、復習の予定だけ止まります。',
    unretire: '復習を再開する',
    retireConfirm: RETIRE_CONFIRM,
    /** 記録そのものの削除（「もう復習しない」＝予定を止めるだけ、とは別の操作）。 */
    delete: 'この記録を削除する',
    deleteHint: '「もう復習しない」と違い、記録そのものが消えます。',
    deleteConfirm:
      'この記録を削除します。本文・画像・録音・復習の記録もすべて消え、元に戻せません。よろしいですか。',
    resetSchedule: '内容を作り直したので復習を最初からやり直す',
    resetScheduleHint: 'これまでの復習の予定が翌日からやり直しになります。',
    resetScheduleAction: '復習をもう一度最初から',
    resetScheduleConfirm:
      'この記録の復習を最初からやり直します。これまでの予定は翌日からのやり直しになります。よろしいですか。',
    /** カードの状態1行：「次の復習 9月18日（金）・3日後・2回目」 */
    scheduleLine: (date: string, days: number, reps: number) =>
      `次の復習 ${date}・${relativeDays(days)}・${reps}回目`,
    retiredLine: (date: string) => `復習は終了（${date}に終了）`,
    notReviewed: '復習しない記録',
    saveHint: '⌘（WindowsはCtrl）+Enterで保存',
  },
  recorder: {
    start: '録音して記録する',
    stop: '停止して文字起こしする',
    recording: '録音中',
    elapsed: (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`,
    preparing: 'マイクを準備しています…',
    sending: '文字起こしの準備をしています…',
    permissionDenied: 'マイクを使えませんでした。ブラウザの設定でこのページのマイク利用を許可してください。',
    waitingPermission:
      'ブラウザがマイクの許可を求めています。アドレスバーの近くに出る確認で「許可」を選んでください。',
    startFailed: (name: string) => `録音を始められませんでした（${name}）。`,
    emptyRecording: '音が録れませんでした。もう一度お試しください。',
    autoStopped: '最長10分に達したので自動で停止しました。',
    appendToEntry: '録音して書き足す',
    maxMinutes: '最長10分',
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
    dismissHint: '閉じると、このカードは表示されなくなります。録音した音声はデータの置き場に残ります。',
    warningPrefix: '注意：',
  },
  search: {
    placeholder: '本文・見出し・文字起こしのまま（編集前）の文を検索',
    run: '検索',
    empty: '見つかりませんでした',
    resultCount: (n: number) => `${n}件`,
    /** 結果カードに小さく出す「どこが一致したか」。 */
    matchedIn: {
      body: '本文',
      title: '見出し',
      transcription: '文字起こしのまま（編集前）の文',
    },
  },
  review: {
    loading: '読み込み中…',
    // 節の見出しの右に出す進み具合。「2 / 8件」
    progress: (done: number, total: number) => `${done} / ${total}件`,
    /** 1日の上限で明日以降に回した分。 */
    carriedOverLine: (n: number, limit: number) =>
      `ほかに${n}件は明日以降に出ます（1日の上限${limit}件）`,
    empty: '今日の復習はありません。',
    emptyWithNext: (date: string, count: number) =>
      `今日の復習はありません。次は${date}に${count}件あります。`,
    finished: '今日の復習は終わりました。',
    finishedWithNext: (date: string, count: number) =>
      `今日の復習は終わりました。次の復習は${date}に${count}件あります。`,
    /** 記録がまだ1件も無いときだけ添える。 */
    firstTimeHint: '記録を作ると、翌日から復習に出ます。',
    // カードの手がかり行：「9月10日（木）に記録・画像2枚・2回目の復習」
    cueLine: (date: string, imageCount: number, time: number) =>
      `${date}に記録${imageCount > 0 ? `・画像${imageCount}枚` : ''}・${time}回目の復習`,
    recallPrompt: '本文を見る前に、何の話だったか自分の言葉で言ってみてください。',
    open: '思い出せたら開く',
    openHint: 'SpaceまたはEnterでも開けます',
    // 3 段階の評価（要件 J1：英語の Again / Good / Easy は内部名にとどめる）
    again: '思い出せなかった',
    againCriterion: '開く前に、何の話だったか出てこなかった。',
    good: '思い出せた',
    goodCriterion: '開く前に要点を2〜3個、自分の言葉で言えた。',
    easy: '余裕だった',
    easyCriterion: 'ほぼ全部説明できた。',
    /** ボタンの3段目に出す予告。date は「9月22日（火）」の形。 */
    nextPreview: (date: string, days: number) => `次回：${date}・${days}日後`,
    keyHint: '1 / 2 / 3のキーでも選べます',
    // 評価のあとの知らせ（こちらは確定）
    recorded: (date: string, days: number) => `次の復習は${date}、${days}日後です。`,
    autoRetired:
      '次の復習までの間隔（日数）が1年に達したので、この記録の復習を終えました。カレンダーからいつでも読めます。',
    undo: '取り消す',
    undone: '直前の評価を取り消しました',
    // その場の追記（要件 R5。復習の履歴はリセットしない）
    appendLabel: '思い出したことを書き足す（任意）',
    appendPlaceholder: '補足や、思い出せなかった理由など',
    appendSave: '書き足す',
    appendSaving: '書き足しています…',
    appendSaved: '書き足しました',
    // 復習を終える（内部では retire と呼ぶもの）
    retire: 'もう復習しない',
    retireConfirm: RETIRE_CONFIRM,
    retired: 'この記録の復習を終えました',
    // 記録カードの「復習の記録」に出す履歴の1行。
    /** 評価した行。「9月10日（木） 思い出せた → 次回 9月16日（火）」 */
    logItem: (date: string, result: string, nextDate: string) =>
      `${date} ${result} → 次回 ${nextDate}`,
    /** 評価以外（予定のやり直し・復習の終了と再開）の行。 */
    logEvent: (date: string, what: string) => `${date} ${what}`,
    logReset: '予定を最初からやり直した',
    logRetire: '復習を終えた',
    logUnretire: '復習を再開した',
  },
  attachments: {
    dropZone: '画像をここにドロップ／貼り付け',
    choose: 'ファイルを選ぶ',
    uploading: 'アップロード中…',
    delete: '削除',
    confirmDelete: 'この画像を削除しますか？',
    manage: '画像を追加・削除',
    manageClose: '画像の追加・削除を閉じる',
  },
  settings: {
    title: '設定',
    sectionTranscription: '音声の文字起こし',
    sectionReview: '復習',
    sectionData: 'データ',

    // 音声の文字起こし：準備状態
    prepLabel: '文字起こしの準備',
    prepReady: 'できています',
    prepReadyFallback: (path: string) =>
      `できています（設定のパスは見つからず、${path}を使います）`,
    prepMissingCli: '音声認識のプログラム（whisper-cli）が見つかりません',
    prepModelNotConfigured: 'モデルファイルが未設定です',
    prepModelMissing: 'モデルファイルが見つかりません',
    prepNotReadyNote: '録音はできますが、文字起こしは動きません。',
    setupSteps: [
      'ターミナルでbrew install whisper.cppを実行します。',
      'モデルファイル（ggml-large-v3-turbo）をHugging Faceのggerganov/whisper.cppから入手します。',
      '下の「モデルファイルの場所」の欄に、入手したファイルのパスを入れます。',
    ],

    // 音声の文字起こし：項目
    whisperModelPathLabel: 'モデルファイルの場所',
    whisperModelPathHelp: '音声認識に使うモデルファイル（拡張子.bin）の場所です。',
    whisperModelPathNote: {
      purpose: '文字起こしは、まずこの設定に入っているパスのモデルファイルを使います。',
      effect:
        '既定値はこのマシンの~/.cache/whisper-cpp/ggml-large-v3-turbo.binです。この設定のパスにファイルが無いときは、同じフォルダにある他のモデル（ggml-large-v3-turbo-q5_0.binなど）を保険として探します。別の場所に置いたモデルを使うときは、ここでパスを書き換えます。',
      example: '/Users/name/models/ggml-large-v3-turbo.bin',
    },
    glossaryLabel: '覚えさせたい言葉',
    glossaryHelp: 'よく話す専門用語や固有名詞を1行に1つ。文字起こしがその表記を使いやすくなります。',
    glossaryNote: {
      purpose: '音声認識は聞き取った音に近い一般的な表記を選びがちで、専門用語や固有名詞を書き間違えることがあります。',
      effect:
        'ここに書いた言葉は文字起こしの手がかりとして渡され、正しい表記が選ばれやすくなります。空でも文字起こしは動きますが、書き間違いが増えることがあります。',
      example: 'FSRS、ts-fsrs、mnemorize',
    },
    hallucinationLabel: '無音のときに出やすい誤認識',
    hallucinationHelp:
      '音声認識は無音の部分で決まり文句（例：ご視聴ありがとうございました）を勝手に出すことがあります。ここに書いた句と一致する部分は取り除きます。1行に1句。',
    hallucinationNote: {
      purpose:
        '録音の最初や最後の無音部分で、音声認識が「ご視聴ありがとうございました」のような、話していない文を出すことがあります。それが記録に混ざるのを防ぐための一覧です。',
      effect:
        'ここに書いた句と一致する部分は文字起こしから取り除き、取り除いたことを文字起こし中のカードに注意として表示します。空にすると何も取り除きません。',
      example:
        '例：既定の4句（ご視聴ありがとうございました／チャンネル登録／you／Thank you.）は、実際に無音の録音で出ることを確認したものです。',
    },

    // 復習：項目
    dailyReviewLimitLabel: '1日に出す復習の上限',
    dailyReviewLimitHelp:
      '期限が来た記録がこの件数を超えた日は、期限を過ぎて長いものから先に出し、超えた分は翌日以降に回します。',
    dailyReviewLimitNote: {
      purpose:
        '復習は1日に無理なくこなせる件数にとどめたいという設定です。期限が同じ日に集中すると、その日の復習が大量になることがあります。',
      effect:
        '設定した件数を超えた分は、その日には出さず翌日以降に回します。増やすと1日に出る件数が増え、減らすと翌日以降に回る件数が増えます。',
      example: '既定は10件です。',
    },
    autoRetireLabel: '次の復習までの間隔（日数）が1年に達したら復習を終える',
    autoRetireHelp: 'オフにすると、1年ごとに復習が続きます。',
    autoRetireNote: {
      purpose: '間隔反復では、思い出せるほど次の復習までの間隔（日数）が延びます。間隔が1年に達した記録は、十分に定着したとみなせます。',
      effect:
        'オンにすると、間隔が1年に達した記録はそこで復習を終了し、キューに出なくなります（カレンダーからいつでも読めます）。オフにすると、1年を超えても1年ごとに復習が続きます。',
      example: '既定はオンです。',
    },
    boundaryHourLabel: '日付の切り替え時刻',
    boundaryHourHelp:
      'この時刻より前は前日として扱います。深夜に書いた記録が前日の記録になり、復習の期限もこの時刻に切り替わります。',
    boundaryHourNote: {
      purpose: '深夜に活動する人のために、「1日」の区切りを深夜0時ではなく選べる時刻にする設定です。',
      effect:
        'ここで指定した時刻より前に書いた記録は前日の記録として扱われ、復習の期限もこの時刻を境に当日分として出るようになります。変えても、記録済みの日付そのものは変わりません。',
      example: '既定は午前4時です。深夜2時に書いた記録は前日の記録になります。',
    },

    // データ
    dataDirLabel: 'データの置き場',
    dataDirHelp: 'このフォルダをまるごと複製すれば、すべての記録の控えになります。',
    exportMarkdown: 'Markdownで書き出す',
    exportJson: 'JSONで書き出す',
    exportResult: (path: string, files: number, bytes: number) =>
      `書き出しました：${path}（${files}ファイル、${bytes.toLocaleString('ja-JP')}バイト）`,
    openInFinder: 'Finderで開く',
    openInFinderFailed: 'Finderで開けませんでした',
    snapshotLabel: '控え（データベースの複製）',
    createSnapshot: '控えを作る',
    createSnapshotHelp: 'データベースを丸ごと写した控え（複製）を1つ作ります。',
    snapshotCopyDirLabel: '控えのコピー先（任意）',
    snapshotCopyDirHelp: '同期フォルダなどを指定すると、そこにもコピーします。',
    snapshotCopyDirNote: {
      purpose: '控えを、パソコン内のデータ置き場以外にも置いておきたいときのための設定です。',
      effect: '指定すると、控えを作るたびにそのフォルダにもコピーします。空にすると、データ置き場の中だけに控えを作ります。',
      example: 'iCloud Driveの同期フォルダのパス',
    },
    snapshotResult: (path: string, copiedTo: string | null) =>
      copiedTo ? `作成しました：${path}（コピー先：${copiedTo}）` : `作成しました：${path}`,

    // 共通
    noteSummary: '詳しく',
    notePurpose: '目的',
    noteEffect: '効果',
    noteExample: '例',
    save: '保存',
    saving: '実行中…',
    saved: '保存しました',
    working: '実行中…',
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
