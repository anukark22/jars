# jars

A soft, romantic savings planner. Save up for the things you want, in jars.

Everything lives behind a login now: a small Express server holds your jars, and
your data comes back when you log in on any device.

## What it does

- **Home** — a greeting, what you're currently saving for, your collections, the jar in focus, and a ledger
- **Wallet** — the money you actually have. Add income, subtract spending, and see what's left after everything already sitting in your jars
- **Savings** — a separate pot with its own target, funded from the wallet
- **Priority** — a three-column board (Must Have / Nice To Have / Someday). Drag a jar between columns to change how much it matters
- **Events** — everything with a date, grouped by month
- **Calendar** — a month grid; click any day to see what's on it or add something new to that date

## How the money works

Your wallet balance is **money in − everything currently in your jars**. It's
calculated fresh rather than tracked as a running total, so it can't drift out
of sync.

Putting money into a jar takes it out of your wallet, whether you use the card's
**+** button, the **Saved** field when editing, or **Put money in** on the
Wallet page. Lowering a jar's amount — or deleting the jar — returns that money
to your wallet.

## Other bits

- Light and dark themes, remembered on the device, following your system setting by default
- Add a photo to a jar, or paste an image link and it becomes the jar's picture
- Links in notes become clickable
- Optional checklists on experiences and celebrations

---

# Running it

You need **Node 22.5 or newer** — the database driver is built into Node from
that version, so there's nothing to compile.

```bash
npm install
```

Copy `.env.example` to `.env`, then:

```bash
npm run dev
```

Then open <http://localhost:3000>. The first visit sends you to the login page;
follow the *Create one* link to make an account. The database file is created
for you at `data/jars.db`.

`npm start` runs it without file-watching.

## Data from before accounts existed

Anyone who used the planner before it had logins has jars sitting in their
browser's storage. They land on the login page, so the app says so there: if
this browser is holding anything, a dialog opens offering to create an account
and carry it over, listing exactly what it found. The signup page repeats the
tally so making an account visibly keeps the work rather than looking like
starting again.

After signing up or logging in, the import is offered — and only into an
account with nothing in it, so an existing account is never overwritten.
Declining leaves the browser's copy untouched; nothing is deleted until it has
been safely moved.

The dialog appears once per browser session, so it is noticed without nagging
on every page.

**If a copy is served without the API** — an old static deployment still
sitting on a URL — the planner no longer renders an empty page over the top of
data that is still there. It detects jars in that browser and offers a
`jars-backup.json` download, which **Account -> Restore from a backup** takes
in. The restore refuses an account that already holds data, so it can never
overwrite anything.

**Note on ports.** Browser storage belongs to one origin. The old static app
ran on port 8934 and the server runs on 3000, so data saved by the old version
isn't visible to the new one. To bring it across, run the server once on the
old port — `PORT=8934 npm start` — and log in there; afterwards the port stops
mattering, because the data lives in the database.

## Environment variables

Copy `.env.example` to `.env` and edit it. `.env` is git-ignored and must stay
that way.

| Variable | Needed | What it does |
| --- | --- | --- |
| `DATABASE_FILE` | no | Where the SQLite file lives. Defaults to `./data/jars.db`; the folder is created automatically. |
| `PORT` | no | Defaults to `3000`. |
| `NODE_ENV` | in production | Set to `production` once deployed. This is what makes the session cookie HTTPS-only — leave it alone locally, or logging in over `http` will silently fail. |
| `APP_URL` | in production | Public origin, used to build reset links. No trailing slash. |
| `RESET_TOKEN_MINUTES` | no | How long a reset link lasts. Defaults to 45. |
| `EMAIL_HOST` | to send mail | SMTP host. Leave blank and reset links print to the server console instead. |
| `EMAIL_PORT` | to send mail | 587 normally, 465 for implicit TLS. |
| `EMAIL_USER` | to send mail | SMTP username. |
| `EMAIL_PASSWORD` | to send mail | SMTP password. |
| `EMAIL_FROM` | to send mail | The From address, e.g. `jars <no-reply@yourdomain.com>`. |

## Recovery codes

There's a second way back into an account that doesn't involve email at all.
On `/account`, confirm your password and generate a **recovery code** — twenty
random characters, shown once. Write it down.

If you're ever locked out, `/recover` takes that code plus your email and lets
you set a new password. Dashes, spaces and capitals don't matter when you type
it back in.

A code is used up the moment it works, and everything signed in is signed out,
so the one on your paper can only ever let someone in once. Generate a fresh
one from `/account` afterwards. Making a new code replaces any earlier one.

Only a SHA-256 hash of the code is stored, so it can't be read back out of the
database — if you lose the paper, generate another rather than going looking
for it. It is worth as much as your password: keep it somewhere a stranger
won't find it, and it's the one thing that still works when email is down.

## Email for password resets

Mail goes out through nodemailer. The transport is chosen once at startup: if
both `EMAIL_HOST` and `EMAIL_USER` are set it sends over SMTP, and otherwise it
prints the whole message — reset link included — to the server console. The
console adapter is a development convenience only; the real transport stays
wired up either way, so switching a provider on is purely a matter of filling in
the variables.

The startup banner tells you which mode you're in.

**Gmail** needs an [App Password](https://myaccount.google.com/apppasswords),
not your normal password, and two-factor turned on:

```
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=you@gmail.com
EMAIL_PASSWORD=the-16-character-app-password
EMAIL_FROM=jars <you@gmail.com>
```

**[Resend](https://resend.com)** is the better choice for anything real — free
for 3,000 messages a month, and mail from a verified domain is far less likely
to land in spam. The username is the literal word `resend`:

```
EMAIL_HOST=smtp.resend.com
EMAIL_PORT=587
EMAIL_USER=resend
EMAIL_PASSWORD=re_your_api_key
EMAIL_FROM=jars <no-reply@yourdomain.com>
```

Any SMTP provider works — Postmark, SendGrid, Mailgun, Fastmail.

---

# How it's put together

| | |
| --- | --- |
| `server/index.js` | Express app, page routes, the login guard, the error handler |
| `server/db.js` | Every SQL statement in the project |
| `server/auth.js` | Password hashing, sessions, cookies, validation, rate limiting |
| `server/email.js` | SMTP-or-console mail, and the reset email itself |
| `server/routes/auth.js` | The account endpoints |
| `server/routes/data.js` | The planner's own data, always scoped to the session's user |
| `public/index.html` | The planner |
| `public/*.html` | Login, signup, forgot, reset, account |
| `public/auth.css`, `public/auth.js` | Shared styling and helpers for those pages |

All SQL is confined to `server/db.js` on purpose: moving to Postgres later means
rewriting that one file and nothing else.

## Security notes

- Passwords are hashed with bcrypt at cost 12, and never stored or logged in any other form.
- Sessions are opaque 32-byte random tokens in an HTTP-only, `SameSite=Lax` cookie, `Secure` in production. There is no user id, email or password anywhere in the browser's storage.
- **The server never accepts a user id from the browser.** Every query takes its owner from `req.user.id`, which comes only from the session cookie. A forged `user_id` in a request body is ignored.
- Reset tokens are random, stored only as a SHA-256 hash, single-use, and expire. Using one signs every device out. Requesting a new one voids the old.
- Login answers identically for an unknown address and a wrong password, and hashes a dummy value when the user doesn't exist so the two take the same time. "Forgot password" always gives the same reply.
- Password hashes are never returned by any endpoint.
- Recovery codes are 99 bits of randomness, stored only as a SHA-256 hash, compared in constant time, single-use, and burnt on use. Making one needs your password.
- Signup, login, forgot, reset and recover are rate-limited per IP.
- Errors reach the browser as plain sentences; stack traces and SQL errors stay in the log.

## Database

```
users                 id, email (unique, case-insensitive), password_hash,
                      recovery_code_hash, recovery_code_set_at,
                      created_at, updated_at

sessions              token (pk), user_id → users, expires_at, created_at

password_reset_tokens id, user_id → users, token_hash (unique), expires_at,
                      used_at, created_at

jars                  (user_id, id) pk, name, type, priority, icon, category,
                      target, saved, notes, why, tags, event_date,
                      event_location, photo, checklist, created_at, updated_at

wallet_entries        (user_id, id) pk, amount, note, date, created_at
savings_entries       (user_id, id) pk, amount, note, date, created_at
funding_log           id, user_id, amount, date, goal_id, goal_name, created_at
prefs                 user_id (pk), savings_goal, updated_at
```

Every table carries `user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE
CASCADE` and an index on it, so deleting an account takes everything of theirs
with it. `jars`, `wallet_entries` and `savings_entries` key on `(user_id, id)`
rather than `id` alone — two people can hold a jar with the same id without ever
touching each other's.

## Routes

Pages:

| | |
| --- | --- |
| `GET /` | The planner — redirects to `/login?next=…` without a session |
| `GET /account` | Account settings — same guard |
| `GET /login`, `/signup`, `/forgot-password`, `/reset-password`, `/recover` | Public |

Accounts, under `/api/auth`:

| | |
| --- | --- |
| `GET /me` | Who is signed in, and whether they have any data |
| `POST /signup` | email, password, confirm → creates the account and signs in |
| `POST /login` | email, password |
| `POST /logout` | Ends this session |
| `POST /forgot-password` | email → always the same reply |
| `POST /reset-password` | token, password, confirm → signs every device out |
| `POST /change-password` | current, password, confirm → keeps this session, drops the others |
| `POST /delete-account` | password → deletes everything |
| `POST /recovery-code` | password → makes a code and returns it, once |
| `POST /recovery-code/remove` | password → throws the current code away |
| `POST /recover` | email, code, password, confirm → new password, code used up |
| `GET /email-mode` | Whether mail is going to SMTP or the console |

Data, under `/api` — all of it requires a session:

| | |
| --- | --- |
| `GET /state` | Everything belonging to the signed-in user |
| `PUT /jars`, `/wallet`, `/savings`, `/funding`, `/prefs` | Replace that collection |
| `POST /import` | One-time move of pre-account browser data; refused if the account already holds anything |

---

# Testing it

With the server running and mail in console mode:

**Signup** — go to `/signup`, create an account. You land on the planner signed
in. Try the same address again: it says the account already exists. Try a
6-character password: it asks for 8.

**Data belongs to the account** — add a jar, log out, log back in; it's still
there. Create a second account: it starts empty, and adding a jar there leaves
the first account's jars untouched.

**Logout** — log out, then visit `/` directly. You're sent to the login page.

**Forgot password** — `/forgot-password`, enter your address, and read the reset
link out of the terminal running the server. Enter an address that doesn't
exist: the reply is identical.

**Reset password** — open the link, set a new password. You're sent to login;
the old password no longer works and the new one does, and any other device you
were signed in on has been signed out. Open the same link again: it says it has
already been used. Your jars are untouched.

**Change password** — `/account`. A wrong current password is rejected. After a
successful change you stay signed in on this device.

**Delete account** — `/account`, confirm with your password. Everything goes,
and other accounts are unaffected.

---

# Before deploying

**Hosting.** This app writes to a SQLite file, so it needs a host with a real,
persistent disk. **Vercel will not work** — its filesystem is read-only and
thrown away between requests, so the database would vanish. The `.vercel`
directory in this project is left over from when the app was a single static
file. Pick one of:

- **Render, Railway or Fly.io** with a persistent volume mounted, and
  `DATABASE_FILE` pointed at it. Simplest, keeps SQLite, nothing else changes.
- **Vercel plus a hosted Postgres** (Neon, Supabase, Vercel Postgres). This
  means rewriting `server/db.js` — one file, but real work.

Then, in order:

1. Set `NODE_ENV=production`. Without it the session cookie is not marked
   `Secure`.
2. Serve over HTTPS. Session cookies over plain HTTP are readable in transit,
   and with `NODE_ENV=production` set the cookie won't be sent at all.
3. Set `APP_URL` to the real origin, or reset links will point at localhost.
4. Configure a real `EMAIL_*` provider and send yourself a test reset. Until
   you do, reset links only appear in the server log and nobody can recover an
   account.
5. Set `DATABASE_FILE` to a path on the persistent volume, not inside the
   deploy directory.
6. Back the database up on a schedule, and check that a backup restores. It's
   one file; there is no other copy of anyone's data.
7. Confirm `.env` is not in the repository and its values are set as the host's
   environment variables instead. `git ls-files` should show only
   `.env.example`.
8. Run `npm audit` and keep it clean.

Worth knowing, but not blocking:

- Rate limiting is held in memory, so it resets on restart and is counted
  per-instance. Running more than one instance needs shared storage for it —
  and SQLite doesn't want more than one writer anyway.
- There's no email verification at signup, so a typo'd address can't be
  recovered from. Worth adding if this becomes more than a personal tool.
- Sessions last 30 days and expired rows are swept every 6 hours.
