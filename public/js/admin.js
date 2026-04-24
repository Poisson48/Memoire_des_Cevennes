// Mémoire des Cévennes — page admin
// Token stocké en localStorage, envoyé dans les headers de chaque requête.
// Lit la file /api/admin/queue et permet d'approuver / refuser chaque item.

const STORAGE_KEY = 'mdc-admin-token';
const REVIEWER_KEY = 'mdc-admin-reviewer';

const loginSection = document.getElementById('login');
const dashboard = document.getElementById('dashboard');
const formLogin = document.getElementById('form-login');
const btnLogout = document.getElementById('btn-logout');
const queueEl = document.getElementById('queue');
const countsEl = document.getElementById('admin-counts');

let currentFilter = 'all';
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderQueue(lastQueue);
  });
});

btnLogout.addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(REVIEWER_KEY);
  showLogin();
});

formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(formLogin);
  const token = fd.get('token');
  const reviewer = fd.get('reviewer') || 'admin';
  // Teste le token
  try {
    await fetchJson('/api/admin/queue', { headers: { 'X-Admin-Token': token } });
    localStorage.setItem(STORAGE_KEY, token);
    localStorage.setItem(REVIEWER_KEY, reviewer);
    showDashboard();
  } catch (err) {
    alert('Token invalide ou serveur indisponible : ' + err.message);
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

function token() { return localStorage.getItem(STORAGE_KEY) || ''; }
function reviewer() { return localStorage.getItem(REVIEWER_KEY) || 'admin'; }
function authHeaders() {
  return { 'X-Admin-Token': token(), 'Content-Type': 'application/json' };
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

let lastQueue = [];
async function refresh() {
  queueEl.innerHTML = '<p class="empty">Chargement…</p>';
  try {
    const data = await fetchJson('/api/admin/queue', { headers: { 'X-Admin-Token': token() } });
    lastQueue = data.queue;
    renderCounts(data.counts);
    renderQueue(data.queue);
  } catch (err) {
    queueEl.innerHTML = `<p class="empty">Erreur : ${escapeHtml(err.message)}</p>`;
  }
}

function renderCounts(counts) {
  if (!counts) { countsEl.innerHTML = ''; return; }
  const rows = [
    ['Lieux',         counts.places],
    ['Personnes',     counts.people],
    ['Récits',        counts.stories],
    ['Modifications', counts.edits],
    ['Complétions',   counts.completions],
  ];
  countsEl.innerHTML = rows.map(([label, c]) => c ? `
    <div class="count-card">
      ${label} : <strong>${c.pending || 0}</strong> en attente
      <small>· ${c.approved || 0} approuvés · ${c.rejected || 0} refusés</small>
    </div>
  ` : '').join('');
}

function renderQueue(items) {
  const filtered = items.filter(i => {
    if (currentFilter === 'all') return true;
    if (currentFilter === 'edit') return i.kind === 'edit' || i.kind === 'completion';
    return i.kind === currentFilter;
  });
  if (filtered.length === 0) {
    queueEl.innerHTML = '<p class="empty">✨ Rien à modérer — tout est à jour.</p>';
    return;
  }
  queueEl.innerHTML = filtered.map(renderItem).join('');

  // branch les boutons
  queueEl.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => handleAction(btn));
  });
}

function renderItem(qi) {
  if (qi.kind === 'edit') return renderEdit(qi);
  if (qi.kind === 'completion') return renderCompletion(qi);
  return renderCreate(qi);
}

function renderCompletion(qi) {
  const comp = qi.item;
  const who = comp.submittedBy || {};
  const whoLine = [
    who.name ? `<strong>${escapeHtml(who.name)}</strong>` : '<em>Anonyme</em>',
    who.writtenFrom ? `depuis ${escapeHtml(who.writtenFrom)}` : null,
    who.relationship ? `<em>(${escapeHtml(who.relationship)})</em>` : null,
  ].filter(Boolean).join(' · ');
  const date = comp.submittedAt ? new Date(comp.submittedAt).toLocaleString('fr-FR') : '';
  return `
    <article class="queue-item kind-edit" data-kind="completion" data-story-id="${escapeAttr(qi.storyId)}" data-id="${escapeAttr(comp.id)}">
      <div class="item-head">
        <span class="kind-badge edit">Complétion</span>
        <span class="kind-badge type">Récit</span>
        <h3>sur « ${escapeHtml(qi.storyTitle || qi.storyId)} »</h3>
        <span class="item-meta">${whoLine} · ${date}</span>
      </div>
      <div class="item-preview">
        <div>${escapeHtml(comp.body)}</div>
      </div>
      ${renderActions()}
    </article>
  `;
}

function renderCreate(qi) {
  const item = qi.item;
  const type = qi.entityType;
  const sub = item.submittedBy ? `par ${escapeHtml(item.submittedBy.pseudo || item.submittedBy.email || '?')} · ` : '';
  const date = item.submittedAt ? new Date(item.submittedAt).toLocaleString('fr-FR') : '';

  let preview = '';
  if (type === 'places') {
    preview = `
      <div><strong>${escapeHtml(item.primaryName)}</strong> · ${item.lat?.toFixed?.(4)}, ${item.lng?.toFixed?.(4)}</div>
      ${item.description ? `<div>${escapeHtml(item.description)}</div>` : ''}
      ${item.aliases?.length ? `<div class="item-meta">alias : ${item.aliases.map(a => escapeHtml(a.name)).join(' · ')}</div>` : ''}
    `;
  } else if (type === 'people') {
    preview = `
      <div><strong>${escapeHtml(item.primaryName)}</strong>${item.maidenName ? ` (née ${escapeHtml(item.maidenName)})` : ''}</div>
      ${item.bio ? `<div>${escapeHtml(item.bio)}</div>` : ''}
      <div class="item-meta">
        ${item.birth?.year ? `né·e ${item.birth.year}` : ''}
        ${item.death?.year ? ` · † ${item.death.year}` : ''}
      </div>
    `;
  } else if (type === 'stories') {
    preview = `
      ${item.title ? `<div><strong>${escapeHtml(item.title)}</strong></div>` : ''}
      <div>${escapeHtml((item.body || '').slice(0, 400))}${(item.body || '').length > 400 ? '…' : ''}</div>
      <div class="item-meta">
        ancré sur <code>${escapeHtml(item.placeId)}</code>
        ${item.memoryDate ? ` · ${escapeHtml(item.memoryDate)}` : ''}
      </div>
    `;
  }

  return `
    <article class="queue-item kind-create" data-kind="create" data-type="${type}" data-id="${escapeAttr(item.id)}">
      <div class="item-head">
        <span class="kind-badge">Nouveau</span>
        <span class="kind-badge type">${typeLabel(type)}</span>
        <h3>${escapeHtml(item.primaryName || item.title || item.id)}</h3>
        <span class="item-meta">${sub}${date}</span>
      </div>
      <div class="item-preview">${preview}</div>
      ${renderActions()}
    </article>
  `;
}

function renderEdit(qi) {
  const edit = qi.item;
  const target = qi.diff?.target;
  const rows = qi.diff?.rows || [];
  const sub = edit.submittedBy ? `par ${escapeHtml(edit.submittedBy.pseudo || edit.submittedBy.email || '?')} · ` : '';
  const date = edit.submittedAt ? new Date(edit.submittedAt).toLocaleString('fr-FR') : '';
  const targetName = target
    ? (target.primaryName || target.title || target.id)
    : edit.targetId;

  const diffHtml = rows.length ? `
    <table class="diff">
      <thead>
        <tr><th class="field">Champ</th><th>Avant</th><th>Après</th></tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td class="field">${escapeHtml(r.field)}</td>
            <td class="before">${formatValue(r.before)}</td>
            <td class="after">${formatValue(r.after)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : '<p class="item-meta">Aucun diff calculable (cible introuvable ?)</p>';

  return `
    <article class="queue-item kind-edit" data-kind="edit" data-type="edits" data-id="${escapeAttr(edit.id)}">
      <div class="item-head">
        <span class="kind-badge edit">Modif</span>
        <span class="kind-badge type">${typeLabel(edit.targetType)}</span>
        <h3>${escapeHtml(targetName)}</h3>
        <span class="item-meta">${sub}${date}</span>
      </div>
      ${edit.note ? `<div class="edit-note">✏️ ${escapeHtml(edit.note)}</div>` : ''}
      ${diffHtml}
      ${renderActions()}
    </article>
  `;
}

function renderActions() {
  return `
    <div class="item-actions">
      <button type="button" class="btn-ghost btn-reject" data-action="reject">✗ Refuser</button>
      <button type="button" class="btn-primary btn-approve" data-action="approve">✓ Approuver</button>
    </div>
  `;
}

async function handleAction(btn) {
  const card = btn.closest('.queue-item');
  const kind = card.dataset.kind;
  const type = card.dataset.type;
  const id = card.dataset.id;
  const action = btn.dataset.action;

  let reason = '';
  if (action === 'reject') {
    reason = prompt('Motif du refus (sera visible dans les archives) :', '');
    if (reason === null) return;
  }

  let url;
  if (kind === 'edit') {
    url = `/api/admin/edits/${encodeURIComponent(id)}/${action}`;
  } else if (kind === 'completion') {
    url = `/api/admin/stories/${encodeURIComponent(card.dataset.storyId)}/completions/${encodeURIComponent(id)}/${action}`;
  } else {
    url = `/api/admin/${type}/${encodeURIComponent(id)}/${action}`;
  }

  try {
    await fetchJson(url, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ reviewer: reviewer(), reason }),
    });
    card.style.opacity = '0.5';
    setTimeout(refresh, 300);
  } catch (err) {
    alert('Erreur : ' + err.message);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────
function typeLabel(t) {
  return { places: 'Lieu', people: 'Personne', stories: 'Récit', edits: 'Modif' }[t] || t;
}

function formatValue(v) {
  if (v === null || typeof v === 'undefined') return '<em>(vide)</em>';
  if (typeof v === 'string') return escapeHtml(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return escapeHtml(JSON.stringify(v, null, 2));
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
function escapeAttr(str) { return escapeHtml(str); }

// ── Boot ───────────────────────────────────────────────────────────────
if (token()) {
  // Vérifie qu'il est encore valide
  fetchJson('/api/admin/queue', { headers: { 'X-Admin-Token': token() } })
    .then(showDashboard)
    .catch(() => showLogin());
} else {
  showLogin();
}
