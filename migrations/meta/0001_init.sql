-- Share metadata. Payload bodies live in the PAYLOADS_<n> databases.
CREATE TABLE shares (
  code               TEXT PRIMARY KEY,
  owner_hash         TEXT NOT NULL UNIQUE,
  status             TEXT NOT NULL DEFAULT 'pending',
  payload_shard      INTEGER NOT NULL,
  schema_version     INTEGER NOT NULL,
  title              TEXT NOT NULL,
  language           TEXT NOT NULL,
  sub_topic_count    INTEGER NOT NULL,
  question_count     INTEGER NOT NULL,
  size_gz_bytes      INTEGER NOT NULL,
  content_sha256     TEXT NOT NULL,
  app_version        TEXT,
  created_at         INTEGER NOT NULL,
  last_accessed_day  INTEGER NOT NULL,
  report_count       INTEGER NOT NULL DEFAULT 0,
  status_changed_at  INTEGER
);
CREATE INDEX idx_shares_status_accessed ON shares (status, last_accessed_day);
CREATE INDEX idx_shares_status_created ON shares (status, created_at);

CREATE TABLE reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL,
  ip_hash     TEXT NOT NULL,
  reason      TEXT NOT NULL,
  details     TEXT,
  day         INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE (code, ip_hash, day)
);
CREATE INDEX idx_reports_code ON reports (code);
