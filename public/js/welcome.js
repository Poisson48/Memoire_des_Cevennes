// Modal d'accueil — s'ouvre une fois au premier visit (et à chaque visit
// tant que l'utilisateur n'a pas coché "ne plus afficher"). Contenu
// markdown récupéré via /api/welcome (route publique).
//
// Persistance du choix : localStorage (clé `mdc-welcome-dismissed`).
// On évite les cookies pour ce flag — pas besoin de bandeau RGPD pour
// du localStorage de préférence d'affichage. Les cookies de session
// (auth) sont strictement nécessaires et exemptés du consentement.

(function () {
  'use strict';

  const STORAGE_KEY = 'mdc-welcome-dismissed';
  const dialog   = document.getElementById('welcome-dialog');
  const contentEl = document.getElementById('welcome-content');
  const dontShow = document.getElementById('welcome-dontshow');
  if (!dialog || !contentEl || !dontShow) return;

  // Si l'utilisateur a déjà coché la case lors d'une visite précédente,
  // on ne charge même pas le contenu — moins de réseau.
  if (localStorage.getItem(STORAGE_KEY) === '1') return;

  fetch('/api/welcome', { credentials: 'same-origin' })
    .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status)))
    .then(data => {
      const md = (data && typeof data.content === 'string') ? data.content : '';
      contentEl.innerHTML = window.MdcMarkdown
        ? window.MdcMarkdown.render(md)
        : `<pre>${(md || '').replace(/[<&>]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre>`;
      // Petit délai après rendu pour que la transition CSS s'enclenche.
      try { dialog.showModal(); }
      catch { dialog.setAttribute('open', ''); }
    })
    .catch(err => {
      // Silencieux : si le contenu n'est pas accessible, on laisse
      // l'utilisateur arriver directement sur la carte.
      console.warn('[welcome] contenu inaccessible :', err.message);
    });

  // À la fermeture, on enregistre le choix si la case est cochée.
  dialog.addEventListener('close', () => {
    if (dontShow.checked) {
      try { localStorage.setItem(STORAGE_KEY, '1'); }
      catch { /* localStorage indispo (mode privé strict) — tant pis */ }
    }
  });

  // Permettre de cliquer en dehors du contenu pour fermer (ergonomie).
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      // Click sur le backdrop, hors du content
      dialog.close('backdrop');
    }
  });
})();
