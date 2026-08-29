/* Passwords, sessions and the cookie they travel in.

   The browser is given an opaque random token and nothing else — no id, no
   email, no hash. Who someone is is decided here, from that token, on every
   request. */

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createSession, findSession, findUserById, deleteSession, ensureSchema } from './db.js';

export const COOKIE = 'jars_sid';
const SESSION_DAYS = 30;
const ROUNDS = 12;

export const hashPassword = pw => bcrypt.hash(pw, ROUNDS);
export const verifyPassword = (pw, hash) => bcrypt.compare(pw, hash);
export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = v => crypto.createHash('sha256').update(String(v)).digest('hex');

/* Constant-time compare of two hex digests, so how far along they differ
   cannot be read off the clock. */
export function sameDigest(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ---------- cookies ---------- */
export function readCookie(req, name) {
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function cookieString(value, maxAgeSeconds) {
  const bits = [
    `${COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',                              // unreadable from JavaScript
    'SameSite=Lax',                          // survives normal navigation, blocks cross-site posts
    `Max-Age=${maxAgeSeconds}`
  ];
  // Vercel always serves over HTTPS; locally `vercel dev` is plain http.
  if (process.env.VERCEL) bits.push('Secure');
  return bits.join('; ');
}

export async function startSession(res, userId) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await createSession(token, userId, expires.toISOString());
  res.setHeader('Set-Cookie', cookieString(token, SESSION_DAYS * 86400));
  return token;
}

export async function endSession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) await deleteSession(token);
  res.setHeader('Set-Cookie', cookieString('', 0));
}

/* The only place an identity comes from. Nothing reads a user id out of a
   request body or query string, so a forged one has nowhere to land. */
export async function currentUser(req) {
  await ensureSchema();
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const session = await findSession(token);
  if (!session) return null;
  const user = await findUserById(session.user_id);
  return user ? { ...user, sessionToken: token } : null;
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

/* ---------- request helpers ---------- */
export function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return req.body;
}

export const send = (res, status, payload) => res.status(status).json(payload);

/* Errors reach the browser as a plain sentence. The detail goes to the log,
   where it is useful, rather than to the page, where it is a liability. */
export function fail(res, err) {
  console.error('[jars]', err);
  return send(res, 500, { error: 'Something went wrong on our side. Please try again.' });
}
