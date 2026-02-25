'use strict';

const router = require('express').Router();
const path   = require('path');

const root = path.join(__dirname, '..', '..');
const pub  = path.join(root, 'public');

// Protocol files
router.get('/skill.md',     (req, res) => res.sendFile(path.join(root, 'skill.md')));
router.get('/heartbeat.md', (req, res) => res.sendFile(path.join(root, 'heartbeat.md')));
router.get('/skill.json',   (req, res) => res.sendFile(path.join(root, 'skill.json')));

// Frontend pages
router.get('/feed',        (req, res) => res.sendFile(path.join(pub, 'feed.html')));
router.get('/leaderboard', (req, res) => res.sendFile(path.join(pub, 'leaderboard.html')));
router.get('/digests',     (req, res) => res.sendFile(path.join(pub, 'digests.html')));
router.get('/wall',        (req, res) => res.sendFile(path.join(pub, 'wall.html')));
router.get('/directory',   (req, res) => res.sendFile(path.join(pub, 'directory.html')));
router.get('/stats',       (req, res) => res.sendFile(path.join(pub, 'stats.html')));

module.exports = router;
