// Mémoire des Cévennes — page admin / noyau
// Helpers d'auth (token partagé OU JWT cookie), DOM refs login/dashboard,
// formulaires de connexion, échappement HTML, formatage de tailles.
// Visible par tous les autres modules /js/admin/* (chargés ensuite).

const STORAGE_KEY  = 'mdc-admin-token';
const REVIEWER_KEY = 'mdc-admin-reviewer';
const MODE_KEY     = 'mdc-admin-mode'; // 'token' ou 'jwt'

const loginSection      = document.getElementById('login');
const dashboard         = document.getElementById('dashboard');
const formLoginAccount  = document.getElementById('form-login-account');
const formLoginToken    = document.getElementById('form-login-token');
const btnLogout         = document.getElementById('btn-logout');
const queueEl           = document.getElementById('queue');
const countsEl          = document.getElementById('admin-counts');

// Bascule entre les deux formulaires de login (compte vs token).
document.querySelectorAll('[data-login]').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-login]').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    const m = b.dataset.login;
    formLoginAccount.hidden = m !== 'account';
    formLoginToken.hidden   = m !== 'token';
  });
});

let currentFilter = 'all';
let currentTab    = 'queue';

const queueSection    = document.getElementById('queue');
const aliasesSection  = document.getElementById('aliases');
const membersSection  = document.getElementById('members');
const resetsSection   = document.getElementById('resets');
const activitySection = document.getElementById('activity');
const backupsSection  = document.getElementById('backups');
const welcomeSection  = document.getElementById('welcome');
const settingsSection = document.getElementById('settings');
const cadastreSection = document.getElementById('cadastre');
const helpSection     = document.getElementById('help');

btnLogout.addEventListener('click', async () => {
  // Côté serveur : efface les cookies (admin_jwt + token membre).
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
  // Côté client : oublie le token partagé en localStorage.
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(REVIEWER_KEY);
  localStorage.removeItem(MODE_KEY);
  showLogin();
});

// ─── Login par compte admin (email + mdp) ──────────────────────────────
formLoginAccount.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('auth-error-account');
  errEl.hidden = true;
  const fd = new FormData(formLoginAccount);
  try {
    const res = await fetch('/api/auth/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        email:    fd.get('email'),
        password: fd.get('password'),
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      errEl.textContent = json.error || 'Identifiants invalides.';
      errEl.hidden = false;
      return;
    }
    localStorage.setItem(MODE_KEY, 'jwt');
    localStorage.setItem(REVIEWER_KEY, json.member && json.member.name ? json.member.name : 'admin');
    showDashboard();
  } catch (err) {
    errEl.textContent = 'Serveur injoignable : ' + err.message;
    errEl.hidden = false;
  }
});

// ─── Login par token partagé (legacy) ──────────────────────────────────
formLoginToken.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('auth-error-token');
  errEl.hidden = true;
  const fd = new FormData(formLoginToken);
  const tk = fd.get('token');
  const rv = fd.get('reviewer') || 'admin';
  try {
    await fetchJson('/api/admin/queue', { headers: { 'X-Admin-Token': tk } });
    localStorage.setItem(MODE_KEY, 'token');
    localStorage.setItem(STORAGE_KEY, tk);
    localStorage.setItem(REVIEWER_KEY, rv);
    showDashboard();
  } catch (err) {
    errEl.textContent = 'Token invalide ou serveur indisponible : ' + err.message;
    errEl.hidden = false;
  }
});

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

function mode()     { return localStorage.getItem(MODE_KEY) || 'token'; }
function token()    { return localStorage.getItem(STORAGE_KEY) || ''; }
function reviewer() { return localStorage.getItem(REVIEWER_KEY) || 'admin'; }

// En mode JWT, on s'appuie sur le cookie httpOnly admin_jwt (auto envoyé).
// En mode token, on injecte X-Admin-Token dans les headers.
function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (mode() === 'token') h['X-Admin-Token'] = token();
  return h;
}
function authFetchOpts(opts = {}) {
  return { credentials: 'same-origin', ...opts, headers: { ...authHeaders(), ...(opts.headers || {}) } };
}

function showLogin() {
  loginSection.hidden = false;
  dashboard.hidden = true;
  btnLogout.hidden = true;
}
function showDashboard() {
  loginSection.hidden = true;
  dashboard.hidden = false;
  btnLogout.hidden = false;
  refresh();
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
function escapeAttr(str) { return escapeHtml(str); }

function typeLabel(t) {
  return { places: 'Lieu', people: 'Personne', stories: 'Récit', edits: 'Modif' }[t] || t;
}

function formatValue(v) {
  if (v === null || typeof v === 'undefined') return '<em>(vide)</em>';
  if (typeof v === 'string') return escapeHtml(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return escapeHtml(JSON.stringify(v, null, 2));
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return '?';
  if (bytes < 1024) return bytes + ' o';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' Ko';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1048576).toFixed(1) + ' Mo';
  return (bytes / 1073741824).toFixed(2) + ' Go';
}
