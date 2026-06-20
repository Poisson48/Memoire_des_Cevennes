// Mémoire des Cévennes : admin / anonymisations (redactions)
// Vue d'ensemble des passages masqués de tous les récits. L'admin voit le
// texte original et peut retirer un masquage.

async function refreshRedactions() {
  const el = document.getElementById('redactions-list');
  if (!el) return;
  el.innerHTML = '<p class="empty">Chargement…</p>';
  try {
    const { redactions } = await fetchJson('/api/admin/redactions', authFetchOpts());
    if (!redactions.length) {
      el.innerHTML = '<p class="empty">Aucun passage masqué pour l’instant.</p>';
      return;
    }
    el.innerHTML = redactions.map(r => {
      const scope = r.hideBelow === 'admin' ? 'public + membres' : 'public';
      const mode = r.mode === 'censor' ? 'censuré' : 'anonymisé';
      const repl = r.mode === 'censor' ? '' : ` → « ${escapeHtml(r.replacement || '[anonymisé]')} »`;
      const when = r.at ? new Date(r.at).toLocaleString('fr-FR') : '';
      return `
        <div class="redaction-row" data-story="${escapeHtml(r.storyId)}" data-rid="${escapeHtml(r.id)}">
          <div class="redaction-main">
            <a href="/#/recit/${encodeURIComponent(r.storyId)}" target="_blank" rel="noopener"><strong>${escapeHtml(r.storyTitle)}</strong></a>
            · ${escapeHtml(mode)}${repl} · caché à : <strong>${escapeHtml(scope)}</strong>
          </div>
          <div class="redaction-orig">Texte masqué : « ${escapeHtml(r.original || '')} »</div>
          <div class="redaction-meta">
            ${r.reason ? 'motif : ' + escapeHtml(r.reason) + ' · ' : ''}
            ${r.by ? 'par ' + escapeHtml(r.by) + ' · ' : ''}${escapeHtml(when)}
          </div>
          <button type="button" class="btn-ghost btn-inline redaction-del">🗑️ Retirer le masquage</button>
        </div>`;
    }).join('');

    el.querySelectorAll('.redaction-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.redaction-row');
        const storyId = row.dataset.story;
        const rid = row.dataset.rid;
        if (!confirm('Retirer ce masquage ? Le passage redeviendra visible selon la visibilité du récit.')) return;
        btn.disabled = true;
        try {
          const res = await fetch(
            `/api/admin/redactions/${encodeURIComponent(storyId)}/${encodeURIComponent(rid)}`,
            authFetchOpts({ method: 'DELETE' }));
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || res.statusText);
          row.remove();
          if (!el.querySelector('.redaction-row')) {
            el.innerHTML = '<p class="empty">Aucun passage masqué pour l’instant.</p>';
          }
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
