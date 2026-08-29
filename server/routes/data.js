// The planner's own data. Every handler takes the owner from req.user, which
// comes from the session cookie — a user_id in the request body is ignored.

import { Router } from 'express';
import { requireAuth } from '../auth.js';
import {
  getState, replaceJars, replaceWallet, replaceSavings, replaceFunding,
  setSavingsGoal, userHasData
} from '../db.js';

const router = Router();
router.use(requireAuth);

const asArray = v => (Array.isArray(v) ? v : null);
const TOO_MANY = 5000;

router.get('/state', (req, res, next) => {
  try { res.json(getState(req.user.id)); } catch (err) { next(err); }
});

router.put('/jars', (req, res, next) => {
  try {
    const jars = asArray(req.body?.jars);
    if (!jars) return res.status(400).json({ error: 'Expected a list of jars.' });
    if (jars.length > TOO_MANY) return res.status(413).json({ error: 'That is too many jars.' });
    replaceJars(req.user.id, jars);
    res.json({ ok: true, count: jars.length });
  } catch (err) { next(err); }
});

router.put('/wallet', (req, res, next) => {
  try {
    const rows = asArray(req.body?.entries);
    if (!rows) return res.status(400).json({ error: 'Expected a list of entries.' });
    if (rows.length > TOO_MANY) return res.status(413).json({ error: 'That is too many entries.' });
    replaceWallet(req.user.id, rows);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.put('/savings', (req, res, next) => {
  try {
    const rows = asArray(req.body?.entries);
    if (!rows) return res.status(400).json({ error: 'Expected a list of entries.' });
    if (rows.length > TOO_MANY) return res.status(413).json({ error: 'That is too many entries.' });
    replaceSavings(req.user.id, rows);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.put('/funding', (req, res, next) => {
  try {
    const rows = asArray(req.body?.entries);
    if (!rows) return res.status(400).json({ error: 'Expected a list of entries.' });
    if (rows.length > TOO_MANY) return res.status(413).json({ error: 'That is too many entries.' });
    replaceFunding(req.user.id, rows);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.put('/prefs', (req, res, next) => {
  try {
    const goal = Number(req.body?.savingsGoal);
    if (!Number.isFinite(goal) || goal < 0) return res.status(400).json({ error: 'That target is not a number.' });
    setSavingsGoal(req.user.id, goal);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* One-off import of whatever the browser had before there were accounts.
   Refuses if the account already holds anything, so nothing is overwritten. */
router.post('/import', (req, res, next) => {
  try {
    if (userHasData(req.user.id)) {
      return res.status(409).json({ error: 'This account already has data, so nothing was imported.' });
    }
    const { jars = [], wallet = [], savings = [], funding = [], savingsGoal } = req.body || {};
    if (![jars, wallet, savings, funding].every(Array.isArray)) {
      return res.status(400).json({ error: 'That data could not be read.' });
    }
    replaceJars(req.user.id, jars);
    replaceWallet(req.user.id, wallet);
    replaceSavings(req.user.id, savings);
    replaceFunding(req.user.id, funding);
    if (Number.isFinite(Number(savingsGoal))) setSavingsGoal(req.user.id, Number(savingsGoal));
    res.json({ ok: true, imported: { jars: jars.length, wallet: wallet.length, savings: savings.length } });
  } catch (err) { next(err); }
});

export default router;
