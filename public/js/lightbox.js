// Lightbox media partagée par le site public et la page admin.
// Une <img data-lightbox-media> est cliquable et ouvre l'image en grand
// dans un <dialog>. La lightbox cycle ensuite à travers TOUS les médias
// (images, vidéos, extraits audio) marqués data-lightbox-media dans le
// même conteneur [data-lightbox-group].
//
// Vidéos et audio restent jouables inline avec leurs contrôles natifs ;
// la lightbox les rend en grand format pendant la navigation, mais on
// ne piège pas les clics sur les contrôles natifs (sinon impossible de
// faire play/pause sans ouvrir la lightbox).
//
// Sécurité : les attributs (src, caption) sont déjà échappés en amont
// par escapeAttr/escapeHtml. La lightbox les passe en .src et
// .textContent, jamais en innerHTML utilisateur.
(function () {
  'use strict';

  function build() {
    const dlg = document.createElement('dialog');
    dlg.id = 'lightbox';
    dlg.className = 'lightbox';
    dlg.innerHTML = `
      <button type="button" class="lb-close" aria-label="Fermer">✕</button>
      <button type="button" class="lb-prev"  aria-label="Précédent">‹</button>
      <button type="button" class="lb-next"  aria-label="Suivant">›</button>
      <figure class="lb-figure">
        <div class="lb-stage"></div>
        <figcaption class="lb-caption"></figcaption>
      </figure>
      <div class="lb-counter" aria-live="polite"></div>
    `;
    document.body.appendChild(dlg);
    return dlg;
  }

  let dlg, stageEl, capEl, counterEl, prevBtn, nextBtn, closeBtn;
  let group = [];   // [{ kind, src, caption }]
  let idx = 0;

  function init() {
    if (dlg) return;
    dlg = build();
    stageEl   = dlg.querySelector('.lb-stage');
    capEl     = dlg.querySelector('.lb-caption');
    counterEl = dlg.querySelector('.lb-counter');
    prevBtn   = dlg.querySelector('.lb-prev');
    nextBtn   = dlg.querySelector('.lb-next');
    closeBtn  = dlg.querySelector('.lb-close');

    prevBtn.addEventListener('click', (e) => { e.stopPropagation(); show(idx - 1); });
    nextBtn.addEventListener('click', (e) => { e.stopPropagation(); show(idx + 1); });
    closeBtn.addEventListener('click', () => dlg.close());

    // Clic sur le backdrop (zone vide) ferme. Clic sur le média ne ferme pas.
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });

    // Stoppe la lecture audio/vidéo quand on ferme la lightbox.
    dlg.addEventListener('close', () => {
      stageEl.innerHTML = '';
    });

    // Navigation clavier.
    dlg.addEventListener('keydown', (e) => {
      if (group.length <= 1) return;
      if (e.key === 'ArrowLeft')  { e.preventDefault(); show(idx - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); show(idx + 1); }
    });

    // Swipe horizontal sur tactile, mais hors zone des contrôles d'un
    // <video>/<audio> (sinon glisser sur la barre de progression
    // changerait d'image au lieu de scrubber). On ne réagit qu'aux
    // touches qui partent de l'image ou du backdrop.
    let touchX = null, touchY = null, touchOnControl = false;
    dlg.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      touchOnControl = !!(e.target.closest('video, audio'));
      touchX = e.touches[0].clientX;
      touchY = e.touches[0].clientY;
    }, { passive: true });
    dlg.addEventListener('touchend', (e) => {
      if (touchX === null || group.length <= 1 || touchOnControl) {
        touchX = touchY = null;
        return;
      }
      const t = e.changedTouches[0];
      const dx = t.clientX - touchX;
      const dy = t.clientY - touchY;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        show(dx > 0 ? idx - 1 : idx + 1);
      }
      touchX = touchY = null;
    });
  }

  function renderStage(item) {
    stageEl.innerHTML = '';
    let el;
    if (item.kind === 'image') {
      el = document.createElement('img');
      el.className = 'lb-media lb-img';
      el.alt = item.caption || '';
      el.src = item.src;
    } else if (item.kind === 'video') {
      el = document.createElement('video');
      el.className = 'lb-media lb-video';
      el.controls = true;
      el.preload = 'metadata';
      el.src = item.src;
      // playsinline : sur iOS, sinon Safari ouvre son player plein écran
      // et masque la lightbox.
      el.setAttribute('playsinline', '');
    } else if (item.kind === 'audio') {
      el = document.createElement('audio');
      el.className = 'lb-media lb-audio';
      el.controls = true;
      el.preload = 'metadata';
      el.src = item.src;
    } else {
      el = document.createElement('a');
      el.className = 'lb-media lb-link';
      el.href = item.src;
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
      el.textContent = 'Ouvrir le document';
    }
    stageEl.appendChild(el);
  }

  function show(i) {
    if (!group.length) return;
    idx = (i + group.length) % group.length;
    const it = group[idx];
    renderStage(it);
    capEl.textContent = it.caption || '';
    capEl.hidden = !it.caption;
    counterEl.textContent = group.length > 1 ? `${idx + 1} / ${group.length}` : '';
    counterEl.hidden = group.length <= 1;
    prevBtn.hidden = group.length <= 1;
    nextBtn.hidden = group.length <= 1;
  }

  function kindOf(el) {
    if (el.tagName === 'IMG')   return 'image';
    if (el.tagName === 'VIDEO') return 'video';
    if (el.tagName === 'AUDIO') return 'audio';
    return 'other';
  }

  function openFor(targetEl) {
    init();
    const groupEl = targetEl.closest('[data-lightbox-group]');
    const items = groupEl
      ? Array.from(groupEl.querySelectorAll('[data-lightbox-media]'))
      : [targetEl];
    group = items.map(el => ({
      kind: kindOf(el),
      src: el.dataset.fullSrc || el.currentSrc || el.src || el.getAttribute('src'),
      caption: el.dataset.caption || el.getAttribute('alt') || '',
    }));
    const startIdx = items.indexOf(targetEl);
    show(Math.max(0, startIdx));
    if (typeof dlg.showModal === 'function') {
      dlg.showModal();
    } else {
      dlg.setAttribute('open', '');
    }
  }

  // Délégation : un clic sur une <img data-lightbox-media> ouvre la
  // lightbox. Les <video>/<audio> ne sont PAS pris en compte ici (sinon
  // impossible d'utiliser leurs contrôles natifs). Pour les ouvrir en
  // grand, l'UI affiche un petit bouton ↗ à côté de chaque clip.
  document.addEventListener('click', (e) => {
    // Bouton "↗ agrandir" à côté d'un clip vidéo/audio.
    const expandBtn = e.target.closest('button.lb-expand[data-lightbox-target]');
    if (expandBtn) {
      const id = expandBtn.dataset.lightboxTarget;
      const target = document.getElementById(id);
      if (target) {
        e.preventDefault();
        openFor(target);
      }
      return;
    }
    // Image plain : un clic ouvre la lightbox.
    const img = e.target.closest('img[data-lightbox-media]');
    if (img) {
      e.preventDefault();
      openFor(img);
    }
  });
})();
