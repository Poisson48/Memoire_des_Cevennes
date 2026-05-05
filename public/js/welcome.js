// Modal d'accueil : s'ouvre à chaque visite. Contenu markdown récupéré
// via /api/welcome (route publique). Pas de mémorisation, simplicité
// volontaire pour les vieilles personnes : le message s'affiche toujours.

(function () {
  'use strict';

  const dialog   = document.getElementById('welcome-dialog');
  const contentEl = document.getElementById('welcome-content');
  if (!dialog || !contentEl) return;

  fetch('/api/welcome', { credentials: 'same-origin' })
    .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status)))
    .then(data => {
      const md = (data && typeof data.content === 'string') ? data.content : '';
      contentEl.innerHTML = window.MdcMarkdown
        ? window.MdcMarkdown.render(md)
        : `<pre>${(md || '').replace(/[<&>]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre>`;
      try { dialog.showModal(); }
      catch { dialog.setAttribute('open', ''); }
    })
    .catch(err => {
      // Silencieux : si le contenu n'est pas accessible, on laisse
      // l'utilisateur arriver directement sur la carte.
      console.warn('[welcome] contenu inaccessible :', err.message);
    });

  // Permettre de cliquer en dehors du contenu pour fermer (ergonomie).
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      dialog.close('backdrop');
    }
  });
})();
