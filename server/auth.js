import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createSession, findSession, deleteSession, findUserById } from './db.js';

export const COOKIE = 'jars_sid';
const SESSION_DAYS = 30;
const ROUNDS = 12;

export const hashPassword = pw => bcrypt.hash(pw, ROUNDS);
export const verifyPassword = (pw, hash) => bcrypt.compare(pw, hash);

export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = v => crypto.createHash('sha256').update(String(v)).digest('hex');

/* ---------- recovery codes ----------
   Written down rather than remembered, so this is drawn at random rather than
   made memorable. 0/O and 1/I/L are left out because they get misread on paper.
   20 characters of a 31-letter alphabet is 99 bits — far past guessing. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function generateRecoveryCode() {
  const chars = [];
  // Rejection sampling, so every letter is equally likely.
  while (chars.length < 20) {
    const b = crypto.randomBytes(1)[0];
    if (b < 256 - (256 % CODE_ALPHABET.length)) chars.push(CODE_ALPHABET[b % CODE_ALPHABET.length]);
  }
  return chars.join('').replace(/(.{5})(?=.)/g, '$1-');   // XXXXX-XXXXX-XXXXX-XXXXX
}

/* Dashes, spaces and case are all forgiven when it's typed back in. */
export const normaliseCode = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/* Compares two hex digests without leaking, through timing, how far along they
   first differed. */
export function sameDigest(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function cookieOptions() {
  return {
    httpOnly: true,                                  // unreadable from JavaScript
    secure: process.env.NODE_ENV === 'production',   // HTTPS only once deployed
    sameSite: 'lax',                                 // survives normal navigation, blocks cross-site posts
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/'
  };
}

export function startSession(res, userId) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString().replace('T', ' ').slice(0, 19);
  createSession(token, userId, expires);
  res.cookie(COOKIE, token, cookieOptions());
  return token;
}

export function endSession(req, res) {
  const token = req.cookies?.[COOKIE];
  if (token) deleteSession(token);
  res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
}

/* Attaches req.user when the cookie maps to a live session. Never reads an
   identity from the request body or query. */
export function loadUser(req, _res, next) {
  req.user = null;
  const token = req.cookies?.[COOKIE];
  if (token) {
    const session = findSession(token);
    if (session) {
      const user = findUserById(session.user_id);
      if (user) { req.user = user; req.sessionToken = token; }
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in.' });
  next();
}

/* ---------- validation ---------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const normaliseEmail = v => String(v || '').trim().toLowerCase();
export const isEmail = v => EMAIL_RE.test(v) && v.length <= 254;
export const MIN_PASSWORD = 8;
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (pw.length > 200) return 'That password is too long.';
  return null;
}

/* ---------- rate limiting ----------
   In-memory, which is enough for one small server. Behind several instances
   this would need shared storage. */
const buckets = new Map();
export function rateLimit({ name, windowMs, max, key }) {
  return (req, res, next) => {
    // Namespaced, or every limiter would share one counter and the strictest
    // limit would end up applying to all of them.
    const id = `${name}:${key(req)}`;
    const now = Date.now();
    const hits = (buckets.get(id) || []).filter(t => now - t < windowMs);
    if (hits.length >= max) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a little and try again.' });
    }
    hits.push(now);
    buckets.set(id, hits);
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) {
    const live = v.filter(t => now - t < 3600000);
    if (live.length) buckets.set(k, live); else buckets.delete(k);
  }
}, 600000).unref();
