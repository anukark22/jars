/* The planner's own data.

   Nothing here reads an owner from the request. `me.id` comes from the session
   cookie, so a user_id posted by a browser is ignored rather than trusted. */

import {
  getState, replaceJars, replaceWallet, replaceSavings, replaceFunding,
  setSavingsGoal, userHasData, ensureSchema
} from '../lib/db.js';
import { currentUser, readBody, send, fail } from '../lib/auth.js';

export default async function handler(req, res) {
  try {
    await ensureSchema();
    const me = await currentUser(req);
    if (!me) return send(res, 401, { error: 'Please log in.' });

    if (req.method === 'GET') return send(res, 200, await getState(me.id));

    if (req.method === 'PUT') {
      const body = readBody(req);
      // Whatever collections the browser sent, and only those. An edit to the
      // wallet does not rewrite the jars.
      const jobs = [];
      if (Array.isArray(body.jars))    jobs.push(replaceJars(me.id, body.jars));
      if (Array.isArray(body.wallet))  jobs.push(replaceWallet(me.id, body.wallet));
      if (Array.isArray(body.savings)) jobs.push(replaceSavings(me.id, body.savings));
      if (Array.isArray(body.funding)) jobs.push(replaceFunding(me.id, body.funding));
      if (body.savingsGoal !== undefined) jobs.push(setSavingsGoal(me.id, body.savingsGoal));
      if (!jobs.length) return send(res, 400, { error: 'Nothing to save.' });
      await Promise.all(jobs);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST') {
      // A one-time lift of whatever this browser saved before there were
      // accounts. Refused outright if the account already holds anything, so it
      // can never overwrite what is there.
      const body = readBody(req);
      if (await userHasData(me.id)) {
        return send(res, 409, { error: 'This account already has data, so nothing was changed.' });
      }
      await replaceJars(me.id, body.jars || []);
      await replaceWallet(me.id, body.wallet || []);
      await replaceSavings(me.id, body.savings || []);
      await replaceFunding(me.id, body.funding || []);
      if (body.savingsGoal !== undefined) await setSavingsGoal(me.id, body.savingsGoal);
      return send(res, 200, { ok: true, imported: (body.jars || []).length });
    }

    return send(res, 405, { error: 'Method not allowed.' });
  } catch (err) { return fail(res, err); }
}
