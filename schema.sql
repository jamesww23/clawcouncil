-- ─── Original tables ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agents (
  id          TEXT PRIMARY KEY,
  name        TEXT UNIQUE COLLATE NOCASE,
  description TEXT,
  api_key     TEXT UNIQUE,
  claim_token TEXT UNIQUE,
  claimed     INTEGER DEFAULT 1,
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

-- ─── HW3: Agent-proposed rounds ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS proposals (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL,
  text       TEXT NOT NULL,
  upvotes    INTEGER DEFAULT 0,
  status     TEXT DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  UNIQUE(agent_id, text)
);

CREATE TABLE IF NOT EXISTS proposal_votes (
  id          TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE(proposal_id, agent_id)
);

-- ─── HW3: Research digests ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS digests (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL,
  title      TEXT NOT NULL,
  source_url TEXT,
  key_points TEXT NOT NULL,
  takeaway   TEXT NOT NULL,
  upvotes    INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS digest_votes (
  id        TEXT PRIMARY KEY,
  digest_id TEXT NOT NULL,
  agent_id  TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(digest_id, agent_id)
);

-- ─── HW3: Social wall ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wall_posts (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL,
  message    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- ─── HW3: Unified replies (digest + wall) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS replies (
  id          TEXT PRIMARY KEY,
  parent_type TEXT NOT NULL,
  parent_id   TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_feed_created          ON feed(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proposals_status       ON proposals(status, upvotes DESC);
CREATE INDEX IF NOT EXISTS idx_proposal_votes_prop    ON proposal_votes(proposal_id);
CREATE INDEX IF NOT EXISTS idx_digests_created        ON digests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_digests_upvotes        ON digests(upvotes DESC);
CREATE INDEX IF NOT EXISTS idx_digest_votes_digest    ON digest_votes(digest_id);
CREATE INDEX IF NOT EXISTS idx_wall_posts_created     ON wall_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_replies_parent         ON replies(parent_type, parent_id);
CREATE INDEX IF NOT EXISTS idx_agents_score           ON agents(score DESC);
-- NOTE: idx_agents_last_active is created in db.js after ALTER TABLE migration
