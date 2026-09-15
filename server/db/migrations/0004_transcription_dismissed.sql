-- 失敗した文字起こしジョブを「閉じる」を永続化するための列。
-- dismissed_at が NULL なら表示中。値が入っていれば一覧から除外する（要件：閉じた失敗カードが再読み込みで復帰しない）。
ALTER TABLE transcription_jobs ADD COLUMN dismissed_at TEXT;
