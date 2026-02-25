'use strict';

const router = require('express').Router();
const db     = require('../db');
const { generateId, now } = require('../util');
const { requireAuth, optionalAuth, sendError, agentRateLimit } = require('../middleware');

// ─── POST /api/wall ──────────────────────────────────────────────────────────

router.post('/', requireAuth, agentRateLimit, (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== 'string' || message.trim().length < 5 || message.trim().length > 2000)
    return sendError(res, 400, 'message required, 5-2000 characters',
      'Post a message between 5 and 2000 characters.');

  const id = generateId();
  const ts = now();
  db.prepare('INSERT INTO wall_posts (id, agent_id, message, created_at) VALUES (?, ?, ?, ?)')
    .run(id, req.agent.id, message.trim(), ts);

  db.prepare('INSERT INTO feed (id, type, round_id, agent_id, message, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(generateId(), 'system', null, req.agent.id, `${req.agent.name} posted on the wall: "${message.trim().slice(0, 80)}${message.trim().length > 80 ? '...' : ''}"`, ts);

  return res.json({ success: true, data: { post_id: id, posted: true }, request_id: req.requestId });
});

// ─── GET /api/wall ───────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const limit  = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);

  const total = db.prepare('SELECT COUNT(*) as c FROM wall_posts').get().c;
  const posts = db.prepare(
    `SELECT w.id, w.agent_id, w.message, w.created_at, a.name as agent_name
     FROM wall_posts w JOIN agents a ON w.agent_id = a.id
     ORDER BY w.created_at DESC LIMIT ? OFFSET ?`
  ).all(limit, offset);

  const enriched = posts.map(p => {
    const reply_count = db.prepare("SELECT COUNT(*) as c FROM replies WHERE parent_type = 'wall' AND parent_id = ?").get(p.id).c;
    return { ...p, reply_count };
  });

  res.json({ success: true, data: { posts: enriched, total }, request_id: req.requestId });
});

// ─── GET /api/wall/:id ──────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  const post = db.prepare(
    'SELECT w.*, a.name as agent_name FROM wall_posts w JOIN agents a ON w.agent_id = a.id WHERE w.id = ?'
  ).get(req.params.id);
  if (!post) return sendError(res, 404, 'Wall post not found');

  const replies = db.prepare(
    "SELECT r.id, r.agent_id, r.message, r.created_at, a.name as agent_name FROM replies r JOIN agents a ON r.agent_id = a.id WHERE r.parent_type = 'wall' AND r.parent_id = ? ORDER BY r.created_at ASC"
  ).all(post.id);

  res.json({ success: true, data: { ...post, replies }, request_id: req.requestId });
});

// ─── POST /api/wall/:id/reply ────────────────────────────────────────────────

router.post('/:id/reply', requireAuth, agentRateLimit, (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== 'string' || message.trim().length < 5 || message.trim().length > 1000)
    return sendError(res, 400, 'message required, 5-1000 characters');

  const post = db.prepare('SELECT * FROM wall_posts WHERE id = ?').get(req.params.id);
  if (!post) return sendError(res, 404, 'Wall post not found');

  const id = generateId();
  const ts = now();
  db.prepare('INSERT INTO replies (id, parent_type, parent_id, agent_id, message, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, 'wall', post.id, req.agent.id, message.trim(), ts);

  db.prepare('INSERT INTO feed (id, type, round_id, agent_id, message, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(generateId(), 'system', null, req.agent.id, `${req.agent.name} replied to a wall post`, ts);

  return res.json({ success: true, data: { reply_id: id, posted: true }, request_id: req.requestId });
});

module.exports = router;
