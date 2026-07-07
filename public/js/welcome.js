// Modal d'accueil : s'ouvre à chaque visite. Contenu markdown récupéré
// via /api/welcome (route publique). Pas de mémorisation, simplicité
// volontaire pour les vieilles personnes : le message s'affiche toujours.

(function () {
  'use strict';

  const dialog   = document.getElementById('welcome-dialog');
  const contentEl = document.getElementById('welcome-content');
  if (!dialog || !contentEl) return;

  // État de connexion, en parallèle du contenu (best-effort : si l'API ne
  // répond pas, on considère l'utilisateur non connecté).
  const mePromise = fetch('/api/auth/me', { credentials: 'include' })
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);

  fetch('/api/welcome', { credentials: 'same-origin' })
    .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status)))
    .then(async (data) => {
      const md = (data && typeof data.content === 'string') ? data.content : '';
      contentEl.innerHTML = window.MdcMarkdown
        ? window.MdcMarkdown.render(md)
        : `<pre>${(md || '').replace(/[<&>]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre>`;

      // Déjà connecté : ne plus proposer de créer un compte membre. On retire
      // le bloc (paragraphe / puce) qui pointe vers l'inscription.
      const me = await mePromise;
      if (me && me.member) {
        contentEl.querySelectorAll('a[href*="register"]').forEach(a => {
          const block = a.closest('li, p');
          if (block && block !== contentEl) block.remove();
          else a.remove();
        });
      }

      try { dialog.showModal(); }
      catch { dialog.setAttribute('open', ''); }

      // Le focus par défaut doit être sur « Continuer » (et non sur le lien
      // tutoriel), pour que la touche Entrée ferme simplement l'accueil.
      const cont = dialog.querySelector('.welcome-actions .btn-primary');
      if (cont) { try { cont.focus(); } catch {} }
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
