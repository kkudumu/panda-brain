'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'council-chat.db');
const db = new Database(dbPath);

// WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    context_payload TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    author TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('chat', 'tool', 'system', 'error')),
    content TEXT NOT NULL,
    screenname TEXT,
    timestamp TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session_timestamp
    ON messages (session_id, timestamp);
`);

// Prepared statements
const stmtInsertSession = db.prepare(
  'INSERT INTO sessions (id, topic, context_payload) VALUES (?, ?, ?)'
);

const stmtInsertMessage = db.prepare(
  'INSERT INTO messages (session_id, author, type, content, screenname) VALUES (?, ?, ?, ?, ?)'
);

const stmtGetMessage = db.prepare(
  'SELECT * FROM messages WHERE id = ?'
);

const stmtGetHistory = db.prepare(
  'SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC LIMIT ?'
);

const stmtGetSummary = db.prepare(
  "SELECT content FROM messages WHERE session_id = ? AND author = 'system' AND type = 'system' ORDER BY timestamp DESC LIMIT 1"
);

/**
 * Create a new chat session.
 * @param {string} topic
 * @param {object|string|null} contextPayload - JSON-serializable data or null
 * @returns {string} session ID
 */
function createSession(topic, contextPayload = null) {
  const id = crypto.randomUUID();
  const payload = contextPayload !== null ? JSON.stringify(contextPayload) : null;
  stmtInsertSession.run(id, topic, payload);
  return id;
}

/**
 * Add a message to a session.
 * @param {string} sessionId
 * @param {string} author
 * @param {string} type - 'chat' | 'tool' | 'system' | 'error'
 * @param {string} content
 * @param {string|null} screenname
 * @returns {object} inserted message object
 */
function addMessage(sessionId, author, type, content, screenname = null) {
  const result = stmtInsertMessage.run(sessionId, author, type, content, screenname);
  return stmtGetMessage.get(result.lastInsertRowid);
}

/**
 * Get last N messages for a session, ordered by timestamp ASC.
 * @param {string} sessionId
 * @param {number} limit
 * @returns {Array<object>}
 */
function getHistory(sessionId, limit = 20) {
  return stmtGetHistory.all(sessionId, limit);
}

/**
 * Get the most recent system summary for a session.
 * @param {string} sessionId
 * @returns {string} summary content or empty string
 */
function getSummary(sessionId) {
  const row = stmtGetSummary.get(sessionId);
  return row ? row.content : '';
}

module.exports = { createSession, addMessage, getHistory, getSummary };
