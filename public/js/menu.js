// Menu « Actions » de la barre du haut : regroupe les liens secondaires
// (livret, tutoriel, connexion/compte/déconnexion) pour ne pas surcharger
// l'écran. Accessible : clavier (Échap, flèches), clic extérieur, ARIA.

(function () {
  const btn = document.getElementById('menu-btn');
  const dd = document.getElementById('menu-dropdown');
  if (!btn || !dd) return;

  function items() {
    return Array.from(dd.querySelectorAll('[role="menuitem"]')).filter(el => !el.hidden);
  }

  function open() {
    dd.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onDoc, true);
    document.addEventListener('keydown', onKey);
  }
  function close(focusBtn) {
    dd.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDoc, true);
    document.removeEventListener('keydown', onKey);
    if (focusBtn) btn.focus();
  }
  function isOpen() { return !dd.hidden; }

  function onDoc(e) {
    if (!dd.contains(e.target) && e.target !== btn) close(false);
  }
  function onKey(e) {
    if (e.key === 'Escape') { close(true); return; }
    const list = items();
    if (!list.length) return;
    const idx = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(idx + 1 + list.length) % list.length].focus(); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); list[(idx - 1 + list.length) % list.length].focus(); }
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isOpen()) { close(false); }
    else { open(); const l = items(); if (l[0]) setTimeout(() => l[0].focus(), 0); }
  });

  // Un clic sur un item ferme le menu (les liens naviguent, le logout recharge).
  dd.addEventListener('click', (e) => {
    if (e.target.closest('[role="menuitem"]')) close(false);
  });
})();
