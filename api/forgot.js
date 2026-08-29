import { json, readBody, getCredential, kvSet, kvGet, sendCode, sixDigits, hashCode } from './_lib.js';

const WINDOW = 600;      // code lives 10 minutes
const COOLDOWN = 60;     // at most one request a minute

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });

  const { email = '' } = readBody(req);
  const given = email.trim().toLowerCase();
  if (!given) return json(res, 400, { error: 'Email is required.' });

  try {
    const cred = await getCredential();

    // Always answer the same way. Telling the caller whether an address is
    // registered would leak it, and this inbox is the only account there is.
    const reply = { ok: true, message: 'If that address is registered, a code is on its way.' };

    if (!cred || given !== cred.email) return json(res, 200, reply);

    if (await kvGet('jars:reset:cooldown')) {
      return json(res, 429, { error: 'A code was just sent. Give it a minute before asking again.' });
    }

    const code = sixDigits();
    await kvSet('jars:reset', { code: hashCode(code), email: cred.email }, WINDOW);
    await kvSet('jars:reset:cooldown', '1', COOLDOWN);
    await sendCode(cred.email, code);

    return json(res, 200, reply);
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
}
