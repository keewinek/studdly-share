-- Gzipped canonical payload JSON, keyed by share code.
CREATE TABLE payloads (
  code  TEXT PRIMARY KEY,
  body  BLOB NOT NULL
);
