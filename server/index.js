import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadUser } from './auth.js';
import { purgeExpiredSessions } from './db.js';
import { emailMode } from './email.js';
import authRoutes from './routes/auth.js';
import dataRoutes from './routes/data.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');
const app = express();

app.set('trust proxy', 1);                 // correct client IPs behind a proxy
app.use(express.json({ limit: '5mb' }));   // photos are stored as data URIs
app.use(cookieParser());
app.use(loadUser);

app.use('/api/auth', authRoutes);
app.use('/api', dataRoutes);

/* ---------- pages ---------- */
const page = name => (_req, res) => res.sendFile(join(publicDir, name));

app.get('/login', page('login.html'));
app.get('/signup', page('signup.html'));
app.get('/forgot-password', page('forgot-password.html'));
app.get('/reset-password', page('reset-password.html'));
app.get('/recover', page('recover.html'));

// The planner and the account page are private: without a session the browser
// is sent to the login page, carrying where it was headed.
const guard = (req, res, next) => {
  if (req.user) return next();
  res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
};
app.get('/', guard, page('index.html'));
app.get('/account', guard, page('account.html'));

// Serve assets, but never hand out the private pages directly.
app.use(express.static(publicDir, { index: false, extensions: [] }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.redirect('/');
});

/* Anything unhandled becomes a plain message — stack traces and SQL errors
   stay in the log, not in the browser. */
app.use((err, _req, res, _next) => {
  console.error('[jars]', err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

purgeExpiredSessions();
setInterval(purgeExpiredSessions, 6 * 3600 * 1000).unref();

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`\njars is running at http://localhost:${port}`);
  console.log(`email: ${emailMode() === 'smtp' ? 'SMTP configured' : 'console only — reset links will be printed here'}\n`);
});
