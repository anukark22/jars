import { json, readBody, kvGet, kvDel, kvSet, setPassword, sameHash, hashCode, issueToken } from './_lib.js';

const MAX_TRIES = 5;

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });

  const { email = '', code = '', password = '' } = readBody(req);
  if (!email || !code || !password) return json(res, 400, { error: 'Email, code and new password are required.' });
  if (String(password).length < 8) return json(res, 400, { error: 'Use at least 8 characters.' });

  try {
    const pending = await kvGet('jars:reset');
    if (!pending) return json(res, 400, { error: 'That code has expired. Ask for a new one.' });

    // a wrong code burns an attempt, so the six digits can't be walked through
    const tries = Number(await kvGet('jars:reset:tries')) || 0;
    if (tries >= MAX_TRIES) {
      await kvDel('jars:reset');
      await kvDel('jars:reset:tries');
      return json(res, 429, { error: 'Too many attempts. Ask for a new code.' });
    }

    const matches = email.trim().toLowerCase() === pending.email
      && sameHash(hashCode(String(code).trim()), pending.code);

    if (!matches) {
      await kvSet('jars:reset:tries', String(tries + 1), 600);
      return json(res, 401, { error: 'That code is not right.' });
    }

    const cred = await setPassword(pending.email, password);
    await kvDel('jars:reset');
    await kvDel('jars:reset:tries');
    await kvDel('jars:reset:cooldown');

    return json(res, 200, { ok: true, token: issueToken(cred.email), email: cred.email });
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
}
