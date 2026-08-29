// Shared helpers for the jars auth routes.
// No npm dependencies: Upstash and Resend are both plain REST over fetch.

import crypto from 'node:crypto';

export const ITERATIONS = 310000;

export function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
}

export function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

/* ---------- key/value store (Upstash REST) ---------- */
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kv(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Storage is not configured.');
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  if (!r.ok) throw new Error('Storage request failed.');
  const out = await r.json();
  return out.result;
}

export async function kvGet(key) {
  const v = await kv(['GET', key]);
  if (v == null) return null;
  try { return JSON.parse(v); } catch { return v; }
}
export async function kvSet(key, value, ttlSeconds) {
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  return ttlSeconds ? kv(['SET', key, v, 'EX', String(ttlSeconds)]) : kv(['SET', key, v]);
}
export async function kvDel(key) { return kv(['DEL', key]); }

/* ---------- passwords ---------- */
export function hashPassword(password, saltHex, iterations = ITERATIONS) {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
}
export function newSalt() { return crypto.randomBytes(16).toString('hex'); }

export function sameHash(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/* The stored credential, seeded from env on first run so there is something
   to log in with before any reset has happened. */
export async function getCredential() {
  const stored = await kvGet('jars:cred');
  if (stored) return stored;

  const email = (process.env.AUTH_EMAIL || '').trim().toLowerCase();
  const bootstrap = process.env.AUTH_BOOTSTRAP_PASSWORD;
  if (!email || !bootstrap) return null;

  const salt = newSalt();
  const cred = { email, salt, hash: hashPassword(bootstrap, salt), iterations: ITERATIONS };
  await kvSet('jars:cred', cred);
  return cred;
}

export async function setPassword(email, password) {
  const salt = newSalt();
  const cred = { email: email.trim().toLowerCase(), salt, hash: hashPassword(password, salt), iterations: ITERATIONS };
  await kvSet('jars:cred', cred);
  return cred;
}

/* ---------- session token ---------- */
function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set.');
  return s;
}
export function issueToken(email) {
  const payload = Buffer.from(JSON.stringify({ e: email, t: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/* ---------- email ---------- */
export async function sendCode(to, code) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'jars <onboarding@resend.dev>';
  if (!key) throw new Error('Email is not configured.');

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from, to: [to],
      subject: `${code} is your jars reset code`,
      text: `Your jars reset code is ${code}\n\nIt expires in 10 minutes. If you didn't ask for this, ignore this email — nothing has changed.`,
      html: `<div style="font-family:Georgia,serif;background:#F9F1E8;padding:32px;color:#574144">
        <p style="letter-spacing:.24em;text-transform:uppercase;font-size:11px;color:#9A5D61;margin:0 0 8px">jars</p>
        <h1 style="font-weight:500;margin:0 0 16px">Your reset code</h1>
        <p style="font-size:30px;letter-spacing:.2em;color:#9A5D61;margin:0 0 16px"><b>${code}</b></p>
        <p style="margin:0 0 8px">It expires in 10 minutes.</p>
        <p style="color:#8E767A;margin:0">If you didn't ask for this, ignore this email — nothing has changed.</p>
      </div>`
    })
  });
  if (!r.ok) throw new Error('Could not send the email.');
}

export function sixDigits() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}
export function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}
