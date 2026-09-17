-- Idempotent schema. Applied by `npm run db:migrate` (scripts/migrate.ts).
-- Statements are separated by a line containing only `-- @@` so the migrate
-- script can run them one at a time.

CREATE TABLE IF NOT EXISTS ingest_runs (
  id            BIGSERIAL PRIMARY KEY,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  window_start  TIMESTAMPTZ NOT NULL,
  window_end    TIMESTAMPTZ NOT NULL,
  counts        JSONB NOT NULL DEFAULT '{}'::jsonb
);
-- @@
CREATE TABLE IF NOT EXISTS items (
  number             INTEGER PRIMARY KEY,
  kind               TEXT NOT NULL CHECK (kind IN ('pr', 'issue')),
  author_login       TEXT NOT NULL,
  author_association TEXT,
  title              TEXT NOT NULL DEFAULT '',
  url                TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL,
  merged_at          TIMESTAMPTZ,
  closed_at          TIMESTAMPTZ,
  is_draft           BOOLEAN NOT NULL DEFAULT false,
  additions          INTEGER,
  deletions          INTEGER,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- @@
CREATE INDEX IF NOT EXISTS items_created_at_idx ON items (created_at);
-- @@
CREATE INDEX IF NOT EXISTS items_author_idx ON items (author_login);
-- @@
CREATE TABLE IF NOT EXISTS events (
  id                 TEXT PRIMARY KEY,
  item_number        INTEGER NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('issue_comment', 'review_comment', 'review')),
  review_state       TEXT,
  author_login       TEXT NOT NULL,
  author_association TEXT,
  created_at         TIMESTAMPTZ NOT NULL,
  body               TEXT NOT NULL DEFAULT '',
  url                TEXT NOT NULL
);
-- @@
CREATE INDEX IF NOT EXISTS events_item_created_idx ON events (item_number, created_at);
-- @@
CREATE INDEX IF NOT EXISTS events_author_idx ON events (author_login);
-- @@
CREATE TABLE IF NOT EXISTS engineer_scores (
  run_id      BIGINT NOT NULL REFERENCES ingest_runs(id) ON DELETE CASCADE,
  login       TEXT NOT NULL,
  avatar_url  TEXT NOT NULL DEFAULT '',
  association TEXT NOT NULL DEFAULT '',
  eligible    BOOLEAN NOT NULL DEFAULT false,
  metrics     JSONB NOT NULL,
  evidence    JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (run_id, login)
);
-- @@
-- One row per scoring run holding the full DashboardData payload (minus
-- nothing): lets the page load with a single primary-key read.
CREATE TABLE IF NOT EXISTS dashboard_snapshots (
  run_id       BIGINT PRIMARY KEY REFERENCES ingest_runs(id) ON DELETE CASCADE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload      JSONB NOT NULL
);
