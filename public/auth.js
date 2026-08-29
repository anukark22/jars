// Shared behaviour for the login, signup and password pages.

(function () {
  try {
    var t = localStorage.getItem('dreamreel_theme');
    if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) { document.documentElement.setAttribute('data-theme', 'light'); }
})();

export const JAR_SVG = `
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

export async function api(path, body, method) {
  const res = await fetch(path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* not json */ }
  if (data === null) throw new Error('The server could not be reached. Please try again.');
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

/* Puts a show/hide button on every password box, because a password you can't
   read is a password you can't check against the one above it. Revealing is
   per-field: showing one doesn't give away the others. */
export function addPasswordReveals(root) {
  (root || document).querySelectorAll('input[type="password"]').forEach(input => {
    const field = input.closest('.field');
    if (!field || field.classList.contains('has-reveal')) return;
    field.classList.add('has-reveal');

    const btn = document.createElement('button');
    btn.type = 'button';                     // never submits the form
    btn.className = 'reveal';
    btn.textContent = 'Show';
    btn.setAttribute('aria-controls', input.id || '');
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', 'Show password');

    btn.addEventListener('click', () => {
      const showing = input.type === 'password';
      input.type = showing ? 'text' : 'password';
      btn.textContent = showing ? 'Hide' : 'Show';
      btn.setAttribute('aria-pressed', String(showing));
      btn.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
      // Put the caret back where it was, rather than at the start.
      const at = input.value.length;
      input.focus();
      try { input.setSelectionRange(at, at); } catch (e) { /* not always allowed */ }
    });

    // The input gets its own wrapper so the button can sit inside its border.
    const wrap = document.createElement('div');
    wrap.className = 'input-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    wrap.appendChild(btn);
  });
}

export function say(el, text, kind) {
  el.textContent = text;
  el.className = 'msg ' + (kind || 'error');
  el.hidden = false;
}
export function clearSay(el) { el.hidden = true; }

// Disables the form while a request is in flight, so it cannot be sent twice.
export function submitting(form, on, label) {
  const btn = form.querySelector('button[type="submit"]');
  form.querySelectorAll('input, button').forEach(el => { el.disabled = on; });
  if (!btn) return;
  if (on) { btn.dataset.was = btn.textContent; btn.textContent = label || 'Working…'; }
  else if (btn.dataset.was) { btn.textContent = btn.dataset.was; }
}

/* Whatever the browser saved before accounts existed. Offered as an import
   once, and only into an account that has nothing in it yet. */
const LOCAL_KEYS = {
  jars: 'dreamreel_goals',
  wallet: 'dreamreel_wallet',
  savings: 'dreamreel_savings',
  funding: 'dreamreel_funding_log',
  savingsGoal: 'dreamreel_savings_goal'
};

export function readLocalData() {
  const read = (k, fallback) => {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  };
  const out = {
    jars: read(LOCAL_KEYS.jars, []),
    wallet: read(LOCAL_KEYS.wallet, []),
    savings: read(LOCAL_KEYS.savings, []),
    funding: read(LOCAL_KEYS.funding, []),
    savingsGoal: Number(localStorage.getItem(LOCAL_KEYS.savingsGoal)) || undefined
  };
  const count = out.jars.length + out.wallet.length + out.savings.length;
  return count ? out : null;
}

export function forgetLocalData() {
  Object.values(LOCAL_KEYS).forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
  try { localStorage.removeItem('dreamreel_wallet_v2'); } catch (e) {}
}

/* Called after a successful signup or login. Only offers when this browser has
   something and the account is empty, so nothing is ever silently replaced. */
export async function offerImport(hasData) {
  const local = readLocalData();
  if (!local || hasData) return;
  const bits = [];
  if (local.jars.length) bits.push(`${local.jars.length} jar${local.jars.length === 1 ? '' : 's'}`);
  if (local.wallet.length) bits.push(`${local.wallet.length} wallet entr${local.wallet.length === 1 ? 'y' : 'ies'}`);
  if (local.savings.length) bits.push(`${local.savings.length} savings entr${local.savings.length === 1 ? 'y' : 'ies'}`);
  const wants = confirm(
    `This browser still has data saved from before you had an account:\n\n  • ${bits.join('\n  • ')}\n\n` +
    `Move it into your account? Your account is currently empty, so nothing will be overwritten.`
  );
  if (!wants) return;
  try {
    await api('/api/import', local);
    forgetLocalData();
  } catch (e) {
    alert('That could not be imported: ' + e.message);
  }
}

export function goNext(fallback) {
  const next = new URLSearchParams(location.search).get('next');
  location.href = (next && next.startsWith('/') && !next.startsWith('//')) ? next : (fallback || '/');
}
