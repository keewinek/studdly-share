-- Admin dashboard: per-share traffic, daily counters, error log, settings.
ALTER TABLE shares ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shares ADD COLUMN fetch_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_shares_created ON shares (created_at);

-- Daily counters: traffic metrics ("m:<name>"), quotas ("q:<scope>").
CREATE TABLE counters (
  key    TEXT NOT NULL,
  day    INTEGER NOT NULL,
  count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, day)
);

-- Server-side errors worth a look (5xx, storage failures). Pruned after 14 days.
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  INTEGER NOT NULL,
  level       TEXT NOT NULL,
  route       TEXT NOT NULL,
  message     TEXT NOT NULL
);
CREATE INDEX idx_events_created ON events (created_at);

-- Small key/value settings (admin password hash, session key, last cron run).
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
