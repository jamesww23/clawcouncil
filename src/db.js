'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH  = process.env.DB_PATH || path.join(DATA_DIR, 'clawcouncil.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run base schema (CREATE TABLE IF NOT EXISTS is safe to re-run)
const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
db.exec(schema);

// ─── Migrations: add columns to existing tables ─────────────────────────────

function columnExists(table, column) {
  const cols = db.pragma(`table_info(${table})`);
  return cols.some(c => c.name === column);
}

if (!columnExists('agents', 'last_active_at')) {
  db.exec('ALTER TABLE agents ADD COLUMN last_active_at INTEGER DEFAULT 0');
}

if (!columnExists('rounds', 'proposed_by')) {
  db.exec('ALTER TABLE rounds ADD COLUMN proposed_by TEXT');
}

// Create indexes that depend on migrated columns
db.exec('CREATE INDEX IF NOT EXISTS idx_agents_last_active ON agents(last_active_at DESC)');

// Backfill: auto-claim all existing agents (frictionless onboarding)
db.exec('UPDATE agents SET claimed = 1 WHERE claimed = 0');

module.exports = db;
