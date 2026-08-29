/* Every account action, behind one function.

   Vercel's free plan allows a limited number of serverless functions, and a
   handful of tiny ones each doing a single verb would spend that allowance for
   nothing. The action is named in the request instead. */

import {
  findUserByEmail, createUser, updatePasswordHash, deleteUser,
  createResetToken, findResetToken, markResetTokenUsed, invalidateUserResetTokens,
  deleteUserSessions, userHasData, ensureSchema
} from '../lib/db.js';
import {
  hashPassword, verifyPassword, startSession, endSession, currentUser,
  normaliseEmail, isEmail, passwordProblem, randomToken, sha256, sameDigest,
  readBody, send, fail
} from '../lib/auth.js';
import { sendMail, resetEmail, emailMode } from '../lib/mail.js';

const RESET_MINUTES = Number(process.env.RESET_TOKEN_MINUTES) || 45;

/* Best effort only: each serverless instance keeps its own count, and instances
   come and go. It slows a burst from one place down; it is not a real limit.
   The passwords behind it are bcrypt at cost 12, which is the actual defence. */
const buckets = new Map();
function tooMany(name, key, windowMs, max) {
  const id = name + ':' + key;
  const now = Date.now();
  const hits = (buckets.get(id) || []).filter(t => now - t < windowMs);
  if (hits.length >= max) return true;
  hits.push(now);
  buckets.set(id, hits);
  return false;
}
const ipOf = req =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

const publicUser = u => ({ id: String(u.id), email: u.email });

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const body = readBody(req);
    const action = String(req.query.action || body.action || '');

    if (req.method === 'GET') {
      if (action === 'email-mode') return send(res, 200, { mode: emailMode() });
      // who am I
      const user = await currentUser(req);
      if (!user) return send(res, 200, { authenticated: false });
      return send(res, 200, {
        authenticated: true,
        user: publicUser(user),
        hasData: await userHasData(user.id)
      });
    }

    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });

    switch (action) {
      case 'signup':          return await signup(req, res, body);
      case 'login':           return await login(req, res, body);
      case 'logout':          return await logout(req, res);
      case 'forgot-password': return await forgot(req, res, body);
      case 'reset-password':  return await reset(req, res, body);
      case 'change-password': return await changePassword(req, res, body);
      case 'delete-account':  return await deleteAccount(req, res, body);
      default:                return send(res, 400, { error: 'Unknown action.' });
    }
  } catch (err) { return fail(res, err); }
}

/* ---------- sign up ---------- */
async function signup(req, res, body) {
  if (tooMany('signup', ipOf(req), 60 * 60000, 10)) {
    return send(res, 429, { error: 'Too many attempts. Please wait a little and try again.' });
  }
  const email = normaliseEmail(body.email);
  const { password, confirm } = body;

  if (!isEmail(email)) return send(res, 400, { error: 'That email address does not look right.' });
  const pw = passwordProblem(password);
  if (pw) return send(res, 400, { error: pw });
  if (password !== confirm) return send(res, 400, { error: 'Those two passwords do not match.' });

  // Signing up necessarily reveals that an address is taken; there is no way to
  // create the account otherwise. Login and reset stay silent about it.
  if (await findUserByEmail(email)) {
    return send(res, 409, { error: 'There is already an account with that email. Try logging in.' });
  }

  const user = await createUser(email, await hashPassword(password));
  await startSession(res, user.id);
  return send(res, 201, { ok: true, user: publicUser(user), hasData: false });
}

/* ---------- log in ---------- */
async function login(req, res, body) {
  if (tooMany('login', ipOf(req), 15 * 60000, 20)) {
    return send(res, 429, { error: 'Too many attempts. Please wait a little and try again.' });
  }
  const email = normaliseEmail(body.email);
  const password = body.password || '';
  const user = await findUserByEmail(email);

  // Hash even when there is no such user, so a wrong address and a wrong
  // password take the same time and cannot be told apart.
  const ok = user
    ? await verifyPassword(password, user.password_hash)
    : await verifyPassword(password, '$2a$12$' + 'x'.repeat(53));

  if (!user || !ok) return send(res, 401, { error: 'Invalid email or password.' });

  await startSession(res, user.id);
  return send(res, 200, { ok: true, user: publicUser(user), hasData: await userHasData(user.id) });
}

async function logout(req, res) {
  await endSession(req, res);
  return send(res, 200, { ok: true });
}

/* ---------- forgot password ---------- */
async function forgot(req, res, body) {
  // The same reply either way, so this cannot be used to find out who has an account.
  const reply = { ok: true, message: 'If that email has an account, a reset link is on its way.' };
  if (tooMany('forgot', ipOf(req), 15 * 60000, 8)) {
    return send(res, 429, { error: 'Too many attempts. Please wait a little and try again.' });
  }
  const email = normaliseEmail(body.email);
  if (!isEmail(email)) return send(res, 200, reply);

  const user = await findUserByEmail(email);
  if (!user) return send(res, 200, reply);

  await invalidateUserResetTokens(user.id);        // only the newest link works
  const token = randomToken();
  const expires = new Date(Date.now() + RESET_MINUTES * 60000);
  await createResetToken(user.id, sha256(token), expires.toISOString());

  const base = (process.env.APP_URL
    || (req.headers['x-forwarded-host'] ? 'https://' + req.headers['x-forwarded-host'] : 'http://localhost:3000')
  ).replace(/\/$/, '');
  const url = `${base}/reset-password?token=${token}`;

  await sendMail({ to: user.email, ...resetEmail(url, RESET_MINUTES) });
  return send(res, 200, reply);
}

/* ---------- reset password ---------- */
async function reset(req, res, body) {
  if (tooMany('reset', ipOf(req), 15 * 60000, 20)) {
    return send(res, 429, { error: 'Too many attempts. Please wait a little and try again.' });
  }
  const { token, password, confirm } = body;
  if (!token) return send(res, 400, { error: 'That reset link is not valid.' });

  const pw = passwordProblem(password);
  if (pw) return send(res, 400, { error: pw });
  if (password !== confirm) return send(res, 400, { error: 'Those two passwords do not match.' });

  const row = await findResetToken(sha256(token));
  if (!row || !sameDigest(sha256(token), row.token_hash)) {
    return send(res, 400, { error: 'That reset link is not valid.' });
  }
  if (row.used_at) return send(res, 400, { error: 'That reset link has already been used. Ask for a new one.' });
  if (new Date(row.expires_at) < new Date()) {
    return send(res, 400, { error: 'That reset link has expired. Ask for a new one.' });
  }

  await updatePasswordHash(row.user_id, await hashPassword(password));
  await markResetTokenUsed(row.id);
  await deleteUserSessions(row.user_id);            // every device is signed out
  return send(res, 200, { ok: true });
}

/* ---------- change password ---------- */
async function changePassword(req, res, body) {
  const me = await currentUser(req);
  if (!me) return send(res, 401, { error: 'Please log in.' });

  const full = await findUserByEmail(me.email);
  if (!full || !await verifyPassword(body.current || '', full.password_hash)) {
    return send(res, 401, { error: 'Your current password is not right.' });
  }
  const pw = passwordProblem(body.password);
  if (pw) return send(res, 400, { error: pw });
  if (body.password !== body.confirm) return send(res, 400, { error: 'Those two passwords do not match.' });

  await updatePasswordHash(me.id, await hashPassword(body.password));
  await invalidateUserResetTokens(me.id);
  await deleteUserSessions(me.id, me.sessionToken);  // other devices only
  return send(res, 200, { ok: true });
}

/* ---------- delete account ---------- */
async function deleteAccount(req, res, body) {
  const me = await currentUser(req);
  if (!me) return send(res, 401, { error: 'Please log in.' });

  const full = await findUserByEmail(me.email);
  if (!full || !await verifyPassword(body.password || '', full.password_hash)) {
    return send(res, 401, { error: 'Your password is not right.' });
  }
  await deleteUser(me.id);          // jars, wallet, savings and sessions cascade away
  await endSession(req, res);
  return send(res, 200, { ok: true });
}
