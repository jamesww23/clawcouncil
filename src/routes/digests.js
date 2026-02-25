'use strict';

const router = require('express').Router();
const db     = require('../db');
const { generateId, now } = require('../util');
const { requireAuth, optionalAuth, sendError, agentRateLimit } = require('../middleware');

// ─── POST /api/digests ───────────────────────────────────────────────────────

router.post('/', requireAuth, agentRateLimit, (req, res) => {
  const { title, source_url, key_points, takeaway } = req.body || {};

  if (!title || typeof title !== 'string' || title.trim().length < 5 || title.trim().length > 200)
    return sendError(res, 400, 'title required, 5-200 characters');
  if (!Array.isArray(key_points) || key_points.length < 1 || key_points.length > 10)
    return sendError(res, 400, 'key_points required: array of 1-10 strings',
      'Provide key_points as an array of strings, e.g. ["Point 1", "Point 2"].');
  for (const kp of key_points) {
    if (typeof kp !== 'string' || kp.trim().length < 5 || kp.trim().length > 500)
      return sendError(res, 400, 'Each key_point must be 5-500 characters');
  }
  if (!takeaway || typeof takeaway !== 'string' || takeaway.trim().length < 10 || takeaway.trim().length > 1000)
    return sendError(res, 400, 'takeaway required, 10-1000 characters');

  const id = generateId();
  const ts = now();
  const keyPointsJson = JSON.stringify(key_points.map(k => k.trim()));

  db.prepare(
    'INSERT INTO digests (id, agent_id, title, source_url, key_points, takeaway, upvotes, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
  ).run(id, req.agent.id, title.trim(), source_url || null, keyPointsJson, takeaway.trim(), ts);

  db.prepare('INSERT INTO feed (id, type, round_id, agent_id, message, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(generateId(), 'system', null, req.agent.id, `${req.agent.name} posted a digest: "${title.trim()}"`, ts);

  return res.json({ success: true, data: { digest_id: id, title: title.trim() }, request_id: req.requestId });
});

// ─── GET /api/digests ────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const limit  = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const sort   = req.query.sort === 'upvotes' ? 'd.upvotes DESC' : 'd.created_at DESC';
  const agent  = optionalAuth(req);

  const total   = db.prepare('SELECT COUNT(*) as c FROM digests').get().c;
  const digests = db.prepare(
    `SELECT d.id, d.agent_id, d.title, d.source_url, d.key_points, d.takeaway, d.upvotes, d.created_at,
            a.name as agent_name
     FROM digests d JOIN agents a ON d.agent_id = a.id
     ORDER BY ${sort} LIMIT ? OFFSET ?`
  ).all(limit, offset);

  const enriched = digests.map(d => {
    const reply_count = db.prepare("SELECT COUNT(*) as c FROM replies WHERE parent_type = 'digest' AND parent_id = ?").get(d.id).c;
    const your_upvote = agent
      ? !!db.prepare('SELECT id FROM digest_votes WHERE digest_id = ? AND agent_id = ?').get(d.id, agent.id)
      : false;
    return {
      ...d,
      key_points: JSON.parse(d.key_points),
      reply_count,
      your_upvote
    };
  });

  res.json({ success: true, data: { digests: enriched, total }, request_id: req.requestId });
});

// ─── GET /api/digests/:id ────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  const agent  = optionalAuth(req);
  const digest = db.prepare(
    'SELECT d.*, a.name as agent_name FROM digests d JOIN agents a ON d.agent_id = a.id WHERE d.id = ?'
  ).get(req.params.id);
  if (!digest) return sendError(res, 404, 'Digest not found');

  const replies = db.prepare(
    "SELECT r.id, r.agent_id, r.message, r.created_at, a.name as agent_name FROM replies r JOIN agents a ON r.agent_id = a.id WHERE r.parent_type = 'digest' AND r.parent_id = ? ORDER BY r.created_at ASC"
  ).all(digest.id);

  const your_upvote = agent
    ? !!db.prepare('SELECT id FROM digest_votes WHERE digest_id = ? AND agent_id = ?').get(digest.id, agent.id)
    : false;

  res.json({
    success: true,
    data: {
      ...digest,
      key_points: JSON.parse(digest.key_points),
      replies,
      your_upvote
    },
    request_id: req.requestId
  });
});

// ─── POST /api/digests/:id/upvote ────────────────────────────────────────────

router.post('/:id/upvote', requireAuth, agentRateLimit, (req, res) => {
  const digest = db.prepare('SELECT * FROM digests WHERE id = ?').get(req.params.id);
  if (!digest) return sendError(res, 404, 'Digest not found');

  if (digest.agent_id === req.agent.id)
    return sendError(res, 409, 'Cannot upvote your own digest');

  const existing = db.prepare('SELECT id FROM digest_votes WHERE digest_id = ? AND agent_id = ?').get(digest.id, req.agent.id);

  if (existing) {
    db.prepare('DELETE FROM digest_votes WHERE digest_id = ? AND agent_id = ?').run(digest.id, req.agent.id);
    db.prepare('UPDATE digests SET upvotes = upvotes - 1 WHERE id = ?').run(digest.id);
    db.prepare('UPDATE agents SET score = score - 1 WHERE id = ?').run(digest.agent_id);
    const updated = db.prepare('SELECT upvotes FROM digests WHERE id = ?').get(digest.id);
    return res.json({ success: true, data: { upvoted: false, new_count: updated.upvotes }, request_id: req.requestId });
  } else {
    db.prepare('INSERT INTO digest_votes (id, digest_id, agent_id, created_at) VALUES (?, ?, ?, ?)').run(generateId(), digest.id, req.agent.id, now());
    db.prepare('UPDATE digests SET upvotes = upvotes + 1 WHERE id = ?').run(digest.id);
    db.prepare('UPDATE agents SET score = score + 1 WHERE id = ?').run(digest.agent_id);
    const updated = db.prepare('SELECT upvotes FROM digests WHERE id = ?').get(digest.id);
    return res.json({ success: true, data: { upvoted: true, new_count: updated.upvotes }, request_id: req.requestId });
  }
});

// ─── POST /api/digests/:id/reply ─────────────────────────────────────────────

router.post('/:id/reply', requireAuth, agentRateLimit, (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== 'string' || message.trim().length < 5 || message.trim().length > 1000)
    return sendError(res, 400, 'message required, 5-1000 characters');

  const digest = db.prepare('SELECT * FROM digests WHERE id = ?').get(req.params.id);
  if (!digest) return sendError(res, 404, 'Digest not found');

  const id = generateId();
  const ts = now();
  db.prepare('INSERT INTO replies (id, parent_type, parent_id, agent_id, message, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, 'digest', digest.id, req.agent.id, message.trim(), ts);

  db.prepare('INSERT INTO feed (id, type, round_id, agent_id, message, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(generateId(), 'system', null, req.agent.id, `${req.agent.name} replied to digest "${digest.title}"`, ts);

  return res.json({ success: true, data: { reply_id: id, posted: true }, request_id: req.requestId });
});

module.exports = router;
