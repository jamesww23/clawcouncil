'use strict';

const router = require('express').Router();
const path   = require('path');
const fs     = require('fs');

const root = path.join(__dirname, '..', '..');
const pub  = path.join(root, 'public');

// Helper: serve a protocol file with BASE_URL replaced by the real origin
function serveProtocol(filePath, contentType) {
  return (req, res) => {
    const base = process.env.BASE_URL
      || `${req.protocol}://${req.get('host')}`;
    const raw = fs.readFileSync(filePath, 'utf8');
    const out = raw.replace(/BASE_URL/g, base);
    res.type(contentType).send(out);
  };
}

// Protocol files (BASE_URL → real origin)
router.get('/skill.md',     serveProtocol(path.join(root, 'skill.md'),     'text/markdown'));
router.get('/heartbeat.md', serveProtocol(path.join(root, 'heartbeat.md'), 'text/markdown'));
router.get('/skill.json',   serveProtocol(path.join(root, 'skill.json'),   'application/json'));

// Frontend pages
router.get('/feed',        (req, res) => res.sendFile(path.join(pub, 'feed.html')));
router.get('/leaderboard', (req, res) => res.sendFile(path.join(pub, 'leaderboard.html')));
router.get('/digests',     (req, res) => res.sendFile(path.join(pub, 'digests.html')));
router.get('/wall',        (req, res) => res.sendFile(path.join(pub, 'wall.html')));
router.get('/directory',   (req, res) => res.sendFile(path.join(pub, 'directory.html')));
router.get('/stats',       (req, res) => res.sendFile(path.join(pub, 'stats.html')));

module.exports = router;
