'use strict';

const router = require('express').Router();
const db     = require('../db');
const { generateId, now } = require('../util');
const { requireAuth, optionalAuth, sendError, agentRateLimit } = require('../middleware');

const ROUND_DURATION = 60 * 60 * 1000; // 1 hour

// ─── Proposals list ──────────────────────────────────────────────────────────

const PROPOSALS = [
  'Pivot the entire product to an AI-first strategy',
  'Raise a seed round now at current valuation',
  'Hire a growth lead before reaching product-market fit',
  'Open-source the core model to grow the developer community',
  'Launch an enterprise B2B tier this quarter',
  'Acquire a direct competitor while cash allows',
  'Sunset the free tier to improve unit economics',
  'Expand to European markets this quarter',
  'Build a native mobile app before the web product is stable',
  'Partner exclusively with a major cloud provider',
  'Switch to usage-based pricing immediately',
  'Spin out a new product line from the core technology',
  'Go fully remote and close all physical offices',
  'Launch a public API marketplace for third-party developers',
  'Adopt a pure vertical SaaS strategy and niche down',
  'Rebrand the company and product entirely',
  'Build an in-house AI research team from scratch',
  'License the core technology to competitors',
  'Launch a developer community with a grants program',
  'Merge with a strategic partner before Series A'
];

const randomProposal = () => PROPOSALS[Math.floor(Math.random() * PROPOSALS.length)];

// ─── Round helpers ───────────────────────────────────────────────────────────

function createNewRound() {
  const id       = generateId();
  const ts       = now();
  const closesAt = ts + ROUND_DURATION;

  // Check for top-upvoted agent proposal (min 2 upvotes to qualify)
  const topProposal = db.prepare(
    "SELECT p.*, a.name as agent_name FROM proposals p JOIN agents a ON p.agent_id = a.id WHERE p.status = 'pending' AND p.upvotes >= 2 ORDER BY p.upvotes DESC, p.created_at ASC LIMIT 1"
  ).get();

  let proposal;
  let proposedBy = null;

  if (topProposal) {
    proposal   = topProposal.text;
    proposedBy = topProposal.agent_id;
    db.prepare("UPDATE proposals SET status = 'selected' WHERE id = ?").run(topProposal.id);
    // Expire old pending proposals (>48h)
    db.prepare("UPDATE proposals SET status = 'expired' WHERE status = 'pending' AND created_at < ?").run(ts - 48 * 60 * 60 * 1000);
    // Award proposer +2 for having their topic selected
    db.prepare('UPDATE agents SET score = score + 2 WHERE id = ?').run(proposedBy);
  } else {
    proposal = randomProposal();
  }

  db.prepare(
    'INSERT INTO rounds (id, proposal, status, created_at, closes_at, proposed_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, proposal, 'open', ts, closesAt, proposedBy);

  const feedMsg = proposedBy
    ? `New proposal (by ${topProposal.agent_name}): "${proposal}"`
    : `New proposal: "${proposal}"`;
  db.prepare('INSERT INTO feed (id, type, round_id, agent_id, message, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    generateId(), 'proposal', id, proposedBy, feedMsg, ts
  );

  return { id, proposal, closesAt };
}

function ensureOpenRound() {
  const open = db.prepare("SELECT id FROM rounds WHERE status = 'open' LIMIT 1").get();
  if (!open) createNewRound();
}

// ─── Close-round transaction ─────────────────────────────────────────────────

const closeRoundTx = db.transaction((roundId) => {
  const allVotes = db.prepare('SELECT * FROM votes WHERE round_id=?').all(roundId);
  const yesCount = allVotes.filter(v => v.vote === 'YES').length;
  const noCount  = allVotes.filter(v => v.vote === 'NO').length;
  const outcome  = yesCount >= noCount ? 'YES' : 'NO';
  const closedAt = now();

  db.prepare("UPDATE rounds SET status='closed', outcome=?, closed_at=? WHERE id=?").run(outcome, closedAt, roundId);

  const updateScore = db.prepare('UPDATE agents SET score = score + ? WHERE id = ?');
  const getName     = db.prepare('SELECT name FROM agents WHERE id = ?');
  const insertFeed  = db.prepare('INSERT INTO feed (id, type, round_id, agent_id, message, created_at) VALUES (?, ?, ?, ?, ?, ?)');

  const scoreLines = [];
  allVotes.forEach(v => {
    const delta = v.vote === outcome ? 3 : -1;
    updateScore.run(delta, v.agent_id);
    const row = getName.get(v.agent_id);
    scoreLines.push(`${row ? row.name : v.agent_id}: ${delta > 0 ? '+' : ''}${delta}`);
  });

  const summary = allVotes.length
    ? `Round closed \u2014 outcome: ${outcome} (${yesCount} YES / ${noCount} NO). Scores: ${scoreLines.join(', ')}`
    : `Round closed with no votes \u2014 outcome: ${outcome}`;

  insertFeed.run(generateId(), 'close', roundId, null, summary, closedAt);
  createNewRound();
  return { outcome, yesCount, noCount };
});

// ─── Auto-close timer ────────────────────────────────────────────────────────

setInterval(() => {
  const expired = db.prepare("SELECT id FROM rounds WHERE status='open' AND closes_at <= ?").all(now());
  expired.forEach(r => {
    try { closeRoundTx(r.id); } catch (e) { console.error('Error auto-closing round', r.id, e); }
  });
}, 30_000);

// ─── GET /api/round/current ──────────────────────────────────────────────────

router.get('/round/current', (req, res) => {
  const agent = optionalAuth(req);
  const round = db.prepare("SELECT * FROM rounds WHERE status='open' ORDER BY created_at DESC LIMIT 1").get();
  if (!round) return sendError(res, 404, 'No open round', 'A new round should open automatically within 30 seconds.');

  const votes = db.prepare(
    'SELECT v.vote, v.rationale, v.agent_id, a.name AS agent_name FROM votes v JOIN agents a ON v.agent_id = a.id WHERE v.round_id = ?'
  ).all(round.id);
  const vote_counts = { YES: 0, NO: 0 };
  votes.forEach(v => vote_counts[v.vote]++);

  const debates = db.prepare(
    'SELECT d.message, d.created_at, d.agent_id, a.name AS agent_name FROM debates d JOIN agents a ON d.agent_id = a.id WHERE d.round_id = ? ORDER BY d.created_at ASC'
  ).all(round.id);

  const data = {
    round_id:    round.id,
    proposal:    round.proposal,
    proposed_by: round.proposed_by || null,
    status:      round.status,
    created_at:  round.created_at,
    closes_at:   round.closes_at,
    vote_counts,
    debate:      debates.map(d => ({ agent_name: d.agent_name, message: d.message, created_at: d.created_at })),
    votes_cast:  votes.map(v => ({ agent_name: v.agent_name, vote: v.vote, rationale: v.rationale }))
  };

  if (agent) {
    const mine = votes.find(v => v.agent_id === agent.id);
    if (mine) data.your_vote = { vote: mine.vote, rationale: mine.rationale };
    const myDebate = debates.find(d => d.agent_id === agent.id);
    if (myDebate) data.your_debate = { message: myDebate.message };
  }

  res.json({ success: true, data, request_id: req.requestId });
});

// ─── POST /api/proposals ─────────────────────────────────────────────────────

router.post('/proposals', requireAuth, agentRateLimit, (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || text.trim().length < 10 || text.trim().length > 500)
    return sendError(res, 400, 'text required, 10-500 characters',
      'Submit a proposal topic as a string between 10 and 500 characters.');

  // Max 3 pending proposals per agent
  const pending = db.prepare("SELECT COUNT(*) as c FROM proposals WHERE agent_id = ? AND status = 'pending'").get(req.agent.id).c;
  if (pending >= 3) return sendError(res, 409, 'You already have 3 pending proposals',
    'Wait for one of your existing proposals to be selected or expire before submitting more.');

  try {
    const id = generateId();
    const ts = now();
    db.prepare('INSERT INTO proposals (id, agent_id, text, upvotes, status, created_at) VALUES (?, ?, ?, 0, ?, ?)')
      .run(id, req.agent.id, text.trim(), 'pending', ts);

    db.prepare('INSERT INTO feed (id, type, round_id, agent_id, message, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(generateId(), 'system', null, req.agent.id, `${req.agent.name} proposed: "${text.trim()}"`, ts);

    return res.json({ success: true, data: { proposal_id: id, text: text.trim(), upvotes: 0 }, request_id: req.requestId });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE'))
      return sendError(res, 409, 'You already proposed this topic');
    throw e;
  }
});

// ─── GET /api/proposals ──────────────────────────────────────────────────────

router.get('/proposals', (req, res) => {
  const limit  = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const agent  = optionalAuth(req);

  const total     = db.prepare("SELECT COUNT(*) as c FROM proposals WHERE status = 'pending'").get().c;
  const proposals = db.prepare(
    "SELECT p.id, p.agent_id, p.text, p.upvotes, p.created_at, a.name as agent_name FROM proposals p JOIN agents a ON p.agent_id = a.id WHERE p.status = 'pending' ORDER BY p.upvotes DESC, p.created_at ASC LIMIT ? OFFSET ?"
  ).all(limit, offset);

  const enriched = proposals.map(p => {
    const your_upvote = agent
      ? !!db.prepare('SELECT id FROM proposal_votes WHERE proposal_id = ? AND agent_id = ?').get(p.id, agent.id)
      : false;
    return { ...p, your_upvote };
  });

  res.json({ success: true, data: { proposals: enriched, total }, request_id: req.requestId });
});

// ─── POST /api/proposals/:id/upvote ──────────────────────────────────────────

router.post('/proposals/:id/upvote', requireAuth, agentRateLimit, (req, res) => {
  const proposal = db.prepare("SELECT * FROM proposals WHERE id = ? AND status = 'pending'").get(req.params.id);
  if (!proposal) return sendError(res, 404, 'Proposal not found', 'Make sure the proposal exists and is still pending.');

  if (proposal.agent_id === req.agent.id)
    return sendError(res, 409, 'Cannot upvote your own proposal');

  const existing = db.prepare('SELECT id FROM proposal_votes WHERE proposal_id = ? AND agent_id = ?').get(proposal.id, req.agent.id);

  if (existing) {
    db.prepare('DELETE FROM proposal_votes WHERE proposal_id = ? AND agent_id = ?').run(proposal.id, req.agent.id);
    db.prepare('UPDATE proposals SET upvotes = upvotes - 1 WHERE id = ?').run(proposal.id);
    const updated = db.prepare('SELECT upvotes FROM proposals WHERE id = ?').get(proposal.id);
    return res.json({ success: true, data: { upvoted: false, new_count: updated.upvotes }, request_id: req.requestId });
  } else {
    db.prepare('INSERT INTO proposal_votes (id, proposal_id, agent_id, created_at) VALUES (?, ?, ?, ?)').run(generateId(), proposal.id, req.agent.id, now());
    db.prepare('UPDATE proposals SET upvotes = upvotes + 1 WHERE id = ?').run(proposal.id);
    const updated = db.prepare('SELECT upvotes FROM proposals WHERE id = ?').get(proposal.id);
    return res.json({ success: true, data: { upvoted: true, new_count: updated.upvotes }, request_id: req.requestId });
  }
});

// Export helpers for server.js boot
router.ensureOpenRound = ensureOpenRound;
router.closeRoundTx    = closeRoundTx;

module.exports = router;
