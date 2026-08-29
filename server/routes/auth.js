import { Router } from 'express';
import {
  findUserByEmail, findUserById, createUser, updatePasswordHash, deleteUser,
  createResetToken, findResetToken, markResetTokenUsed, invalidateUserResetTokens,
  deleteUserSessions, userHasData
} from '../db.js';
import {
  hashPassword, verifyPassword, startSession, endSession, requireAuth,
  normaliseEmail, isEmail, passwordProblem, randomToken, sha256, rateLimit
} from '../auth.js';
import { sendMail, resetEmail, emailMode } from '../email.js';

const router = Router();
const RESET_MINUTES = Number(process.env.RESET_TOKEN_MINUTES) || 45;

const byIp = req => req.ip || 'unknown';
const loginLimit  = rateLimit({ name: 'login',  windowMs: 15 * 60000, max: 10, key: byIp });
const signupLimit = rateLimit({ name: 'signup', windowMs: 60 * 60000, max: 5,  key: byIp });
const forgotLimit = rateLimit({ name: 'forgot', windowMs: 15 * 60000, max: 5,  key: byIp });
const resetLimit  = rateLimit({ name: 'reset',  windowMs: 15 * 60000, max: 10, key: byIp });

const publicUser = u => ({ id: u.id, email: u.email });

/* ---------- who am I ---------- */
router.get('/me', (req, res) => {
  if (!req.user) return res.json({ authenticated: false });
  res.json({ authenticated: true, user: publicUser(req.user), hasData: userHasData(req.user.id) });
});

/* ---------- sign up ---------- */
router.post('/signup', signupLimit, async (req, res, next) => {
  try {
    const email = normaliseEmail(req.body?.email);
    const { password, confirm } = req.body || {};

    if (!isEmail(email)) return res.status(400).json({ error: 'That email address does not look right.' });
    const pwProblem = passwordProblem(password);
    if (pwProblem) return res.status(400).json({ error: pwProblem });
    if (password !== confirm) return res.status(400).json({ error: 'Those two passwords do not match.' });

    if (findUserByEmail(email)) {
      // Signup necessarily reveals that an address is taken; there is no way to
      // create the account otherwise. Login and reset stay silent.
      return res.status(409).json({ error: 'There is already an account with that email. Try logging in.' });
    }

    const info = createUser(email, await hashPassword(password));
    startSession(res, info.lastInsertRowid);
    res.status(201).json({ ok: true, user: { id: info.lastInsertRowid, email } });
  } catch (err) { next(err); }
});

/* ---------- log in ---------- */
router.post('/login', loginLimit, async (req, res, next) => {
  try {
    const email = normaliseEmail(req.body?.email);
    const password = req.body?.password || '';
    const user = findUserByEmail(email);

    // Hash even when the user is missing, so a wrong email and a wrong password
    // take the same time and cannot be told apart.
    const ok = user
      ? await verifyPassword(password, user.password_hash)
      : await verifyPassword(password, '$2a$12$' + 'x'.repeat(53));

    if (!user || !ok) return res.status(401).json({ error: 'Invalid email or password.' });

    startSession(res, user.id);
    res.json({ ok: true, user: publicUser(user), hasData: userHasData(user.id) });
  } catch (err) { next(err); }
});

/* ---------- log out ---------- */
router.post('/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

/* ---------- forgot password ---------- */
router.post('/forgot-password', forgotLimit, async (req, res, next) => {
  try {
    const email = normaliseEmail(req.body?.email);
    // Always the same reply, so this cannot be used to discover who has an account.
    const reply = { ok: true, message: 'If that email has an account, a reset link is on its way.' };
    if (!isEmail(email)) return res.json(reply);

    const user = findUserByEmail(email);
    if (!user) return res.json(reply);

    invalidateUserResetTokens(user.id);           // only the newest link works
    const token = randomToken();
    const expires = new Date(Date.now() + RESET_MINUTES * 60000).toISOString().replace('T', ' ').slice(0, 19);
    createResetToken(user.id, sha256(token), expires);

    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const url = `${base}/reset-password?token=${token}`;
    const mail = resetEmail(url, RESET_MINUTES);
    await sendMail({ to: user.email, ...mail });

    res.json(reply);
  } catch (err) { next(err); }
});

/* ---------- reset password ---------- */
router.post('/reset-password', resetLimit, async (req, res, next) => {
  try {
    const { token, password, confirm } = req.body || {};
    if (!token) return res.status(400).json({ error: 'That reset link is not valid.' });

    const pwProblem = passwordProblem(password);
    if (pwProblem) return res.status(400).json({ error: pwProblem });
    if (password !== confirm) return res.status(400).json({ error: 'Those two passwords do not match.' });

    const row = findResetToken(sha256(token));
    if (!row) return res.status(400).json({ error: 'That reset link is not valid.' });
    if (row.used_at) return res.status(400).json({ error: 'That reset link has already been used. Ask for a new one.' });
    if (new Date(row.expires_at.replace(' ', 'T') + 'Z') < new Date()) {
      return res.status(400).json({ error: 'That reset link has expired. Ask for a new one.' });
    }

    updatePasswordHash(row.user_id, await hashPassword(password));
    markResetTokenUsed(row.id);
    deleteUserSessions(row.user_id);   // anyone already signed in is signed out
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ---------- change password ---------- */
router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { current, password, confirm } = req.body || {};
    const full = findUserByEmail(req.user.email);
    if (!full || !await verifyPassword(current || '', full.password_hash)) {
      return res.status(401).json({ error: 'Your current password is not right.' });
    }
    const pwProblem = passwordProblem(password);
    if (pwProblem) return res.status(400).json({ error: pwProblem });
    if (password !== confirm) return res.status(400).json({ error: 'Those two passwords do not match.' });

    updatePasswordHash(req.user.id, await hashPassword(password));
    invalidateUserResetTokens(req.user.id);
    deleteUserSessions(req.user.id, req.sessionToken);   // other devices signed out
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ---------- delete account ---------- */
router.post('/delete-account', requireAuth, async (req, res, next) => {
  try {
    const full = findUserByEmail(req.user.email);
    if (!full || !await verifyPassword(req.body?.password || '', full.password_hash)) {
      return res.status(401).json({ error: 'Your password is not right.' });
    }
    deleteUser(req.user.id);   // jars, wallet, savings and sessions cascade away
    endSession(req, res);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/email-mode', (_req, res) => res.json({ mode: emailMode() }));

export default router;
