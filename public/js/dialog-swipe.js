/* Swipe-to-dismiss générique pour <dialog> et le panneau bottom-sheet
   (#panel). Sur écrans tactiles, on tire vers le bas depuis le haut de
   la fenêtre pour la fermer.

   On démarre un drag uniquement quand le toucher commence dans la zone
   « poignée » en haut de l'élément ET que le contenu est scrollé tout
   en haut, pour ne pas entrer en conflit avec le scroll interne. */
(function () {
  'use strict';

  const HANDLE_ZONE_PX = 64;       // zone du haut qui déclenche le drag
  const CLOSE_THRESHOLD_PX = 110;  // distance qui déclenche la fermeture
  const ACTIVATION_PX = 6;         // mini déplacement avant de drag pour de vrai
  const CLOSE_ANIM_MS = 240;

  function isCoarsePointer() {
    return window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  }

  function attachSwipe(el, opts) {
    if (el.dataset.swipeBound === '1') return;
    el.dataset.swipeBound = '1';

    const isOpen = opts.isOpen;
    const onClose = opts.onClose;

    let startY = 0;
    let lastY = 0;
    let active = false;
    let dragging = false;

    function resetStyles() {
      el.style.transform = '';
      el.style.opacity = '';
      el.classList.remove('is-swiping');
    }

    el.addEventListener('touchstart', (e) => {
      if (!isCoarsePointer()) return;
      if (!isOpen()) return;
      if (e.touches.length !== 1) return;
      if (el.scrollTop > 0) return;
      const t = e.touches[0];
      const rect = el.getBoundingClientRect();
      if (t.clientY - rect.top > HANDLE_ZONE_PX) return;
      startY = t.clientY;
      lastY = startY;
      active = true;
      dragging = false;
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      if (!active) return;
      lastY = e.touches[0].clientY;
      const dy = lastY - startY;
      if (dy <= 0) {
        if (dragging) {
          el.style.transform = '';
          el.style.opacity = '';
          el.classList.remove('is-swiping');
          dragging = false;
        }
        return;
      }
      if (!dragging && dy < ACTIVATION_PX) return;
      dragging = true;
      el.classList.add('is-swiping');
      el.style.transform = 'translateY(' + dy + 'px)';
      el.style.opacity = String(Math.max(0.3, 1 - dy / 500));
    }, { passive: true });

    function finish() {
      if (!active) return;
      const dy = lastY - startY;
      el.classList.remove('is-swiping');
      if (dragging && dy > CLOSE_THRESHOLD_PX) {
        // Glissement vers le bas, hors écran, pour rendre la sortie fluide
        const target = Math.max(window.innerHeight, dy + 200);
        el.style.transform = 'translateY(' + target + 'px)';
        el.style.opacity = '0';
        setTimeout(() => {
          resetStyles();
          onClose();
        }, CLOSE_ANIM_MS);
        active = false;
        dragging = false;
        return;
      }
      resetStyles();
      active = false;
      dragging = false;
    }

    el.addEventListener('touchend', finish);
    el.addEventListener('touchcancel', finish);
  }

  function setup() {
    // 1) Toutes les <dialog>
    document.querySelectorAll('dialog').forEach((d) => {
      attachSwipe(d, {
        isOpen: () => d.open,
        onClose: () => d.close('cancel'),
      });
    });
    // 2) Le panneau bottom-sheet (#panel) sur index.html
    const panel = document.getElementById('panel');
    const panelClose = document.getElementById('panel-close');
    if (panel && panelClose) {
      attachSwipe(panel, {
        isOpen: () => panel.getAttribute('aria-hidden') === 'false',
        onClose: () => panelClose.click(),
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
