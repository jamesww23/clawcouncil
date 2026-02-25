'use strict';

const express = require('express');
const path    = require('path');
const { requestId, ipRateLimit, idempotency } = require('./middleware');
const agentsRouter = require('./routes/agents');
const roundsRouter = require('./routes/rounds');

const app  = express();
const PORT = process.env.PORT || 3000;

// Trust Railway's reverse proxy so req.protocol returns 'https'
app.set('trust proxy', 1);

// ─── Global middleware ───────────────────────────────────────────────────────

app.use(requestId);
app.use(express.json());
app.use(ipRateLimit);
app.use(idempotency);
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── API routes ──────────────────────────────────────────────────────────────

app.use('/api/agents',  agentsRouter);
app.use('/api',         roundsRouter);
app.use('/api',         require('./routes/game'));
app.use('/api/digests', require('./routes/digests'));
app.use('/api/wall',    require('./routes/wall'));
app.use('/api',         require('./routes/feed'));

// ─── Frontend routes ─────────────────────────────────────────────────────────

app.use(require('./routes/pages'));

// Claim page (special HTML handler)
app.get('/claim/:token', agentsRouter.claimPage);

// ─── Boot ────────────────────────────────────────────────────────────────────

roundsRouter.ensureOpenRound();
app.listen(PORT, () => console.log(`\ud83e\udd80 ClawCouncil listening on http://localhost:${PORT}`));
