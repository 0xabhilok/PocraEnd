const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

let db = null;

function initDb() {
  const dbPath = path.join(app.getPath('userData'), 'pocraend.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      personality TEXT NOT NULL DEFAULT 'dark_humor',
      gemini_api_key TEXT,
      default_duration_min INTEGER DEFAULT 25,
      onboarding_completed INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      topic TEXT NOT NULL,
      work_type TEXT,
      planned_duration_min INTEGER,
      actual_duration_min INTEGER DEFAULT 0,
      drifts_count INTEGER DEFAULT 0,
      grinds_count INTEGER DEFAULT 0,
      snoozes_count INTEGER DEFAULT 0,
      completed INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS drift_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      distraction_url TEXT,
      distraction_title TEXT,
      classification_source TEXT,
      confidence REAL,
      user_action TEXT,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS session_whitelist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      url_pattern TEXT,
      domain TEXT,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS motivations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Make sure settings row exists
  const exists = db.prepare('SELECT id FROM settings WHERE id = 1').get();
  if (!exists) {
    db.prepare('INSERT INTO settings (id) VALUES (1)').run();
  }
}

function getDb() {
  if (!db) throw new Error('DB not initialized');
  return db;
}

// --- Settings ---
function getSettings() {
  return getDb().prepare('SELECT * FROM settings WHERE id = 1').get();
}

function updateSettings(patch) {
  const allowed = ['personality', 'gemini_api_key', 'default_duration_min', 'onboarding_completed'];
  const updates = [];
  const values = [];
  for (const [k, v] of Object.entries(patch)) {
    if (allowed.includes(k)) {
      updates.push(`${k} = ?`);
      values.push(v);
    }
  }
  if (updates.length === 0) return;
  getDb().prepare(`UPDATE settings SET ${updates.join(', ')} WHERE id = 1`).run(...values);
}

// --- Sessions ---
function createSession({ topic, workType, plannedDurationMin }) {
  const result = getDb().prepare(`
    INSERT INTO sessions (topic, work_type, planned_duration_min)
    VALUES (?, ?, ?)
  `).run(topic, workType, plannedDurationMin);
  return result.lastInsertRowid;
}

function endSession(sessionId, { actualDurationMin, completed }) {
  getDb().prepare(`
    UPDATE sessions
    SET ended_at = CURRENT_TIMESTAMP,
        actual_duration_min = ?,
        completed = ?
    WHERE id = ?
  `).run(actualDurationMin, completed ? 1 : 0, sessionId);
}

function getSession(sessionId) {
  return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
}

function incrementSessionCounter(sessionId, field) {
  const allowed = ['drifts_count', 'grinds_count', 'snoozes_count'];
  if (!allowed.includes(field)) return;
  getDb().prepare(`UPDATE sessions SET ${field} = ${field} + 1 WHERE id = ?`).run(sessionId);
}

// --- Drift events ---
function logDriftEvent(event) {
  getDb().prepare(`
    INSERT INTO drift_events (session_id, distraction_url, distraction_title, classification_source, confidence, user_action)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    event.session_id,
    event.distraction_url || null,
    event.distraction_title || null,
    event.classification_source || 'local',
    event.confidence || null,
    event.user_action || null
  );
}

// --- Whitelist ---
function addToSessionWhitelist(sessionId, { url, domain }) {
  getDb().prepare(`
    INSERT INTO session_whitelist (session_id, url_pattern, domain)
    VALUES (?, ?, ?)
  `).run(sessionId, url || null, domain || null);
}

function getSessionWhitelist(sessionId) {
  return getDb().prepare('SELECT * FROM session_whitelist WHERE session_id = ?').all(sessionId);
}

// --- Stats / Dashboard ---
function getDashboardData() {
  const totalSessions = getDb().prepare('SELECT COUNT(*) as c FROM sessions WHERE completed = 1').get().c;
  const weekMinutes = getDb().prepare(`
    SELECT COALESCE(SUM(actual_duration_min), 0) as m
    FROM sessions
    WHERE started_at >= datetime('now', '-7 days')
  `).get().m;
  const lastSession = getDb().prepare(`
    SELECT * FROM sessions
    WHERE actual_duration_min > 0
    ORDER BY id DESC LIMIT 1
  `).get();

  // Simple streak calc: consecutive days with at least one session
  const days = getDb().prepare(`
    SELECT DISTINCT date(started_at) as d
    FROM sessions
    WHERE actual_duration_min > 0
    ORDER BY d DESC
  `).all().map(r => r.d);

  let streak = 0;
  const today = new Date().toISOString().slice(0, 10);
  let cursor = new Date(today);
  for (const d of days) {
    if (d === cursor.toISOString().slice(0, 10)) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else if (streak === 0 && d === new Date(Date.now() - 86400000).toISOString().slice(0, 10)) {
      // yesterday counts as a streak start if today is empty
      streak++;
      cursor = new Date(Date.now() - 86400000 * 2);
    } else {
      break;
    }
  }

  return { totalSessions, weekMinutes, lastSession, streak };
}

// --- Motivations ---
function getMotivations() {
  return getDb().prepare('SELECT * FROM motivations ORDER BY created_at ASC').all();
}

function addMotivation(text) {
  const result = getDb().prepare('INSERT INTO motivations (text) VALUES (?)').run(text.trim());
  return result.lastInsertRowid;
}

function deleteMotivation(id) {
  getDb().prepare('DELETE FROM motivations WHERE id = ?').run(id);
}

module.exports = {
  initDb,
  getDb,
  getSettings,
  updateSettings,
  createSession,
  endSession,
  getSession,
  incrementSessionCounter,
  logDriftEvent,
  addToSessionWhitelist,
  getSessionWhitelist,
  getDashboardData,
  getMotivations,
  addMotivation,
  deleteMotivation
};
