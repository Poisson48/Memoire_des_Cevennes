// Page « Bug trouvé ! » (public/bugs.html).
// Réservée aux membres : on demande d'abord /api/auth/me, et si personne
// n'est connecté on n'affiche qu'un message de verrouillage. Le serveur
// refuse de toute façon /api/bugs sans session membre.

(function () {
  const lockedEl = document.getElementById('bugs-locked');
  const appEl    = document.getElementById('bugs-app');
  const formEl   = document.getElementById('form-bug');
  const statusEl = document.getElementById('bug-status');
  const listEl   = document.getElementById('bugs-list');

  const KIND_LABEL = { bug: '🐞 Bug', remarque: '💡 Remarque' };
  const STATUS_LABEL = {
    'open':        'à regarder',
    'in-progress': 'en cours',
    'fixed':       'corrigé',
    'wontfix':     'pas retenu',
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function say(msg, kind) {
    statusEl.hidden = false;
    statusEl.className = 'bugs-status is-' + kind;
    statusEl.textContent = msg;
  }

  function render(bugs) {
    if (!bugs.length) {
      listEl.innerHTML = '<p class="empty">Rien pour l’instant. Tu seras peut-être la première personne à tomber sur quelque chose.</p>';
      return;
    }
    listEl.innerHTML = bugs.map(b => {
      const st = STATUS_LABEL[b.status] || b.status;
      const when = b.createdAt ? new Date(b.createdAt).toLocaleDateString('fr-FR') : '';
      return `
        <div class="bug-row is-${esc(b.status)}" data-id="${esc(b.id)}">
          <div class="bug-head">
            <strong>${esc(b.title)}</strong>
            <span class="bug-badge bug-${esc(b.status)}">${esc(st)}</span>
          </div>
          <p class="bug-desc">${esc(b.description)}</p>
          <div class="bug-meta">
            ${esc(KIND_LABEL[b.kind] || b.kind)}
            ${b.page ? ' · ' + esc(b.page) : ''}
            · par ${esc(b.authorName)} · ${esc(when)}
          </div>
          ${b.adminNote ? `<div class="bug-note">Réponse : ${esc(b.adminNote)}</div>` : ''}
          ${b.mine ? '<button type="button" class="btn-ghost btn-inline bug-del">🗑️ Retirer</button>' : ''}
        </div>`;
    }).join('');

    listEl.querySelectorAll('.bug-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.bug-row');
        if (!window.confirm('Retirer cette entrée ?')) return;
        btn.disabled = true;
        try {
          const r = await fetch('/api/bugs/' + encodeURIComponent(row.dataset.id),
            { method: 'DELETE', credentials: 'include' });
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
          await refresh();
        } catch (e) {
          say('⚠️ Erreur : ' + e.message, 'error');
          btn.disabled = false;
        }
      });
    });
  }

  async function refresh() {
    try {
      const r = await fetch('/api/bugs', { credentials: 'include', cache: 'no-store' });
      if (!r.ok) throw new Error(r.statusText);
      const { bugs } = await r.json();
      render(bugs || []);
    } catch (e) {
      listEl.innerHTML = '<p class="empty">Impossible de charger la liste.</p>';
    }
  }

  formEl.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(formEl);
    const btn = formEl.querySelector('button[type=submit]');
    btn.disabled = true;
    say('Envoi…', 'working');
    try {
      const r = await fetch('/api/bugs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          kind: fd.get('kind'),
          title: fd.get('title'),
          description: fd.get('description'),
          page: fd.get('page'),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || r.statusText);
      formEl.reset();
      say('✅ Merci, c’est noté.', 'done');
      await refresh();
    } catch (e) {
      say('⚠️ Erreur : ' + e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  (async function init() {
    let member = null;
    try {
      const r = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' });
      if (r.ok) member = (await r.json()).member || null;
    } catch { /* hors ligne : on traite comme non connecté */ }
    if (!member) { lockedEl.hidden = false; return; }
    appEl.hidden = false;
    refresh();
  })();
})();
