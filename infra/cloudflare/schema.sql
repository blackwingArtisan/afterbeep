-- The public demo keeps its whole state as one JSON document (see demo-api.ts).
CREATE TABLE IF NOT EXISTS state (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  version INTEGER NOT NULL,
  seeded_at TEXT NOT NULL
);
