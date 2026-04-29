// Mémoire des Cévennes — admin / journal d'activité
// Affiche le journal d'audit (data/activity_log.json) : qui a fait quoi, quand.

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
