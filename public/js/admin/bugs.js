// Mémoire des Cévennes : admin / « Bug trouvé ! »
// Carnet de bord alimenté par les membres depuis /bugs.html. L'admin voit
// l'auteur et le navigateur, change le statut et peut répondre.

const BUG_STATUSES = [
  ['open',        'à regarder'],
  ['in-progress', 'en cours'],
  ['fixed',       'corrigé'],
  ['wontfix',     'pas retenu'],
];

async function refreshBugs() {
  const el = document.getElementById('bugs-list');
  if (!el) return;
  el.innerHTML = '<p class="empty">Chargement…</p>';
  try {
    const { bugs } = await fetchJson('/api/admin/bugs', authFetchOpts());
    if (!bugs.length) {
      el.innerHTML = '<p class="empty">Aucun bug ni remarque signalé pour l’instant.</p>';
      return;
    }
    el.innerHTML = bugs.map(b => {
      const when = b.createdAt ? new Date(b.createdAt).toLocaleString('fr-FR') : '';
      const kind = b.kind === 'remarque' ? '💡 Remarque' : '🐞 Bug';
      const opts = BUG_STATUSES.map(([v, label]) =>
        `<option value="${v}"${b.status === v ? ' selected' : ''}>${label}</option>`).join('');
      return `
        <div class="queue-item bug-row is-${escapeHtml(b.status)}" data-id="${escapeHtml(b.id)}">
          <div class="bug-head"><strong>${escapeHtml(b.title)}</strong></div>
          <p class="bug-desc">${escapeHtml(b.description)}</p>
          <div class="bug-meta">
            ${escapeHtml(kind)}${b.page ? ' · ' + escapeHtml(b.page) : ''}
            · par ${escapeHtml(b.memberName || '?')} · ${escapeHtml(when)}
          </div>
          ${b.userAgent ? `<div class="bug-meta">${escapeHtml(b.userAgent)}</div>` : ''}
          <div class="bug-actions">
            <select class="bug-status">${opts}</select>
            <input type="text" class="bug-note-input" maxlength="2000"
                   placeholder="Réponse visible par les membres (facultatif)"
                   value="${escapeHtml(b.adminNote || '')}" />
            <button type="button" class="btn-primary btn-inline bug-save">Enregistrer</button>
            <button type="button" class="btn-ghost btn-inline bug-del">🗑️ Supprimer</button>
          </div>
        </div>`;
    }).join('');

    el.querySelectorAll('.bug-save').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.bug-row');
        btn.disabled = true;
        try {
          const res = await fetch('/api/admin/bugs/' + encodeURIComponent(row.dataset.id),
            authFetchOpts({
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                status: row.querySelector('.bug-status').value,
                adminNote: row.querySelector('.bug-note-input').value,
              }),
            }));
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || res.statusText);
          refreshBugs();
        } catch (err) {
          alert('Erreur : ' + err.message);
          btn.disabled = false;
        }
      });
    });

    el.querySelectorAll('.bug-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.bug-row');
        if (!confirm('Supprimer définitivement cette entrée ?')) return;
        btn.disabled = true;
        try {
          const res = await fetch('/api/admin/bugs/' + encodeURIComponent(row.dataset.id),
            authFetchOpts({ method: 'DELETE' }));
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || res.statusText);
          row.remove();
        } catch (err) {
          alert('Erreur : ' + err.message);
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    el.innerHTML = `<p class="empty">Erreur : ${escapeHtml(err.message)}</p>`;
  }
}
