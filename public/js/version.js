// Affiche la version du programme dans tous les <span data-version> de la page.
// Source : GET /api/version, basé sur package.json.
//
// Cliquer sur une pastille de version ouvre la dialog "Quoi de neuf ?" qui
// liste les bumps de version (lus depuis git log via /api/changelog).
(function () {
  const slots = document.querySelectorAll('[data-version]');
  if (!slots.length) return;

  fetch('/api/version', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : null)
    .then(j => {
      if (!j || !j.version) return;
      const label = `v${j.version}`;
      slots.forEach(el => {
        el.textContent = label;
        el.title = `${label} · cliquer pour voir les nouveautés`;
        el.style.cursor = 'pointer';
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.addEventListener('click', openChangelog);
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openChangelog(); }
        });
      });
    })
    .catch(() => { /* serveur indispo, on laisse vide */ });

  // ── Dialog changelog ───────────────────────────────────────────
  let dialog = null;
  let loaded = false;

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'dlg-changelog';
    dialog.className = 'dlg-changelog';
    dialog.innerHTML = `
      <form method="dialog" class="dlg-changelog-head">
        <h2>Quoi de neuf ?</h2>
        <button type="submit" class="btn-ghost btn-small" aria-label="Fermer">✕</button>
      </form>
      <div class="dlg-changelog-body" id="changelog-body">
        <p class="muted">Chargement…</p>
      </div>
    `;
    document.body.appendChild(dialog);
    return dialog;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function renderEntries(entries) {
    if (!entries || !entries.length) {
      return '<p class="muted">Pas encore de bump de version enregistré.</p>';
    }
    return entries.map(e => {
      const titleClean = e.subject.replace(/^(?:v|Bump\s+)[0-9.]+\s*[:\-—]?\s*/i, '');
      return `
        <article class="changelog-entry">
          <header>
            <span class="changelog-version">v${escapeHtml(e.version)}</span>
            <span class="changelog-date">${escapeHtml(e.date)}</span>
          </header>
          <h3>${escapeHtml(titleClean) || '(sans titre)'}</h3>
        </article>
      `;
    }).join('');
  }

  // Tente d'abord l'API live, puis le fichier statique généré au build pour
  // que le mode Pages affiche aussi l'historique.
  async function fetchChangelog() {
    try {
      const r = await fetch('/api/changelog', { cache: 'no-store' });
      if (r.ok) return await r.json();
    } catch (_) { /* on essaie le fallback */ }
    try {
      const r = await fetch('data/changelog.json', { cache: 'no-store' });
      if (r.ok) return await r.json();
    } catch (_) { /* tant pis */ }
    return null;
  }

  function openChangelog() {
    ensureDialog();
    dialog.showModal();
    if (loaded) return;
    fetchChangelog().then(j => {
      const body = document.getElementById('changelog-body');
      if (!body) return;
      if (!j) {
        body.innerHTML = '<p class="muted">Historique indisponible.</p>';
        return;
      }
      body.innerHTML = renderEntries(j.entries);
      loaded = true;
    });
  }
})();
