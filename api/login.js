import { json, readBody, getCredential, hashPassword, sameHash, issueToken } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });

  const { email = '', password = '' } = readBody(req);
  if (!email || !password) return json(res, 400, { error: 'Email and password are required.' });

  try {
    const cred = await getCredential();
    if (!cred) return json(res, 500, { error: 'No account is set up yet.' });

    const given = hashPassword(password, cred.salt, cred.iterations);
    const ok = email.trim().toLowerCase() === cred.email && sameHash(given, cred.hash);

    // one message for either failure, so neither is confirmed on its own
    if (!ok) return json(res, 401, { error: 'That email and password do not match.' });

    return json(res, 200, { ok: true, token: issueToken(cred.email), email: cred.email });
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
}
