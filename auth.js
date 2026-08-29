/* Shared behaviour for the login, signup and password pages.

   Accounts live in the database now. The browser holds only a session cookie,
   which it cannot read: no email, no id, and never a password. */

(function () {
  try {
    var t = localStorage.getItem('dreamreel_theme');
    if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) { document.documentElement.setAttribute('data-theme', 'light'); }
})();

async function api(path, body, method) {
  const res = await fetch(path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (data === null) throw new Error('The server could not be reached. Please try again.');
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

const auth = (action, body) => api('/api/auth?action=' + action, Object.assign({ action }, body || {}));

async function whoAmI() {
  try { return await api('/api/auth'); }
  catch (e) { return { authenticated: false }; }
}

/* Sends anyone already signed in straight to the planner. */
async function redirectIfLoggedIn() {
  const me = await whoAmI();
  if (me.authenticated) { location.replace('index.html'); return true; }
  return false;
}

/* ---------- what this browser saved before there were accounts ----------
   Offered once, and only into an account holding nothing, so it can never
   overwrite anything. Nothing local is deleted until the server has it. */
const LOCAL_KEYS = {
  jars: 'dreamreel_goals',
  wallet: 'dreamreel_wallet',
  savings: 'dreamreel_savings',
  funding: 'dreamreel_funding_log',
  savingsGoal: 'dreamreel_savings_goal'
};

function readLocalData() {
  const read = (k, fallback) => {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  };
  const out = {
    jars: read(LOCAL_KEYS.jars, []),
    wallet: read(LOCAL_KEYS.wallet, []),
    savings: read(LOCAL_KEYS.savings, []),
    funding: read(LOCAL_KEYS.funding, [])
  };
  let goal;
  try { goal = Number(localStorage.getItem(LOCAL_KEYS.savingsGoal)); } catch (e) {}
  if (goal) out.savingsGoal = goal;
  const count = out.jars.length + out.wallet.length + out.savings.length;
  return count ? out : null;
}

function forgetLocalData() {
  Object.values(LOCAL_KEYS).forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
  try { localStorage.removeItem('dreamreel_wallet_v2'); } catch (e) {}
  try { localStorage.removeItem('users'); localStorage.removeItem('currentUser'); } catch (e) {}
}

function describeLocal(local) {
  const bits = [];
  const n = (c, one, many) => c + ' ' + (c === 1 ? one : many);
  if (local.jars.length) bits.push(n(local.jars.length, 'jar', 'jars'));
  if (local.wallet.length) bits.push(n(local.wallet.length, 'wallet entry', 'wallet entries'));
  if (local.savings.length) bits.push(n(local.savings.length, 'savings entry', 'savings entries'));
  return bits;
}

async function offerImport(hasData) {
  const local = readLocalData();
  if (!local || hasData) return;
  const bits = describeLocal(local);
  const wants = confirm(
    'This browser still has jars saved from before your account existed:\n\n  • ' +
    bits.join('\n  • ') +
    '\n\nMove them into your account? They will then follow you to any device.\n' +
    'Your account is empty, so nothing will be overwritten.'
  );
  if (!wants) return;
  try {
    await api('/api/data', local);
    forgetLocalData();
  } catch (e) {
    alert('That could not be moved across: ' + e.message + '\n\nNothing was changed, and it is still saved in this browser.');
  }
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

/* Disables the form while a request is in flight, so it cannot be sent twice. */
function submitting(form, on, label) {
  const btn = form.querySelector('button[type="submit"]');
  form.querySelectorAll('input, button').forEach(el => { el.disabled = on; });
  if (!btn) return;
  if (on) { btn.dataset.was = btn.textContent; btn.textContent = label || 'Working…'; }
  else if (btn.dataset.was) { btn.textContent = btn.dataset.was; }
}

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
