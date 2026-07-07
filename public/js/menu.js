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

  // Sur téléphone, le bouton ☰ peut se retrouver ailleurs qu'au bord droit
  // (barre du haut en 3 zones). Un dropdown ancré `right:0` déborderait alors
  // hors de l'écran et se ferait rogner. On l'ancre donc au viewport, juste
  // sous le bouton, avec des marges : jamais coupé, quelle que soit la mise en
  // page. Sur écran large, on laisse le positionnement CSS d'origine.
  function placeForViewport() {
    const narrow = window.matchMedia('(max-width: 600px)').matches;
    if (!narrow) { clearInlinePosition(); return; }
    const r = btn.getBoundingClientRect();
    const margin = 8;
    dd.style.position = 'fixed';
    dd.style.top = (r.bottom + 6) + 'px';
    dd.style.left = margin + 'px';
    dd.style.right = margin + 'px';
    dd.style.width = 'auto';
    dd.style.minWidth = '0';
    dd.style.maxHeight = 'calc(100vh - ' + (r.bottom + 6 + margin) + 'px)';
    dd.style.overflowY = 'auto';
  }
  function clearInlinePosition() {
    for (const p of ['position', 'top', 'left', 'right', 'width', 'minWidth', 'maxHeight', 'overflowY']) {
      dd.style[p] = '';
    }
  }

  function open() {
    dd.hidden = false;
    placeForViewport();
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onDoc, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', placeForViewport);
  }
  function close(focusBtn) {
    dd.hidden = true;
    clearInlinePosition();
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDoc, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', placeForViewport);
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
