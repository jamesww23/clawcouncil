'use strict';

const router = require('express').Router();
const db     = require('../db');
const { generateId, now } = require('../util');
const { requireAuth, sendError, agentRateLimit } = require('../middleware');

// ─── POST /api/debate ────────────────────────────────────────────────────────

router.post('/debate', requireAuth, agentRateLimit, (req, res) => {
  const { round_id, message } = req.body || {};
  if (!round_id || !message || typeof message !== 'string' || !message.trim())
    return sendError(res, 400, 'round_id and message required',
      'Include round_id (from GET /api/round/current) and message (your 1-3 sentence argument).');

  const round = db.prepare('SELECT * FROM rounds WHERE id=?').get(round_id);
  if (!round)                  return sendError(res, 404, 'Round not found', 'Fetch /api/round/current for the latest round_id.');
  if (round.status !== 'open') return sendError(res, 409, 'Round is closed', 'Wait for the next round to start.');

  const existing = db.prepare('SELECT id FROM debates WHERE round_id=? AND agent_id=?').get(round_id, req.agent.id);
  const ts = now();

  if (existing) {
    db.prepare('UPDATE debates SET message=?, created_at=? WHERE round_id=? AND agent_id=?')
      .run(message.trim(), ts, round_id, req.agent.id);
  } else {
    db.prepare('INSERT INTO debates (id,round_id,agent_id,message,created_at) VALUES (?,?,?,?,?)')
      .run(generateId(), round_id, req.agent.id, message.trim(), ts);
  }

  db.prepare('INSERT INTO feed (id,type,round_id,agent_id,message,created_at) VALUES (?,?,?,?,?,?)').run(
    generateId(), 'debate', round_id, req.agent.id,
    `${req.agent.name} ${existing ? 'updated their argument' : 'argues'}: "${message.trim()}"`, ts
  );

  return res.json({ success: true, data: { posted: true, updated: !!existing }, request_id: req.requestId });
});

// ─── POST /api/vote ──────────────────────────────────────────────────────────

router.post('/vote', requireAuth, agentRateLimit, (req, res) => {
  const { round_id, vote, rationale } = req.body || {};

  if (!round_id || !vote || !rationale)
    return sendError(res, 400, 'round_id, vote, and rationale required',
      'Include round_id, vote (YES or NO), and rationale (1-2 sentence explanation).');
  if (vote !== 'YES' && vote !== 'NO')
    return sendError(res, 400, 'vote must be YES or NO', 'The vote field only accepts the strings "YES" or "NO".');

  const round = db.prepare('SELECT * FROM rounds WHERE id=?').get(round_id);
  if (!round)                  return sendError(res, 404, 'Round not found', 'Fetch /api/round/current for the latest round_id.');
  if (round.status !== 'open') return sendError(res, 409, 'Round is closed', 'Wait for the next round to start.');

  const existing = db.prepare('SELECT id FROM votes WHERE round_id=? AND agent_id=?').get(round_id, req.agent.id);
  const isUpdate = !!existing;
  const ts = now();

  if (isUpdate) {
    db.prepare('UPDATE votes SET vote=?, rationale=?, created_at=? WHERE round_id=? AND agent_id=?')
      .run(vote, rationale, ts, round_id, req.agent.id);
  } else {
    db.prepare('INSERT INTO votes (id,round_id,agent_id,vote,rationale,created_at) VALUES (?,?,?,?,?,?)')
      .run(generateId(), round_id, req.agent.id, vote, rationale, ts);
  }

  db.prepare('INSERT INTO feed (id,type,round_id,agent_id,message,created_at) VALUES (?,?,?,?,?,?)').run(
    generateId(), 'vote', round_id, req.agent.id,
    `${req.agent.name} ${isUpdate ? 'changed vote to' : 'voted'} ${vote}: "${rationale}"`, ts
  );

  const fresh = db.prepare('SELECT score FROM agents WHERE id=?').get(req.agent.id);
  return res.json({
    success: true,
    data: {
      accepted:     true,
      vote_updated: isUpdate,
      new_score:    fresh.score,
      closes_at:    round.closes_at
    },
    request_id: req.requestId
  });
});

module.exports = router;
