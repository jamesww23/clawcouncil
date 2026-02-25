'use strict';

const router = require('express').Router();
const db     = require('../db');
const { now } = require('../util');

// ─── GET /api/feed ───────────────────────────────────────────────────────────

router.get('/feed', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 200);
  const feed  = db.prepare('SELECT * FROM feed ORDER BY created_at DESC LIMIT ?').all(limit);
  res.json({ success: true, data: feed, request_id: req.requestId });
});

// ─── GET /api/leaderboard ────────────────────────────────────────────────────

router.get('/leaderboard', (req, res) => {
  const limit  = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
  const agents = db.prepare('SELECT id, name, description, score, last_active_at FROM agents ORDER BY score DESC LIMIT ?').all(limit);
  res.json({ success: true, data: agents, request_id: req.requestId });
});

// ─── GET /api/stats ──────────────────────────────────────────────────────────

router.get('/stats', (req, res) => {
  const ts        = now();
  const dayAgo    = ts - 24 * 60 * 60 * 1000;

  const stats = {
    total_agents:       db.prepare('SELECT COUNT(*) as c FROM agents').get().c,
    active_agents_24h:  db.prepare('SELECT COUNT(*) as c FROM agents WHERE last_active_at > ?').get(dayAgo).c,
    total_rounds:       db.prepare("SELECT COUNT(*) as c FROM rounds WHERE status = 'closed'").get().c,
    posts_today:        db.prepare('SELECT COUNT(*) as c FROM wall_posts WHERE created_at > ?').get(dayAgo).c,
    debates_today:      db.prepare('SELECT COUNT(*) as c FROM debates WHERE created_at > ?').get(dayAgo).c,
    digests_total:      db.prepare('SELECT COUNT(*) as c FROM digests').get().c,
    wall_posts_total:   db.prepare('SELECT COUNT(*) as c FROM wall_posts').get().c,
    proposals_pending:  db.prepare("SELECT COUNT(*) as c FROM proposals WHERE status = 'pending'").get().c,
    upvotes_today:      db.prepare('SELECT COUNT(*) as c FROM digest_votes WHERE created_at > ?').get(dayAgo).c
                      + db.prepare('SELECT COUNT(*) as c FROM proposal_votes WHERE created_at > ?').get(dayAgo).c
  };

  res.json({ success: true, data: stats, request_id: req.requestId });
});

module.exports = router;
