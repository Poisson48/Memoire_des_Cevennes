// Mémoire des Cévennes — page admin
// Token stocké en localStorage, envoyé dans les headers de chaque requête.
// Lit la file /api/admin/queue et permet d'approuver / refuser chaque item.

const STORAGE_KEY = 'mdc-admin-token';
const REVIEWER_KEY = 'mdc-admin-reviewer';
const MODE_KEY     = 'mdc-admin-mode'; // 'token' ou 'jwt'

const loginSection = document.getElementById('login');
const dashboard = document.getElementById('dashboard');
const formLoginAccount = document.getElementById('form-login-account');
const formLoginToken   = document.getElementById('form-login-token');
const btnLogout = document.getElementById('btn-logout');
const queueEl = document.getElementById('queue');
const countsEl = document.getElementById('admin-counts');

// Bascule entre les deux formulaires de login (compte vs token).
document.querySelectorAll('[data-login]').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-login]').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    const mode = b.dataset.login;
    formLoginAccount.hidden = mode !== 'account';
    formLoginToken.hidden   = mode !== 'token';
  });
});

let currentFilter = 'all';
let currentTab = 'queue';
const queueSection    = document.getElementById('queue');
const membersSection  = document.getElementById('members');
const activitySection = document.getElementById('activity');

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab || 'queue';
    if (btn.dataset.filter) currentFilter = btn.dataset.filter;
    queueSection.hidden    = currentTab !== 'queue';
    membersSection.hidden  = currentTab !== 'members';
    activitySection.hidden = currentTab !== 'activity';
    if (currentTab === 'queue')    renderQueue(lastQueue);
    if (currentTab === 'members')  refreshMembers();
    if (currentTab === 'activity') refreshActivity();
  });
});

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

let lastQueue = [];
async function refresh() {
  queueEl.innerHTML = '<p class="empty">Chargement…</p>';
  try {
    const data = await fetchJson('/api/admin/queue', authFetchOpts());
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
        <div class="story-body">${renderBodyWithMentions(comp.body, comp.mentions || [])}</div>
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
      <div class="story-body">${renderBodyWithMentions(item.body || '', item.mentions || [])}</div>
      ${renderMediaFiles(item.mediaFiles || [])}
      <div class="item-meta">
        type : <strong>${escapeHtml(item.type || 'text')}</strong>
        · ancré sur <code>${escapeHtml(item.placeId)}</code>
        ${item.memoryDate ? ` · ${escapeHtml(item.memoryDate)}` : ''}
        ${item.mentions?.length ? ` · ${item.mentions.length} mention${item.mentions.length>1?'s':''}` : ''}
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
      <button type="button" class="btn-ghost btn-delete"  data-action="delete">🗑️ Supprimer</button>
      <button type="button" class="btn-ghost btn-reject"  data-action="reject">✗ Refuser</button>
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
  if (action === 'delete') {
    if (!confirm('Suppression DÉFINITIVE — cette contribution sera retirée de la base et ses médias effacés du serveur. Continuer ?')) return;
  }

  let url, method = 'POST';
  if (action === 'delete') {
    method = 'DELETE';
    if (kind === 'completion') {
      url = `/api/admin/stories/${encodeURIComponent(card.dataset.storyId)}/completions/${encodeURIComponent(id)}`;
    } else if (kind === 'edit') {
      // Pour les propositions de modification, "supprimer" = "rejeter" sans motif.
      url = `/api/admin/edits/${encodeURIComponent(id)}/reject`;
      method = 'POST';
    } else {
      url = `/api/admin/${type}/${encodeURIComponent(id)}`;
    }
  } else if (kind === 'edit') {
    url = `/api/admin/edits/${encodeURIComponent(id)}/${action}`;
  } else if (kind === 'completion') {
    url = `/api/admin/stories/${encodeURIComponent(card.dataset.storyId)}/completions/${encodeURIComponent(id)}/${action}`;
  } else {
    url = `/api/admin/${type}/${encodeURIComponent(id)}/${action}`;
  }

  try {
    await fetchJson(url, authFetchOpts({
      method,
      body: method === 'DELETE' ? undefined : JSON.stringify({ reviewer: reviewer(), reason }),
    }));
    card.style.opacity = '0.5';
    setTimeout(refresh, 300);
  } catch (err) {
    alert('Erreur : ' + err.message);
  }
}

// Rend le corps d'un récit avec les mentions surlignées et cliquables.
// Les offsets `start`/`end` correspondent à la chaîne en code units UTF-16.
function renderBodyWithMentions(body, mentions) {
  if (!body) return '<em>(vide)</em>';
  const sorted = [...mentions]
    .filter(m => m && typeof m.start === 'number' && typeof m.end === 'number')
    .sort((a, b) => a.start - b.start);
  if (!sorted.length) return escapeHtml(body).replace(/\n/g, '<br>');
  let out = '';
  let cursor = 0;
  for (const m of sorted) {
    if (m.start < cursor || m.end > body.length) continue;
    out += escapeHtml(body.slice(cursor, m.start));
    const label = body.slice(m.start, m.end);
    const href = m.type === 'place' ? `#/lieu/${m.entityId}` : `#/personne/${m.entityId}`;
    const icon = m.type === 'place' ? '📍' : '👤';
    out += `<a class="mention-link" href="${escapeAttr(href)}" target="_blank" rel="noopener" title="${escapeHtml(m.type)} : ${escapeHtml(m.entityId)}">${icon} ${escapeHtml(label)}</a>`;
    cursor = m.end;
  }
  out += escapeHtml(body.slice(cursor));
  return out.replace(/\n/g, '<br>');
}

// Rend les médias attachés à un récit pour relecture en file de modération.
// Inline preview pour images/audio/vidéo, lien pour le reste.
function renderMediaFiles(files) {
  if (!Array.isArray(files) || !files.length) return '';
  const items = files.map(f => {
    if (!f || !f.url) return '';
    const url = escapeAttr(f.url);
    const cap = f.caption ? `<figcaption>${escapeHtml(f.caption)}</figcaption>` : '';
    if (f.mime?.startsWith('image/')) {
      return `<figure class="qmedia"><img src="${url}" alt="${escapeAttr(f.caption || 'média')}" loading="lazy">${cap}</figure>`;
    }
    if (f.mime?.startsWith('audio/')) {
      return `<figure class="qmedia"><audio controls preload="metadata" src="${url}"></audio>${cap}</figure>`;
    }
    if (f.mime?.startsWith('video/')) {
      return `<figure class="qmedia"><video controls preload="metadata" src="${url}" style="max-width:100%;max-height:280px"></video>${cap}</figure>`;
    }
    return `<div class="qmedia"><a href="${url}" target="_blank" rel="noopener">📎 ${escapeHtml(f.url.split('/').pop())}</a>${cap}</div>`;
  }).join('');
  return `<div class="qmedia-list">${items}</div>`;
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

// ── Membres ────────────────────────────────────────────────────────────
// Formulaire de création directe d'un compte (admin seulement, route protégée)
const formCreateMember = document.getElementById('form-create-member');
if (formCreateMember) {
  formCreateMember.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('create-member-error');
    const okEl  = document.getElementById('create-member-success');
    errEl.hidden = true; okEl.hidden = true;
    const fd = new FormData(formCreateMember);
    try {
      const res = await fetch('/api/admin/members', authFetchOpts({
        method: 'POST',
        body: JSON.stringify({
          name:     fd.get('name'),
          email:    fd.get('email'),
          password: fd.get('password'),
          role:     fd.get('role'),
        }),
      }));
      const j = await res.json();
      if (!res.ok) {
        errEl.textContent = j.error || 'Erreur';
        errEl.hidden = false;
        return;
      }
      okEl.textContent = `✓ Compte créé : ${j.member.email} (${j.member.role})`;
      okEl.hidden = false;
      formCreateMember.reset();
      refreshMembers();
    } catch (err) {
      errEl.textContent = 'Serveur injoignable : ' + err.message;
      errEl.hidden = false;
    }
  });
}

async function refreshMembers() {
  document.getElementById('members-pending').innerHTML = '<p class="empty">Chargement…</p>';
  document.getElementById('members-active').innerHTML  = '';
  try {
    const { members } = await fetchJson('/api/admin/members', authFetchOpts());
    const pending = members.filter(m => m.status !== 'active');
    const active  = members.filter(m => m.status === 'active');
    renderMembers(document.getElementById('members-pending'), pending, true);
    renderMembers(document.getElementById('members-active'),  active,  false);
  } catch (err) {
    document.getElementById('members-pending').innerHTML =
      `<p class="empty">Erreur : ${escapeHtml(err.message)}</p>`;
  }
}

function renderMembers(container, members, showApprove) {
  if (!members.length) {
    container.innerHTML = '<p class="empty">— aucun —</p>';
    return;
  }
  container.innerHTML = members.map(m => `
    <article class="queue-item" data-member-id="${escapeAttr(m.id)}">
      <header>
        <strong>${escapeHtml(m.name || '(sans nom)')}</strong>
        · <code>${escapeHtml(m.email)}</code>
        · <span class="status">${escapeHtml(m.status)}</span>
        · rôle : <strong>${escapeHtml(m.role)}</strong>
      </header>
      <p class="meta">
        inscrit le ${escapeHtml(new Date(m.createdAt).toLocaleString('fr-FR'))}
        ${m.approvedAt ? ` · approuvé le ${escapeHtml(new Date(m.approvedAt).toLocaleString('fr-FR'))}` : ''}
      </p>
      <div class="actions">
        ${showApprove ? `<button type="button" class="btn-primary" data-member-action="approve">✓ Approuver</button>` : ''}
        <select data-member-action="role" aria-label="Rôle">
          <option value="member"       ${m.role === 'member' ? 'selected' : ''}>Membre</option>
          <option value="contributor"  ${m.role === 'contributor' ? 'selected' : ''}>Contributeur</option>
          <option value="admin"        ${m.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
      </div>
    </article>
  `).join('');
  container.querySelectorAll('[data-member-action]').forEach(el => {
    const card = el.closest('[data-member-id]');
    const id = card.dataset.memberId;
    if (el.tagName === 'BUTTON' && el.dataset.memberAction === 'approve') {
      el.addEventListener('click', () => handleMemberApprove(id, card));
    } else if (el.tagName === 'SELECT') {
      el.addEventListener('change', () => handleMemberRole(id, el.value, card));
    }
  });
}

async function handleMemberApprove(id, card) {
  try {
    await fetchJson(`/api/admin/members/${encodeURIComponent(id)}/approve`,
      { method: 'POST', headers: authHeaders() });
    card.style.opacity = '0.5';
    setTimeout(refreshMembers, 300);
  } catch (err) { alert('Erreur : ' + err.message); }
}

async function handleMemberRole(id, role, card) {
  try {
    await fetchJson(`/api/admin/members/${encodeURIComponent(id)}/role`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ role }),
    });
  } catch (err) { alert('Erreur : ' + err.message); refreshMembers(); }
}

// ── Journal d'activité ─────────────────────────────────────────────────
async function refreshActivity() {
  const el = document.getElementById('activity-list');
  el.innerHTML = '<p class="empty">Chargement…</p>';
  try {
    const { activity } = await fetchJson('/api/admin/activity', authFetchOpts());
    if (!activity.length) { el.innerHTML = '<p class="empty">— journal vide —</p>'; return; }
    el.innerHTML = activity.map(a => `
      <div class="activity-row">
        <time>${escapeHtml(new Date(a.timestamp).toLocaleString('fr-FR'))}</time>
        · membre <code>${escapeHtml(a.memberId || '—')}</code>
        · ${escapeHtml(a.action)} ${escapeHtml(a.entityType || '')}
        ${a.entityId ? `<code>${escapeHtml(a.entityId)}</code>` : ''}
        ${a.ip ? `<small>(${escapeHtml(a.ip)})</small>` : ''}
      </div>
    `).join('');
  } catch (err) {
    el.innerHTML = `<p class="empty">Erreur : ${escapeHtml(err.message)}</p>`;
  }
}

// ── Boot ───────────────────────────────────────────────────────────────
// Tentative de session existante : soit le token partagé en localStorage,
// soit le cookie admin_jwt (httpOnly, transmis automatiquement). On
// pingue /queue avec authFetchOpts(), si ça passe → dashboard.
fetchJson('/api/admin/queue', authFetchOpts())
  .then(showDashboard)
  .catch(() => showLogin());
