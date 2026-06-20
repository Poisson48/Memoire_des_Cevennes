// Mémoire des Cévennes : admin / journal des opérations (détection d'abus)
// OCR, lecture vocale (TTS), génération de livret PDF. Récap par IP + par
// type, puis les dernières opérations.

async function refreshOplog() {
  const sum = document.getElementById('oplog-summary');
  const list = document.getElementById('oplog-list');
  if (!sum || !list) return;
  sum.innerHTML = '<p class="empty">Chargement…</p>';
  list.innerHTML = '';
  try {
    const data = await fetchJson('/api/admin/oplog', authFetchOpts());
    const { recent, total, topIps, ops } = data;

    if (!total) {
      sum.innerHTML = '<p class="empty">Aucune opération enregistrée pour l’instant.</p>';
      return;
    }

    const opsChips = ops.map(o => `<span class="oplog-chip">${escapeHtml(o.op)} : <strong>${o.count}</strong></span>`).join('');
    const ipsRows = topIps.map(r => `
      <tr><td><code>${escapeHtml(r.ip)}</code></td><td class="num">${r.count}</td></tr>
    `).join('');

    sum.innerHTML = `
      <div class="oplog-cards">
        <div class="oplog-card">
          <h4>Par type d'opération <small>(sur ${total} récentes)</small></h4>
          <div class="oplog-chips">${opsChips}</div>
        </div>
        <div class="oplog-card">
          <h4>IP les plus actives</h4>
          <table class="oplog-table"><thead><tr><th>IP</th><th class="num">opérations</th></tr></thead>
            <tbody>${ipsRows}</tbody></table>
        </div>
      </div>`;

    list.innerHTML = `
      <h4>${recent.length} dernières opérations</h4>
      <table class="oplog-table oplog-recent">
        <thead><tr><th>Quand</th><th>Op</th><th>IP</th><th>Utilisateur</th><th>Détails</th></tr></thead>
        <tbody>${recent.map(rowHtml).join('')}</tbody>
      </table>`;
  } catch (err) {
    sum.innerHTML = `<p class="empty">Erreur : ${escapeHtml(err.message)}</p>`;
  }
}

function rowHtml(e) {
  const when = e.ts ? new Date(e.ts).toLocaleString('fr-FR') : '';
  // Détails = tous les champs hors méta connus.
  const skip = new Set(['ts', 'op', 'ip', 'user']);
  const details = Object.entries(e)
    .filter(([k, v]) => !skip.has(k) && v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${escapeHtml(k)}=${escapeHtml(String(v))}`)
    .join('  ');
  return `<tr>
    <td>${escapeHtml(when)}</td>
    <td><code>${escapeHtml(e.op || '')}</code></td>
    <td><code>${escapeHtml(e.ip || '')}</code></td>
    <td>${escapeHtml(e.user || '')}</td>
    <td class="oplog-details">${escapeHtml(details)}</td>
  </tr>`;
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('oplog-refresh');
  if (btn) btn.addEventListener('click', refreshOplog);
});
