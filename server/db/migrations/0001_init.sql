-- 段階 0：設計書 §5 の全テーブルを作る。
-- 後続担当（録音・文字起こし・復習・書き出し）が使うテーブルもここで一度に作る。

CREATE TABLE entries (
  id                TEXT PRIMARY KEY,           -- UUID v7（時系列順）
  day_date          TEXT NOT NULL,              -- ローカル日付 YYYY-MM-DD（午前 4 時境界で決める）
  title             TEXT,                       -- 任意。空なら本文先頭 1 文を手がかりに使う
  body_md           TEXT NOT NULL DEFAULT '',   -- 編集後の本文（Markdown）
  review_enabled    INTEGER NOT NULL DEFAULT 1, -- 1=復習対象
  retired_at        TEXT,                       -- 卒業した時刻。NULL=現役
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  sort_order        INTEGER NOT NULL DEFAULT 0, -- 同日内の並び
  schedule_reset_at TEXT                        -- 最後に明示リセットした時刻
);
CREATE INDEX idx_entries_day_date ON entries(day_date, sort_order);

-- 加筆修正の全文履歴（更新前の全文を積む）
CREATE TABLE entry_revisions (
  id         TEXT PRIMARY KEY,
  entry_id   TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  rev_no     INTEGER NOT NULL,
  title      TEXT,
  body_md    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (entry_id, rev_no)
);
CREATE INDEX idx_entry_revisions_entry ON entry_revisions(entry_id, rev_no);

-- 添付（画像・音声）。実体はデータディレクトリ配下のファイル。
CREATE TABLE attachments (
  id           TEXT PRIMARY KEY,
  entry_id     TEXT REFERENCES entries(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('image', 'audio')),
  rel_path     TEXT NOT NULL,
  mime         TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  sha256       TEXT,
  duration_sec REAL,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_attachments_entry ON attachments(entry_id);

-- 文字起こしジョブ
CREATE TABLE transcription_jobs (
  id                  TEXT PRIMARY KEY,
  entry_id            TEXT REFERENCES entries(id) ON DELETE SET NULL,
  audio_attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  status              TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
  raw_text            TEXT,   -- ASR 出力そのまま（要件 C3）
  segments_json       TEXT,
  model               TEXT,
  prompt              TEXT,
  error               TEXT,
  created_at          TEXT NOT NULL,
  finished_at         TEXT
);
CREATE INDEX idx_transcription_jobs_status ON transcription_jobs(status, created_at);
CREATE INDEX idx_transcription_jobs_entry ON transcription_jobs(entry_id);

-- 復習履歴（追記専用）
CREATE TABLE review_logs (
  id               TEXT PRIMARY KEY,
  entry_id         TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  reviewed_at      TEXT NOT NULL,  -- 実際の時刻
  fsrs_instant     TEXT,           -- ts-fsrs に渡した正規化時刻（学習日の 12:00）
  rating           INTEGER,        -- 1=Again 3=Good 4=Easy
  state_before     TEXT,
  stability_before REAL,
  difficulty_before REAL,
  elapsed_days     REAL,
  scheduled_days   REAL,
  due_before       TEXT,
  algo             TEXT,
  kind             TEXT NOT NULL CHECK (kind IN ('review', 'reset', 'retire', 'unretire')),
  note_md          TEXT
);
CREATE INDEX idx_review_logs_entry ON review_logs(entry_id, reviewed_at);

-- 現在の予定（復習履歴から再計算できる導出値）
CREATE TABLE schedule_state (
  entry_id       TEXT PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  due            TEXT NOT NULL,
  state          TEXT NOT NULL CHECK (state IN ('New', 'Learning', 'Review', 'Relearning')),
  stability      REAL,
  difficulty     REAL,
  elapsed_days   REAL,
  scheduled_days REAL,
  reps           INTEGER NOT NULL DEFAULT 0,
  lapses         INTEGER NOT NULL DEFAULT 0,
  last_review    TEXT,
  algo           TEXT
);
CREATE INDEX idx_schedule_state_due ON schedule_state(due);

-- 設定（キー・値）
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 全文検索（日本語には単語境界がないため trigram）
CREATE VIRTUAL TABLE entry_fts USING fts5(
  entry_id UNINDEXED,
  title,
  body_md,
  raw_text,
  tokenize = 'trigram'
);

CREATE TRIGGER entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entry_fts (entry_id, title, body_md, raw_text)
  VALUES (new.id, COALESCE(new.title, ''), new.body_md, '');
END;

CREATE TRIGGER entries_au AFTER UPDATE OF title, body_md ON entries BEGIN
  UPDATE entry_fts
     SET title = COALESCE(new.title, ''), body_md = new.body_md
   WHERE entry_id = new.id;
END;

CREATE TRIGGER entries_ad AFTER DELETE ON entries BEGIN
  DELETE FROM entry_fts WHERE entry_id = old.id;
END;

-- 文字起こし原文も検索対象にする（要件 D5）。1 記録に複数ジョブが付く場合は連結する。
CREATE TRIGGER transcription_jobs_ai AFTER INSERT ON transcription_jobs BEGIN
  UPDATE entry_fts
     SET raw_text = (SELECT COALESCE(GROUP_CONCAT(raw_text, '
'), '') FROM transcription_jobs WHERE entry_id = new.entry_id)
   WHERE entry_id = new.entry_id;
END;

CREATE TRIGGER transcription_jobs_au AFTER UPDATE OF raw_text, entry_id ON transcription_jobs BEGIN
  UPDATE entry_fts
     SET raw_text = (SELECT COALESCE(GROUP_CONCAT(raw_text, '
'), '') FROM transcription_jobs WHERE entry_id = new.entry_id)
   WHERE entry_id = new.entry_id;
END;
