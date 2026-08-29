/* ---------------------------------------------------------------------------
   Local accounts for jars.

   PROTOTYPE ONLY. Everything here lives in this browser's localStorage:
   accounts, passwords and jars alike. Passwords are stored as plain text,
   because there is nothing to check them against but the same browser that
   holds them — anyone who can open this device's storage can read them, and
   anyone who can reach the app can reset a password without proving anything.

   This is a convenience for keeping two people's jars apart on a shared
   laptop. It is not authentication, it protects nothing, and no sensitive
   information belongs in it.
   ------------------------------------------------------------------------- */

(function () {
  try {
    var t = localStorage.getItem('dreamreel_theme');
    if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) { document.documentElement.setAttribute('data-theme', 'light'); }
})();

const USERS_KEY = 'users';
const CURRENT_KEY = 'currentUser';
const MIN_PASSWORD = 8;

/* Storage can be blocked outright (file:// in some browsers, private windows).
   Never let that throw — the pages still render, they just can't remember. */
function rawGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function rawSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
function rawDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

function storageWorks() {
  try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; }
  catch (e) { return false; }
}

/* ---------- the account list ---------- */
function getUsers() {
  const raw = rawGet(USERS_KEY);
  if (!raw) return [];
  // A corrupt list is never silently replaced: better to show no accounts than
  // to overwrite whatever is really in there.
  try { const list = JSON.parse(raw); return Array.isArray(list) ? list : []; }
  catch (e) { return []; }
}
function setUsers(list) { return rawSet(USERS_KEY, JSON.stringify(list)); }

const normaliseEmail = v => String(v || '').trim().toLowerCase();
const findByEmail = email => getUsers().find(u => normaliseEmail(u.email) === normaliseEmail(email)) || null;
const findById = id => getUsers().find(u => u.id === id) || null;

function newId() {
  return 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/* ---------- session ----------
   Only the id is kept. Nothing about the jars themselves. */
function currentUser() {
  const id = rawGet(CURRENT_KEY);
  return id ? findById(id) : null;
}
function setCurrentUser(id) { rawSet(CURRENT_KEY, id); }
function logOut() { rawDel(CURRENT_KEY); location.href = 'login.html'; }

/* ---------- validation ---------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isEmail = v => EMAIL_RE.test(v) && v.length <= 254;
function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (pw.length > 200) return 'That password is too long.';
  return null;
}

/* ---------- the jars this browser saved before accounts existed ----------
   Copied into the first account made, never deleted: if anything goes wrong
   the original keys are still sitting there untouched. */
const LEGACY_KEYS = ['dreamreel_goals', 'dreamreel_wallet', 'dreamreel_savings',
                     'dreamreel_funding_log', 'dreamreel_savings_goal', 'dreamreel_wallet_v2'];
const LEGACY_CLAIMED = 'dreamreel_legacy_claimed';

function legacyData() {
  if (rawGet(LEGACY_CLAIMED)) return null;      // already given to an account
  const found = {};
  let has = false;
  LEGACY_KEYS.forEach(k => {
    const v = rawGet(k);
    if (v !== null) { found[k] = v; if (k !== 'dreamreel_wallet_v2') has = true; }
  });
  return has ? found : null;
}

function describeLegacy(data) {
  const count = k => { try { return JSON.parse(data[k] || '[]').length; } catch (e) { return 0; } };
  const bits = [];
  const n = (c, one, many) => c + ' ' + (c === 1 ? one : many);
  if (count('dreamreel_goals')) bits.push(n(count('dreamreel_goals'), 'jar', 'jars'));
  if (count('dreamreel_wallet')) bits.push(n(count('dreamreel_wallet'), 'wallet entry', 'wallet entries'));
  if (count('dreamreel_savings')) bits.push(n(count('dreamreel_savings'), 'savings entry', 'savings entries'));
  return bits;
}

/* ---------- the flows ---------- */
function signUp(email, password, confirm) {
  email = normaliseEmail(email);
  if (!isEmail(email)) return { error: 'That email address does not look right.' };
  const pw = passwordProblem(password);
  if (pw) return { error: pw };
  if (password !== confirm) return { error: 'Those two passwords do not match.' };
  if (findByEmail(email)) return { error: 'There is already an account with that email. Try logging in.' };
  if (!storageWorks()) return { error: 'This browser is blocking storage, so an account cannot be saved here.' };

  const user = { id: newId(), email, password, createdAt: Date.now(), data: {} };

  // The first account adopts whatever this browser saved before logins existed.
  const legacy = legacyData();
  if (legacy) {
    Object.keys(legacy).forEach(k => { user.data[k] = legacy[k]; });
    rawSet(LEGACY_CLAIMED, user.id);
  }

  const users = getUsers();
  users.push(user);
  if (!setUsers(users)) return { error: 'That account could not be saved.' };
  setCurrentUser(user.id);
  return { user, adopted: legacy ? describeLegacy(legacy) : null };
}

function logIn(email, password) {
  const user = findByEmail(email);
  // One answer for both, so this doesn't become a way to find out who has an account.
  if (!user || user.password !== password) return { error: 'Invalid email or password.' };
  setCurrentUser(user.id);
  return { user };
}

/* No email, no token, no proof of anything: knowing the address is enough.
   That is the honest shape of a reset with nothing to send a message with. */
function resetPassword(email, password, confirm) {
  const user = findByEmail(email);
  if (!user) return { error: 'No account here uses that email.' };
  const pw = passwordProblem(password);
  if (pw) return { error: pw };
  if (password !== confirm) return { error: 'Those two passwords do not match.' };

  const users = getUsers();
  const i = users.findIndex(u => u.id === user.id);
  users[i].password = password;
  if (!setUsers(users)) return { error: 'That change could not be saved.' };
  return { user: users[i] };
}

/* ---------- page guards ---------- */
function requireAuth() {
  if (currentUser()) return true;
  rawDel(CURRENT_KEY);                   // a stale id pointing at a deleted account
  location.replace('login.html');
  return false;
}
function redirectIfLoggedIn() {
  if (currentUser()) { location.replace('index.html'); return true; }
  return false;
}

/* ---------- shared bits of the pages ---------- */
const JAR_SVG = `
<svg class="jar" viewBox="10 5 51 51" aria-hidden="true">
  <clipPath id="jarBody"><path d="M21 22h22v27a6 6 0 0 1-6 6H27a6 6 0 0 1-6-6V22z"/></clipPath>
  <path d="M21 22h22v27a6 6 0 0 1-6 6H27a6 6 0 0 1-6-6V22z" fill="#FFE4E1"/>
  <g clip-path="url(#jarBody)"><rect x="19" y="37" width="26" height="20" fill="#BF7E81"/></g>
  <path d="M21 22h22v27a6 6 0 0 1-6 6H27a6 6 0 0 1-6-6V22z" fill="none" stroke="#7A464B" stroke-width="2.4"/>
  <rect x="20" y="17.6" width="24" height="4.4" rx="2.2" fill="#FFE4E1" stroke="#7A464B" stroke-width="2"/>
  <rect x="19" y="7.5" width="26" height="10.5" rx="3" fill="#BF7E81" stroke="#7A464B" stroke-width="2.4"/>
  <path d="M44.6 15.4c1.5 1.5 2.1 3.2 1.9 5.1" fill="none" stroke="#7A464B" stroke-width="1.7" stroke-linecap="round"/>
  <path d="M47.6 30.4c-3.5-2.8-5.6-4.8-5.6-7a3.1 3.1 0 0 1 5.6-1.8 3.1 3.1 0 0 1 5.6 1.8c0 2.2-2.1 4.2-5.6 7z" fill="#F6CFCB" stroke="#7A464B" stroke-width="2.1" stroke-linejoin="round"/>
</svg>`;

function say(el, text, kind) {
  el.textContent = text;
  el.className = 'msg ' + (kind || 'error');
  el.hidden = false;
}
function clearSay(el) { el.hidden = true; }

/* A password you can't read is a password you can't check against the one
   above it, so every box gets a show/hide button. */
function addPasswordReveals(root) {
  (root || document).querySelectorAll('input[type="password"]').forEach(input => {
    const field = input.closest('.field');
    if (!field || field.classList.contains('has-reveal')) return;
    field.classList.add('has-reveal');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'reveal';
    btn.textContent = 'Show';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', 'Show password');
    btn.addEventListener('click', () => {
      const showing = input.type === 'password';
      input.type = showing ? 'text' : 'password';
      btn.textContent = showing ? 'Hide' : 'Show';
      btn.setAttribute('aria-pressed', String(showing));
      btn.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
      const at = input.value.length;
      input.focus();
      try { input.setSelectionRange(at, at); } catch (e) {}
    });

    const wrap = document.createElement('div');
    wrap.className = 'input-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    wrap.appendChild(btn);
  });
}
