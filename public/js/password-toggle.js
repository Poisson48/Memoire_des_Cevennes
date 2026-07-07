// Ajoute un bouton « 👁 Voir / 🙈 Masquer » à chaque champ mot de passe de la
// page. But : éviter les fautes de frappe invisibles, surtout à la création ou
// à l'activation d'un compte (une coquille et le mot de passe choisi devient
// introuvable). Aucune dépendance, s'auto-branche au chargement.
(function () {
  'use strict';

  function enhance(input) {
    if (input.dataset.pwToggle) return;
    input.dataset.pwToggle = '1';

    // On enveloppe le champ pour pouvoir poser le bouton par-dessus, sans
    // casser la mise en page en colonne du <label> (texte / champ / hint).
    const wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-toggle';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', 'Afficher le mot de passe');
    btn.textContent = '👁 Voir';
    wrap.appendChild(btn);

    btn.addEventListener('click', () => {
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      btn.textContent = reveal ? '🙈 Masquer' : '👁 Voir';
      btn.setAttribute('aria-pressed', reveal ? 'true' : 'false');
      btn.setAttribute('aria-label', reveal ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
      // On rend la main au champ pour ne pas casser la saisie en cours.
      input.focus();
    });
  }

  function init() {
    document.querySelectorAll('input[type="password"]').forEach(enhance);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
