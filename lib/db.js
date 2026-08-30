/* Every SQL statement in the project lives here.

   Neon over HTTP: each query is one request, so there are no connections to
   pool or close — which is what makes it work on Vercel, where a function can
   vanish between requests. */

import { neon } from '@neondatabase/serverless';

/* Production always uses Neon. The one exception is the test suite, which puts
   an in-process Postgres here before this module loads so the whole data layer
   can be exercised without a network or an account. */
export const sql = globalThis.__jarsSql || neonClient();

function neonClient() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Add it in Vercel, or in .env.local for local work.');
  }
  return neon(process.env.DATABASE_URL);
}

/* Created on first use and remembered for the life of the instance, so the
   database needs no setup step before the app will run. */
let ready = null;
export function ensureSchema() {
  if (!ready) ready = createTables().catch(err => { ready = null; throw err; });
  return ready;
}

async function createTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            BIGSERIAL PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`;

  // Only the hash of a reset token is kept, so a leak of this table cannot be
  // turned back into a working reset link.
  await sql`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id         BIGSERIAL PRIMARY KEY,
      user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_reset_user ON password_reset_tokens(user_id)`;

  // (user_id, id) rather than id alone: two people can hold a jar with the same
  // client-generated id and never touch each other's.
  await sql`
    CREATE TABLE IF NOT EXISTS jars (
      user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id             TEXT NOT NULL,
      name           TEXT NOT NULL DEFAULT '',
      type           TEXT NOT NULL DEFAULT 'item',
      priority       TEXT NOT NULL DEFAULT 'medium',
      icon           TEXT DEFAULT '',
      category       TEXT DEFAULT '',
      target         DOUBLE PRECISION NOT NULL DEFAULT 0,
      saved          DOUBLE PRECISION NOT NULL DEFAULT 0,
      notes          TEXT DEFAULT '',
      why            TEXT DEFAULT '',
      tags           JSONB NOT NULL DEFAULT '[]'::jsonb,
      event_date     TEXT DEFAULT '',
      event_location TEXT DEFAULT '',
      photo          TEXT DEFAULT '',
      checklist      JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at     BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, id)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_jars_user ON jars(user_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS wallet_entries (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id      TEXT NOT NULL,
      amount  DOUBLE PRECISION NOT NULL DEFAULT 0,
      note    TEXT DEFAULT '',
      date    TEXT DEFAULT '',
      seq     BIGSERIAL,
      PRIMARY KEY (user_id, id)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_entries(user_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS savings_entries (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id      TEXT NOT NULL,
      amount  DOUBLE PRECISION NOT NULL DEFAULT 0,
      note    TEXT DEFAULT '',
      date    TEXT DEFAULT '',
      seq     BIGSERIAL,
      PRIMARY KEY (user_id, id)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_savings_user ON savings_entries(user_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS funding_log (
      id        BIGSERIAL PRIMARY KEY,
      user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount    DOUBLE PRECISION NOT NULL DEFAULT 0,
      date      TEXT DEFAULT '',
      goal_id   TEXT,
      goal_name TEXT
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_funding_user ON funding_log(user_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS prefs (
      user_id      BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      savings_goal DOUBLE PRECISION NOT NULL DEFAULT 20000
    )`;
}

/* ---------- users ---------- */
export const findUserByEmail = async email =>
  (await sql`SELECT * FROM users WHERE email = ${email}`)[0] || null;
export const findUserById = async id =>
  (await sql`SELECT id, email, created_at FROM users WHERE id = ${id}`)[0] || null;
export const createUser = async (email, hash) =>
  (await sql`INSERT INTO users (email, password_hash) VALUES (${email}, ${hash}) RETURNING id, email`)[0];
export const updatePasswordHash = (userId, hash) =>
  sql`UPDATE users SET password_hash = ${hash}, updated_at = now() WHERE id = ${userId}`;
export const deleteUser = userId => sql`DELETE FROM users WHERE id = ${userId}`;

/* ---------- sessions ---------- */
export const createSession = (token, userId, expiresAt) =>
  sql`INSERT INTO sessions (token, user_id, expires_at) VALUES (${token}, ${userId}, ${expiresAt})`;
export const findSession = async token =>
  (await sql`SELECT * FROM sessions WHERE token = ${token} AND expires_at > now()`)[0] || null;
export const deleteSession = token => sql`DELETE FROM sessions WHERE token = ${token}`;
export const deleteUserSessions = (userId, keep = null) =>
  keep
    ? sql`DELETE FROM sessions WHERE user_id = ${userId} AND token <> ${keep}`
    : sql`DELETE FROM sessions WHERE user_id = ${userId}`;

/* ---------- reset tokens ---------- */
export const createResetToken = (userId, tokenHash, expiresAt) =>
  sql`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
      VALUES (${userId}, ${tokenHash}, ${expiresAt})`;
export const findResetToken = async tokenHash =>
  (await sql`SELECT * FROM password_reset_tokens WHERE token_hash = ${tokenHash}`)[0] || null;
export const markResetTokenUsed = id =>
  sql`UPDATE password_reset_tokens SET used_at = now() WHERE id = ${id}`;
export const invalidateUserResetTokens = userId =>
  sql`UPDATE password_reset_tokens SET used_at = now() WHERE user_id = ${userId} AND used_at IS NULL`;

/* ---------- the planner's own data ----------
   Every read and write is filtered by user_id, and that id always comes from
   the session cookie — never from anything the browser sent. */

export async function getState(userId) {
  const [jars, wallet, savings, funding, pref] = await Promise.all([
    sql`SELECT * FROM jars WHERE user_id = ${userId} ORDER BY created_at`,
    sql`SELECT id, amount, note, date FROM wallet_entries WHERE user_id = ${userId} ORDER BY seq`,
    sql`SELECT id, amount, note, date FROM savings_entries WHERE user_id = ${userId} ORDER BY seq`,
    sql`SELECT amount, date, goal_id AS "goalId", goal_name AS "goalName" FROM funding_log WHERE user_id = ${userId} ORDER BY id`,
    sql`SELECT savings_goal FROM prefs WHERE user_id = ${userId}`
  ]);

  return {
    jars: jars.map(r => ({
      id: r.id, name: r.name, type: r.type, priority: r.priority, icon: r.icon,
      category: r.category, target: r.target, saved: r.saved, notes: r.notes, why: r.why,
      tags: r.tags || [], eventDate: r.event_date, eventLocation: r.event_location,
      photo: r.photo, checklist: r.checklist || [], createdAt: Number(r.created_at)
    })),
    wallet, savings, funding,
    savingsGoal: pref[0] ? pref[0].savings_goal : 20000
  };
}

/* Each collection is replaced whole. The delete and the inserts go in one
   transaction, so a failure halfway cannot leave someone with half their jars. */
export async function replaceJars(userId, jars) {
  const queries = [sql`DELETE FROM jars WHERE user_id = ${userId}`];
  for (const j of jars || []) {
    queries.push(sql`
      INSERT INTO jars (user_id, id, name, type, priority, icon, category, target, saved,
                        notes, why, tags, event_date, event_location, photo, checklist, created_at)
      VALUES (${userId}, ${String(j.id)}, ${String(j.name || '')},
              ${String(j.type || 'item')}, ${String(j.priority || 'medium')},
              ${String(j.icon || '')}, ${String(j.category || '')},
              ${Number(j.target) || 0}, ${Number(j.saved) || 0},
              ${String(j.notes || '')}, ${String(j.why || '')},
              ${JSON.stringify(Array.isArray(j.tags) ? j.tags : [])},
              ${String(j.eventDate || '')}, ${String(j.eventLocation || '')},
              ${String(j.photo || '')},
              ${JSON.stringify(Array.isArray(j.checklist) ? j.checklist : [])},
              ${Number(j.createdAt) || Date.now()})`);
  }
  await sql.transaction(queries);
}

async function replaceEntries(table, userId, rows) {
  const queries = table === 'wallet_entries'
    ? [sql`DELETE FROM wallet_entries WHERE user_id = ${userId}`]
    : [sql`DELETE FROM savings_entries WHERE user_id = ${userId}`];
  for (const e of rows || []) {
    const args = [userId, String(e.id), Number(e.amount) || 0, String(e.note || ''), String(e.date || '')];
    queries.push(table === 'wallet_entries'
      ? sql`INSERT INTO wallet_entries (user_id, id, amount, note, date)
            VALUES (${args[0]}, ${args[1]}, ${args[2]}, ${args[3]}, ${args[4]})`
      : sql`INSERT INTO savings_entries (user_id, id, amount, note, date)
            VALUES (${args[0]}, ${args[1]}, ${args[2]}, ${args[3]}, ${args[4]})`);
  }
  await sql.transaction(queries);
}
export const replaceWallet = (userId, rows) => replaceEntries('wallet_entries', userId, rows);
export const replaceSavings = (userId, rows) => replaceEntries('savings_entries', userId, rows);

export async function replaceFunding(userId, rows) {
  const queries = [sql`DELETE FROM funding_log WHERE user_id = ${userId}`];
  for (const f of rows || []) {
    queries.push(sql`
      INSERT INTO funding_log (user_id, amount, date, goal_id, goal_name)
      VALUES (${userId}, ${Number(f.amount) || 0}, ${String(f.date || '')},
              ${f.goalId ? String(f.goalId) : null}, ${f.goalName ? String(f.goalName) : null})`);
  }
  await sql.transaction(queries);
}

export const setSavingsGoal = (userId, value) =>
  sql`INSERT INTO prefs (user_id, savings_goal) VALUES (${userId}, ${Number(value) || 0})
      ON CONFLICT (user_id) DO UPDATE SET savings_goal = EXCLUDED.savings_goal`;

export async function userHasData(userId) {
  const r = await sql`
    SELECT (SELECT COUNT(*) FROM jars WHERE user_id = ${userId})
         + (SELECT COUNT(*) FROM wallet_entries WHERE user_id = ${userId}) AS n`;
  return Number(r[0].n) > 0;
}
