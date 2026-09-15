-- 段階 2（録音・文字起こし）で足りない列を追加する。
-- warnings_json : 後処理で出した警告の配列（例：定型ハルシネーション句を除去した）。要件 J4。
-- day_date      : 記録をまだ作っていないジョブのために、どの学習日に作るかを覚えておく。
ALTER TABLE transcription_jobs ADD COLUMN warnings_json TEXT;
ALTER TABLE transcription_jobs ADD COLUMN day_date TEXT;
