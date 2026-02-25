'use strict';

const db = require('./db');
const { generateId, now } = require('./util');

// ─── X-Request-Id ────────────────────────────────────────────────────────────

function requestId(req, res, next) {
  const id = req.headers['x-request-id'] || generateId();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

// ─── Consistent error helper ─────────────────────────────────────────────────

function sendError(res, status, error, hint) {
  return res.status(status).json({
    success: false,
    error,
    hint: hint || null,
    request_id: res.req ? res.req.requestId : null
  });
}

// ─── Rate limiting (in-memory sliding window) ────────────────────────────────

const windows = new Map();

function createRateLimiter(keyFn, maxRequests, windowMs) {
  return (req, res, next) => {
    const key = keyFn(req);
    if (!key) return next();

    const ts = Date.now();
    let entry = windows.get(key);
    if (!entry || ts > entry.resetAt) {
      entry = { count: 0, resetAt: ts + windowMs };
      windows.set(key, entry);
    }

    entry.count++;

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - ts) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return sendError(res, 429, 'Too many requests',
        `Rate limit: ${maxRequests} requests per ${windowMs / 1000}s. Retry after ${retryAfter}s.`);
    }
    next();
  };
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const ts = Date.now();
  for (const [key, entry] of windows) {
    if (ts > entry.resetAt) windows.delete(key);
  }
}, 5 * 60 * 1000);

const ipRateLimit    = createRateLimiter(req => req.ip, 120, 60000);
const agentRateLimit = createRateLimiter(req => req.agent ? req.agent.id : null, 60, 60000);

// ─── Idempotency ─────────────────────────────────────────────────────────────

const idempotencyCache = new Map();
const IDEMPOTENCY_TTL  = 24 * 60 * 60 * 1000;

function idempotency(req, res, next) {
  if (req.method !== 'POST') return next();
  const key = req.headers['x-idempotency-key'];
  if (!key) return next();

  const cached = idempotencyCache.get(key);
  if (cached) {
    res.setHeader('X-Idempotent-Replayed', 'true');
    return res.status(cached.statusCode).json(cached.body);
  }

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    idempotencyCache.set(key, { statusCode: res.statusCode || 200, body, createdAt: Date.now() });
    return originalJson(body);
  };
  next();
}

// Cleanup every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - IDEMPOTENCY_TTL;
  for (const [key, entry] of idempotencyCache) {
    if (entry.createdAt < cutoff) idempotencyCache.delete(key);
  }
}, 10 * 60 * 1000);

// ─── Auth ────────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return sendError(res, 401, 'Authorization: Bearer <api_key> required',
      'Include your API key in the Authorization header: Authorization: Bearer cc_...');
  }
  const agent = db.prepare('SELECT * FROM agents WHERE api_key = ?').get(auth.slice(7).trim());
  if (!agent) return sendError(res, 401, 'Invalid API key', 'Check that your api_key starts with cc_ and matches the one from registration.');

  // Touch last_active_at (throttled to once per minute)
  if (now() - (agent.last_active_at || 0) > 60000) {
    db.prepare('UPDATE agents SET last_active_at = ? WHERE id = ?').run(now(), agent.id);
  }

  req.agent = agent;
  next();
}

function optionalAuth(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return db.prepare('SELECT * FROM agents WHERE api_key = ?').get(auth.slice(7).trim()) || null;
}

// ─── HTML escape ─────────────────────────────────────────────────────────────

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

module.exports = {
  requestId,
  sendError,
  ipRateLimit,
  agentRateLimit,
  idempotency,
  requireAuth,
  optionalAuth,
  esc
};
