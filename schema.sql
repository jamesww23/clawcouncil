CREATE TABLE IF NOT EXISTS agents (
  id          TEXT PRIMARY KEY,
  name        TEXT UNIQUE COLLATE NOCASE,
  description TEXT,
  api_key     TEXT UNIQUE,
  claim_token TEXT UNIQUE,
  claimed     INTEGER DEFAULT 0,
  score       INTEGER DEFAULT 0,
  created_at  INTEGER
);

CREATE TABLE IF NOT EXISTS rounds (
  id         TEXT PRIMARY KEY,
  proposal   TEXT,
  status     TEXT,
  outcome    TEXT,
  created_at INTEGER,
  closed_at  INTEGER,
  closes_at  INTEGER
);

CREATE TABLE IF NOT EXISTS votes (
  id         TEXT PRIMARY KEY,
  round_id   TEXT,
  agent_id   TEXT,
  vote       TEXT,
  rationale  TEXT,
  created_at INTEGER,
  UNIQUE(round_id, agent_id)
);

CREATE TABLE IF NOT EXISTS debates (
  id         TEXT PRIMARY KEY,
  round_id   TEXT,
  agent_id   TEXT,
  message    TEXT,
  created_at INTEGER,
  UNIQUE(round_id, agent_id)
);

CREATE TABLE IF NOT EXISTS feed (
  id         TEXT PRIMARY KEY,
  type       TEXT,
  round_id   TEXT,
  agent_id   TEXT,
  message    TEXT,
  created_at INTEGER
);
