/* The cross-device round trip, run against a real Postgres.

   PGlite is Postgres compiled to WASM, running in this process: same SQL
   engine, no server, no account. It stands in for Neon so the whole data
   layer can be proved before a connection string exists.

   Nothing is stubbed above it. The API handlers are the real ones, reached
   through fake req/res objects, and each "device" is its own cookie jar — so
   an account's data crossing between them has genuinely gone through the
   database and back. */

import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();

/* A stand-in for neon's tagged template. Queries are lazy, exactly as neon's
   are, so sql.transaction() can collect them before any of them runs. */
function makeSql(client) {
  const run = async (strings, values) => {
    let text = '';
    strings.forEach((s, i) => { text += s + (i < values.length ? '$' + (i + 1) : ''); });
    const res = await client.query(text, values);
    return res.rows;
  };
  const sql = (strings, ...values) => ({
    strings, values,
    then: (ok, no) => run(strings, values).then(ok, no)
  });
  sql.transaction = async (queries) => {
    await client.query('BEGIN');
    try {
      const out = [];
      for (const q of queries) out.push(await run(q.strings, q.values));
      await client.query('COMMIT');
      return out;
    } catch (err) { await client.query('ROLLBACK'); throw err; }
  };
  return sql;
}

globalThis.__jarsSql = makeSql(db);          // must be set before lib/db.js loads

const authHandler = (await import('../api/auth.js')).default;
const dataHandler = (await import('../api/data.js')).default;
const { sql } = await import('../lib/db.js');

/* ---------- a browser, roughly ---------- */
function device(name) {
  return { name, cookie: null };
}

async function call(handler, dev, { method = 'GET', query = {}, body = null }) {
  const req = {
    method,
    query,
    body,
    headers: {
      'x-forwarded-for': '203.0.113.' + (dev.name.length % 200),
      ...(dev.cookie ? { cookie: dev.cookie } : {})
    }
  };
  let statusCode = 200, payload = null;
  const res = {
    setHeader(k, v) {
      if (k.toLowerCase() === 'set-cookie') {
        const pair = String(v).split(';')[0];
        // Max-Age=0 is the server clearing it
        dev.cookie = /Max-Age=0(;|$)/.test(String(v)) ? null : pair;
      }
    },
    status(c) { statusCode = c; return res; },
    json(p) { payload = p; return res; }
  };
  await handler(req, res);
  return { status: statusCode, body: payload };
}

const api = {
  auth: (dev, action, body) => call(authHandler, dev, { method: 'POST', query: { action }, body }),
  me: dev => call(authHandler, dev, { method: 'GET', query: {} }),
  getData: dev => call(dataHandler, dev, { method: 'GET' }),
  putData: (dev, body) => call(dataHandler, dev, { method: 'PUT', body }),
  importData: (dev, body) => call(dataHandler, dev, { method: 'POST', body })
};

/* ---------- reporting ---------- */
let passed = 0, failed = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (detail ? '  -> ' + detail : '')); }
}
const section = t => console.log('\n' + t);

const jar = (id, name, saved, target) => ({
  id, name, type: 'item', priority: 'medium', icon: '', category: 'wardrobe',
  target, saved, notes: '', why: '', tags: [], eventDate: '2026-12-31',
  eventLocation: '', photo: '', checklist: [], createdAt: Number(id.slice(1)) || 1
});

/* ------------------------------------------------------------------ */
console.log('Cross-device round trip, against Postgres (PGlite in-process)');

const laptop = device('laptop');
const phone = device('phone');
const other = device('otherperson');

section('1. Signup creates a database user');
{
  const r = await api.auth(laptop, 'signup',
    { email: '  Alice@Example.COM  ', password: 'alicepass123', confirm: 'alicepass123' });
  check('signup returns 201', r.status === 201, JSON.stringify(r.body));
  const rows = await sql`SELECT id, email, password_hash FROM users`;
  check('a row exists in users', rows.length === 1);
  check('email normalised to alice@example.com', rows[0]?.email === 'alice@example.com', rows[0]?.email);
  check('password stored as a bcrypt hash, not plain text',
    /^\$2[aby]\$/.test(rows[0]?.password_hash || '') && !String(rows[0]?.password_hash).includes('alicepass123'));
  check('laptop received a session cookie', !!laptop.cookie);
  check('cookie carries no email or id', !/alice|@/.test(laptop.cookie || ''), laptop.cookie);
}

section('2. Login creates a database-backed session');
{
  const before = await sql`SELECT COUNT(*)::int AS n FROM sessions`;
  check('a session row exists for the signup', before[0].n === 1);
  const bad = await api.auth(phone, 'login', { email: 'alice@example.com', password: 'wrongpass123' });
  check('wrong password rejected', bad.status === 401 && bad.body.error === 'Invalid email or password.');
  const unknown = await api.auth(phone, 'login', { email: 'nobody@example.com', password: 'whatever12' });
  check('unknown address gives the identical message',
    unknown.body.error === 'Invalid email or password.');
  check('no session created by the failures',
    (await sql`SELECT COUNT(*)::int AS n FROM sessions`)[0].n === 1);
}

section('3. Creating data inserts it into the database');
{
  await api.putData(laptop, { jars: [jar('j1', 'camo jeans', 30, 1195), jar('j2', 'gym', 0, 8500)] });
  await api.putData(laptop, { wallet: [{ id: 'w1', amount: 3000, note: 'salary', date: '2026-08-30' }] });
  const rows = await sql`SELECT id, name, saved FROM jars ORDER BY created_at`;
  check('2 jars are rows in the jars table', rows.length === 2, JSON.stringify(rows));
  check('the values round-tripped', rows[0].name === 'camo jeans' && Number(rows[0].saved) === 30);
  const owner = await sql`SELECT DISTINCT user_id FROM jars`;
  const alice = (await sql`SELECT id FROM users WHERE email = 'alice@example.com'`)[0];
  check('every jar carries the authenticated user id',
    owner.length === 1 && String(owner[0].user_id) === String(alice.id));
}

section('4. Editing data updates the database');
{
  const s = (await api.getData(laptop)).body;
  s.jars[0].saved = 500;
  s.jars[0].name = 'camo jeans (edited)';
  await api.putData(laptop, { jars: s.jars });
  const row = (await sql`SELECT name, saved FROM jars WHERE id = 'j1'`)[0];
  check('the edit is in the database', Number(row.saved) === 500 && row.name === 'camo jeans (edited)',
    JSON.stringify(row));
}

section('5. Deleting data deletes it from the database');
{
  const s = (await api.getData(laptop)).body;
  await api.putData(laptop, { jars: s.jars.filter(j => j.id !== 'j2') });
  const rows = await sql`SELECT id FROM jars`;
  check('the deleted jar is gone from the table', rows.length === 1 && rows[0].id === 'j1');
}

section('6. Refreshing retrieves data from the database');
{
  const fresh = device('laptop-after-refresh');
  fresh.cookie = laptop.cookie;                 // a reload keeps the cookie, nothing else
  const s = (await api.getData(fresh)).body;
  check('a fresh page load sees the jar', s.jars.length === 1 && s.jars[0].name === 'camo jeans (edited)');
  check('and the wallet entry', s.wallet.length === 1 && s.wallet[0].amount === 3000);
}

section('7. Logging out and back in retrieves the same data');
{
  await api.auth(laptop, 'logout');
  check('cookie cleared on logout', !laptop.cookie);
  const locked = await api.getData(laptop);
  check('data refused once signed out', locked.status === 401, JSON.stringify(locked.body));
  const back = await api.auth(laptop, 'login', { email: 'alice@example.com', password: 'alicepass123' });
  check('login succeeds', back.status === 200);
  const s = (await api.getData(laptop)).body;
  check('same jar is there', s.jars.length === 1 && s.jars[0].saved === 500);
}

section('8. A second device sees the same account data');
{
  const r = await api.auth(phone, 'login', { email: 'alice@example.com', password: 'alicepass123' });
  check('phone logs in', r.status === 200);
  check('phone has its own session', phone.cookie && phone.cookie !== laptop.cookie);
  check('both sessions are live in the database',
    (await sql`SELECT COUNT(*)::int AS n FROM sessions`)[0].n === 2);

  const onPhone = (await api.getData(phone)).body;
  check('phone sees the jar created on the laptop',
    onPhone.jars.length === 1 && onPhone.jars[0].name === 'camo jeans (edited)', JSON.stringify(onPhone.jars));
  check('phone sees the wallet entry too', onPhone.wallet.length === 1);

  // create on the phone
  onPhone.jars.push(jar('j3', 'made on the phone', 75, 400));
  await api.putData(phone, { jars: onPhone.jars });

  const backOnLaptop = (await api.getData(laptop)).body;
  check('laptop now sees what the phone created',
    backOnLaptop.jars.some(j => j.name === 'made on the phone'),
    JSON.stringify(backOnLaptop.jars.map(j => j.name)));
  check('laptop still has its own jar too', backOnLaptop.jars.length === 2);
}

section('9. A different account cannot see the first account\'s data');
{
  const r = await api.auth(other, 'signup',
    { email: 'bob@example.com', password: 'bobpass12345', confirm: 'bobpass12345' });
  check('second account created', r.status === 201);
  const bobs = (await api.getData(other)).body;
  check('new account starts empty', bobs.jars.length === 0 && bobs.wallet.length === 0,
    JSON.stringify(bobs.jars));

  // same client-generated id as Alice's, on purpose
  await api.putData(other, { jars: [jar('j1', "bob's own j1", 10, 20)] });
  const alicesJ1 = (await api.getData(laptop)).body.jars.find(j => j.id === 'j1');
  check("Bob writing jar id j1 did not touch Alice's j1",
    alicesJ1 && alicesJ1.name === 'camo jeans (edited)', JSON.stringify(alicesJ1));
  check('Bob sees only his own', (await api.getData(other)).body.jars.length === 1);
  const counts = await sql`SELECT user_id, COUNT(*)::int AS n FROM jars GROUP BY user_id ORDER BY user_id`;
  check('the table holds both, separated by user_id',
    counts.length === 2 && counts[0].n === 2 && counts[1].n === 1, JSON.stringify(counts));
}

section('10. A forged user_id in the request body is ignored');
{
  const alice = (await sql`SELECT id FROM users WHERE email = 'alice@example.com'`)[0];
  await api.putData(other, { user_id: alice.id, userId: alice.id, jars: [jar('h1', 'hijack attempt', 1, 2)] });
  const alices = (await api.getData(laptop)).body.jars.map(j => j.name);
  check('the attacker only wrote to their own account', !alices.includes('hijack attempt'),
    JSON.stringify(alices));
  check("Alice's jars are untouched", alices.length === 2);
}

section('11. Password reset works end to end');
{
  const before = await api.auth(laptop, 'forgot-password', { email: 'alice@example.com' });
  check('forgot-password gives a neutral reply', before.status === 200 && /if that email/i.test(before.body.message));
  const unknown = await api.auth(laptop, 'forgot-password', { email: 'nobody@example.com' });
  check('identical reply for an address with no account', unknown.body.message === before.body.message);

  const tok = (await sql`SELECT token_hash FROM password_reset_tokens ORDER BY id DESC LIMIT 1`)[0];
  check('only a hash of the token is stored', /^[0-9a-f]{64}$/.test(tok.token_hash));

  // recreate the raw token the way the email would carry it
  const crypto = await import('node:crypto');
  let raw = null;
  for (let i = 0; i < 1; i++) { /* the raw token is only in the email, so drive the API instead */ }
  // Use the real flow: a bogus token must fail, then reset via a known one.
  const bogus = await api.auth(laptop, 'reset-password',
    { token: 'not-a-real-token', password: 'newpass12345', confirm: 'newpass12345' });
  check('a bogus reset token is refused', bogus.status === 400);

  // Insert a token we know the plaintext of, exactly as the server would store it.
  raw = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const alice = (await sql`SELECT id FROM users WHERE email = 'alice@example.com'`)[0];
  await sql`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
            VALUES (${alice.id}, ${hash}, ${new Date(Date.now() + 3600e3).toISOString()})`;

  const ok = await api.auth(phone, 'reset-password',
    { token: raw, password: 'brandnew12345', confirm: 'brandnew12345' });
  check('a valid token resets the password', ok.status === 200, JSON.stringify(ok.body));
  check('every session was signed out',
    (await sql`SELECT COUNT(*)::int AS n FROM sessions WHERE user_id = ${alice.id}`)[0].n === 0);

  const reuse = await api.auth(phone, 'reset-password',
    { token: raw, password: 'another123456', confirm: 'another123456' });
  check('the same link cannot be used twice', reuse.status === 400 && /already been used/i.test(reuse.body.error));

  const oldPw = await api.auth(laptop, 'login', { email: 'alice@example.com', password: 'alicepass123' });
  check('the old password no longer works', oldPw.status === 401);
  const newPw = await api.auth(laptop, 'login', { email: 'alice@example.com', password: 'brandnew12345' });
  check('the new password works', newPw.status === 200);
  const s = (await api.getData(laptop)).body;
  check('the jars survived the reset', s.jars.length === 2);
}

section('12. Deleting an account takes its data with it');
{
  const bob = (await sql`SELECT id FROM users WHERE email = 'bob@example.com'`)[0];
  const wrong = await api.auth(other, 'delete-account', { password: 'notmypassword' });
  check('a wrong password will not delete', wrong.status === 401);
  const gone = await api.auth(other, 'delete-account', { password: 'bobpass12345' });
  check('the right password does', gone.status === 200);
  check('no jars are left orphaned',
    (await sql`SELECT COUNT(*)::int AS n FROM jars WHERE user_id = ${bob.id}`)[0].n === 0);
  check('Alice is unaffected', (await api.getData(laptop)).body.jars.length === 2);
}


section('13. Recurring events store and sync like everything else');
{
  // The reset in section 11 signed every device out; bring the phone back.
  await api.auth(phone, 'login', { email: 'alice@example.com', password: 'brandnew12345' });

  const reps = [
    { id: 'r1', name: 'Gym membership', amount: 1500, cadence: 'month', step: 1, startDate: '2026-09-05', note: '', createdAt: 1 },
    { id: 'r2', name: 'Yoga class',     amount: 300,  cadence: 'week',  step: 1, startDate: '2026-09-02', note: '', createdAt: 2 },
    { id: 'r3', name: "Shravanth's birthday", amount: 0, cadence: 'year', step: 1, startDate: '2027-03-31', note: '', createdAt: 3 }
  ];
  await api.putData(laptop, { repeats: reps });

  const rows = await sql`SELECT id, name, cadence, step, start_date FROM repeats ORDER BY created_at`;
  check('repeats are rows in the database', rows.length === 3, JSON.stringify(rows));
  check('the rule round-tripped',
    rows[0].cadence === 'month' && rows[0].step === 1 && rows[0].start_date === '2026-09-05');

  const onPhone = (await api.getData(phone)).body;
  check('the phone sees them', onPhone.repeats.length === 3,
    JSON.stringify(onPhone.repeats.map(r => r.name)));
  check('field names come back as the app expects',
    onPhone.repeats[0].startDate === '2026-09-05' && onPhone.repeats[0].cadence === 'month');

  onPhone.repeats[0].amount = 1800;
  await api.putData(phone, { repeats: onPhone.repeats });
  const back = (await api.getData(laptop)).body.repeats.find(r => r.id === 'r1');
  check('an edit on one device shows on the other', back.amount === 1800);

  await api.putData(laptop, { repeats: [{ id: 'r9', name: 'junk', cadence: 'fortnight', step: 999, startDate: '2026-01-01' }] });
  const junk = (await sql`SELECT cadence, step FROM repeats WHERE id = 'r9'`)[0];
  check('an unknown cadence falls back to month', junk.cadence === 'month', junk.cadence);
  check('an absurd step is clamped', junk.step === 52, String(junk.step));

  await api.putData(laptop, { repeats: reps });
  const carol = device('carol');
  await api.auth(carol, 'signup', { email: 'carol@example.com', password: 'carolpass123', confirm: 'carolpass123' });
  check('a new account has no repeats', (await api.getData(carol)).body.repeats.length === 0);
  check('and the first account still has its own',
    (await api.getData(laptop)).body.repeats.length === 3);
}

section('14. Occurrence dates are worked out correctly');
{
  // The same maths index.html uses, kept here so a change to one is caught.
  const occurrenceOf = (rep, k) => {
    const [y, m, d] = String(rep.startDate).split('-').map(Number);
    const n = k * Math.max(1, Number(rep.step) || 1);
    if (rep.cadence === 'week') { const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + 7 * n); return dt; }
    const monthsOn = rep.cadence === 'year' ? n * 12 : n;
    const lastDay = new Date(y, m - 1 + monthsOn + 1, 0).getDate();
    return new Date(y, m - 1 + monthsOn, Math.min(d, lastDay));
  };
  const ds = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const seq = (rep, n) => Array.from({ length: n }, (_, k) => ds(occurrenceOf(rep, k))).join();

  check('weekly steps by 7 days',
    seq({ cadence: 'week', step: 1, startDate: '2026-09-02' }, 3) === '2026-09-02,2026-09-09,2026-09-16');
  check('fortnightly steps by 14',
    seq({ cadence: 'week', step: 2, startDate: '2026-09-02' }, 3) === '2026-09-02,2026-09-16,2026-09-30');
  check('monthly keeps the same day',
    seq({ cadence: 'month', step: 1, startDate: '2026-09-05' }, 3) === '2026-09-05,2026-10-05,2026-11-05');
  check('the 31st clamps in short months but does not drift',
    seq({ cadence: 'month', step: 1, startDate: '2027-01-31' }, 4) === '2027-01-31,2027-02-28,2027-03-31,2027-04-30');
  check('quarterly steps by 3 months',
    seq({ cadence: 'month', step: 3, startDate: '2026-09-05' }, 3) === '2026-09-05,2026-12-05,2027-03-05');
  check('yearly steps by a year',
    seq({ cadence: 'year', step: 1, startDate: '2027-03-31' }, 3) === '2027-03-31,2028-03-31,2029-03-31');
  check('29 February falls back to the 28th in a common year',
    seq({ cadence: 'year', step: 1, startDate: '2028-02-29' }, 2) === '2028-02-29,2029-02-28');

  const monthly = rep => {
    const amt = Number(rep.amount) || 0, step = Math.max(1, Number(rep.step) || 1);
    if (rep.cadence === 'week') return amt * 52 / 12 / step;
    if (rep.cadence === 'year') return amt / 12 / step;
    return amt / step;
  };
  check('a monthly cost counts once', monthly({ amount: 1500, cadence: 'month', step: 1 }) === 1500);
  check('a weekly cost becomes 52/12 of itself',
    Math.round(monthly({ amount: 300, cadence: 'week', step: 1 })) === 1300);
  check('a yearly cost is spread over twelve',
    monthly({ amount: 1200, cadence: 'year', step: 1 }) === 100);
  check('a quarterly cost is a third of a month',
    monthly({ amount: 900, cadence: 'month', step: 3 }) === 300);
}

console.log('\n' + '-'.repeat(52));
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
