// All SQL lives here. Swapping SQLite for Postgres later means rewriting this
// one file; nothing else in the app issues queries directly.

import { DatabaseSync } from 'node:sqlite';   // built into Node, no native build
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const file = process.env.DATABASE_FILE || './data/jars.db';
mkdirSync(dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// node:sqlite has no transaction helper, so wrap one by hand.
function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN');
    try { const out = fn(...args); db.exec('COMMIT'); return out; }
    catch (err) { db.exec('ROLLBACK'); throw err; }
  };
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  -- Only the hash of a reset token is kept, so a database leak cannot be
  -- turned into a working reset link.
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_reset_user ON password_reset_tokens(user_id);

  CREATE TABLE IF NOT EXISTS jars (
    id             TEXT NOT NULL,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    type           TEXT NOT NULL DEFAULT 'item',
    priority       TEXT NOT NULL DEFAULT 'medium',
    icon           TEXT DEFAULT '',
    category       TEXT DEFAULT '',
    target         REAL NOT NULL DEFAULT 0,
    saved          REAL NOT NULL DEFAULT 0,
    notes          TEXT DEFAULT '',
    why            TEXT DEFAULT '',
    tags           TEXT DEFAULT '[]',
    event_date     TEXT DEFAULT '',
    event_location TEXT DEFAULT '',
    photo          TEXT DEFAULT '',
    checklist      TEXT DEFAULT '[]',
    created_at     INTEGER NOT NULL,
    updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_jars_user ON jars(user_id);

  CREATE TABLE IF NOT EXISTS wallet_entries (
    id         TEXT NOT NULL,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount     REAL NOT NULL,
    note       TEXT DEFAULT '',
    date       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_entries(user_id);

  CREATE TABLE IF NOT EXISTS savings_entries (
    id         TEXT NOT NULL,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount     REAL NOT NULL,
    note       TEXT DEFAULT '',
    date       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_savings_user ON savings_entries(user_id);

  CREATE TABLE IF NOT EXISTS funding_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount     REAL NOT NULL,
    date       TEXT NOT NULL,
    goal_id    TEXT,
    goal_name  TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_funding_user ON funding_log(user_id);

  CREATE TABLE IF NOT EXISTS prefs (
    user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    savings_goal REAL NOT NULL DEFAULT 20000,
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

/* Added after the first release, so it has to be a migration rather than part
   of CREATE TABLE — existing accounts keep their rows and start with no code. */
const userColumns = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userColumns.includes('recovery_code_hash')) {
  db.exec('ALTER TABLE users ADD COLUMN recovery_code_hash TEXT');
  db.exec('ALTER TABLE users ADD COLUMN recovery_code_set_at TEXT');
}

/* ---------- users ---------- */
export const findUserByEmail = email =>
  db.prepare('SELECT * FROM users WHERE email = ?').get(email);
export const findUserById = id =>
  db.prepare('SELECT id, email, created_at FROM users WHERE id = ?').get(id);
export const createUser = (email, hash) =>
  db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hash);
export const updatePasswordHash = (userId, hash) =>
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .run(hash, userId);
export const deleteUser = userId =>
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);

/* ---------- recovery code ----------
   A single spare key to the account, for when email isn't an option. Only its
   hash is kept, so the stored value cannot be used to get in. */
export const setRecoveryCode = (userId, hash) =>
  db.prepare("UPDATE users SET recovery_code_hash = ?, recovery_code_set_at = datetime('now') WHERE id = ?")
    .run(hash, userId);
export const clearRecoveryCode = userId =>
  db.prepare('UPDATE users SET recovery_code_hash = NULL, recovery_code_set_at = NULL WHERE id = ?')
    .run(userId);
export const recoveryCodeSetAt = userId =>
  db.prepare('SELECT recovery_code_set_at AS at FROM users WHERE id = ?').get(userId)?.at || null;

/* ---------- sessions ---------- */
export const createSession = (token, userId, expiresAt) =>
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, expiresAt);
export const findSession = token =>
  db.prepare("SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')").get(token);
export const deleteSession = token =>
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
export const deleteUserSessions = (userId, keepToken = null) =>
  keepToken
    ? db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, keepToken)
    : db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
export const purgeExpiredSessions = () =>
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();

/* ---------- reset tokens ---------- */
export const createResetToken = (userId, tokenHash, expiresAt) =>
  db.prepare('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .run(userId, tokenHash, expiresAt);
export const findResetToken = tokenHash =>
  db.prepare('SELECT * FROM password_reset_tokens WHERE token_hash = ?').get(tokenHash);
export const markResetTokenUsed = id =>
  db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?").run(id);
export const invalidateUserResetTokens = userId =>
  db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL")
    .run(userId);

/* ---------- the planner's own data ----------
   Every read and write is filtered by user_id, which always comes from the
   session — never from anything the browser sent. */

export function getState(userId) {
  const jars = db.prepare('SELECT * FROM jars WHERE user_id = ? ORDER BY created_at').all(userId)
    .map(r => ({
      id: r.id, name: r.name, type: r.type, priority: r.priority, icon: r.icon,
      category: r.category, target: r.target, saved: r.saved, notes: r.notes, why: r.why,
      tags: safeParse(r.tags, []), eventDate: r.event_date, eventLocation: r.event_location,
      photo: r.photo, checklist: safeParse(r.checklist, []), createdAt: r.created_at
    }));

  const wallet = db.prepare('SELECT id, amount, note, date FROM wallet_entries WHERE user_id = ? ORDER BY rowid').all(userId);
  const savings = db.prepare('SELECT id, amount, note, date FROM savings_entries WHERE user_id = ? ORDER BY rowid').all(userId);
  const funding = db.prepare('SELECT amount, date, goal_id AS goalId, goal_name AS goalName FROM funding_log WHERE user_id = ? ORDER BY rowid').all(userId);
  const pref = db.prepare('SELECT savings_goal FROM prefs WHERE user_id = ?').get(userId);

  return { jars, wallet, savings, funding, savingsGoal: pref ? pref.savings_goal : 20000 };
}

function safeParse(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

export const replaceJars = transaction((userId, jars) => {
  db.prepare('DELETE FROM jars WHERE user_id = ?').run(userId);
  const ins = db.prepare(`INSERT INTO jars
    (id, user_id, name, type, priority, icon, category, target, saved, notes, why, tags,
     event_date, event_location, photo, checklist, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const j of jars) {
    ins.run(
      String(j.id), userId, String(j.name || ''),
      String(j.type || 'item'), String(j.priority || 'medium'),
      String(j.icon || ''), String(j.category || ''),
      Number(j.target) || 0, Number(j.saved) || 0,
      String(j.notes || ''), String(j.why || ''),
      JSON.stringify(Array.isArray(j.tags) ? j.tags : []),
      String(j.eventDate || ''), String(j.eventLocation || ''),
      String(j.photo || ''),
      JSON.stringify(Array.isArray(j.checklist) ? j.checklist : []),
      Number(j.createdAt) || Date.now()
    );
  }
});

const replaceEntries = table => transaction((userId, rows) => {
  db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
  const ins = db.prepare(`INSERT INTO ${table} (id, user_id, amount, note, date) VALUES (?, ?, ?, ?, ?)`);
  for (const e of rows) {
    ins.run(String(e.id), userId, Number(e.amount) || 0, String(e.note || ''), String(e.date || ''));
  }
});
export const replaceWallet = replaceEntries('wallet_entries');
export const replaceSavings = replaceEntries('savings_entries');

export const replaceFunding = transaction((userId, rows) => {
  db.prepare('DELETE FROM funding_log WHERE user_id = ?').run(userId);
  const ins = db.prepare('INSERT INTO funding_log (user_id, amount, date, goal_id, goal_name) VALUES (?, ?, ?, ?, ?)');
  for (const f of rows) {
    ins.run(userId, Number(f.amount) || 0, String(f.date || ''), f.goalId ? String(f.goalId) : null, f.goalName ? String(f.goalName) : null);
  }
});

export const setSavingsGoal = (userId, value) =>
  db.prepare(`INSERT INTO prefs (user_id, savings_goal) VALUES (?, ?)
              ON CONFLICT(user_id) DO UPDATE SET savings_goal = excluded.savings_goal,
              updated_at = datetime('now')`).run(userId, Number(value) || 0);

export const userHasData = userId =>
  db.prepare('SELECT (SELECT COUNT(*) FROM jars WHERE user_id = ?) + (SELECT COUNT(*) FROM wallet_entries WHERE user_id = ?) AS n')
    .get(userId, userId).n > 0;
