// Affiche la version du programme dans tous les <span data-version> de la page.
// Source : GET /api/version, basé sur package.json.
(function () {
  const slots = document.querySelectorAll('[data-version]');
  if (!slots.length) return;
  fetch('/api/version', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : null)
    .then(j => {
      if (!j || !j.version) return;
      const label = `v${j.version}`;
      slots.forEach(el => { el.textContent = label; el.title = `${j.name} ${label}`; });
    })
    .catch(() => { /* serveur indispo, on laisse vide */ });
})();
