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
// Zoom :
//  - PC : molette de souris sur l'image
//  - Mobile : pinch à 2 doigts (le zoom est confiné à l'image, pas à la
//             page entière : `touch-action: none` sur la dialog bloque
//             le pinch-zoom navigateur)
//  - Quand zoomé, un drag à un doigt panne l'image
//  - Double-tap / double-clic = reset zoom
//  - Le swipe horizontal entre médias est désactivé tant que zoom > 1
//
// Sécurité : les attributs (src, caption) sont déjà échappés en amont
// par escapeAttr/escapeHtml. La lightbox les passe en .src et
// .textContent, jamais en innerHTML utilisateur.
(function () {
  'use strict';

  const ZOOM_MIN = 1;
  const ZOOM_MAX = 5;
  const ZOOM_STEP_WHEEL = 0.0015;  // sensibilité molette (px de delta → ratio)
  const DOUBLE_TAP_MS = 300;

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

  // État de zoom/pan de l'image courante.
  let zoom = 1;
  let tx = 0, ty = 0;

  function applyTransform() {
    const img = stageEl.querySelector('img.lb-img');
    if (!img) return;
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${zoom})`;
    img.classList.toggle('zoomed', zoom > 1);
  }

  function resetZoom() {
    zoom = 1;
    tx = 0;
    ty = 0;
    applyTransform();
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

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

    // Stoppe la lecture audio/vidéo et reset le zoom à la fermeture.
    dlg.addEventListener('close', () => {
      stageEl.innerHTML = '';
      resetZoom();
    });

    // Navigation clavier.
    dlg.addEventListener('keydown', (e) => {
      // ESC en mode zoom : dézoome d'abord, un second ESC ferme. Plus
      // prévisible que de fermer direct quand on inspecte un détail.
      if (e.key === 'Escape' && zoom > 1) {
        e.preventDefault();
        resetZoom();
        return;
      }
      // Touche 0 (et numpad) : reset zoom comme dans les visionneuses.
      if (e.key === '0' && zoom > 1) {
        e.preventDefault();
        resetZoom();
        return;
      }
      if (group.length <= 1) return;
      // Flèches : nav entre médias seulement si non zoomé.
      if (zoom > 1) return;
      if (e.key === 'ArrowLeft')  { e.preventDefault(); show(idx - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); show(idx + 1); }
    });

    // ── Tactile : swipe horizontal entre médias + pinch-zoom + pan ──
    // On gère tout en bas niveau pour pouvoir bloquer le pinch-zoom
    // navigateur et faire le zoom uniquement sur l'image.
    let touchStart = null;        // { x, y } pour swipe à 1 doigt
    let touchOnControl = false;
    let pinchStart = null;        // { dist, scale, cx, cy }
    let panStart = null;          // { x, y, tx, ty }
    let lastTap = 0;

    function distBetween(a, b) {
      const dx = a.clientX - b.clientX;
      const dy = a.clientY - b.clientY;
      return Math.hypot(dx, dy);
    }

    dlg.addEventListener('touchstart', (e) => {
      // Geste sur les contrôles natifs d'un clip : on ne s'en mêle pas.
      touchOnControl = !!(e.target.closest('video, audio'));
      if (touchOnControl) return;

      if (e.touches.length === 2) {
        // Début d'un pinch-zoom.
        pinchStart = {
          dist: distBetween(e.touches[0], e.touches[1]),
          scale: zoom,
        };
        touchStart = null;
        panStart = null;
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        if (zoom > 1) {
          // Pan d'image quand on est zoomé.
          panStart = { x: t.clientX, y: t.clientY, tx, ty };
          touchStart = null;
        } else {
          // Swipe potentiel entre médias.
          touchStart = { x: t.clientX, y: t.clientY };
          panStart = null;
        }
      }
    }, { passive: true });

    dlg.addEventListener('touchmove', (e) => {
      if (touchOnControl) return;

      if (e.touches.length === 2 && pinchStart) {
        // Pinch en cours : on calcule le nouveau facteur d'échelle.
        e.preventDefault();
        const d = distBetween(e.touches[0], e.touches[1]);
        zoom = clamp(pinchStart.scale * (d / pinchStart.dist), ZOOM_MIN, ZOOM_MAX);
        applyTransform();
      } else if (e.touches.length === 1 && panStart && zoom > 1) {
        // Pan en mode zoom : on déplace l'image.
        e.preventDefault();
        const t = e.touches[0];
        tx = panStart.tx + (t.clientX - panStart.x);
        ty = panStart.ty + (t.clientY - panStart.y);
        applyTransform();
      }
    }, { passive: false });

    dlg.addEventListener('touchend', (e) => {
      if (touchOnControl) {
        touchOnControl = false;
        return;
      }
      // Fin d'un pinch.
      if (pinchStart && e.touches.length < 2) {
        pinchStart = null;
        // Si on est revenu sous 1, force reset clean.
        if (zoom < 1.05) resetZoom();
      }
      // Fin d'un pan.
      if (panStart && e.touches.length === 0) {
        panStart = null;
      }
      // Swipe entre médias (uniquement si non zoomé, à 1 doigt, pas un pinch en cours).
      if (touchStart && e.touches.length === 0 && zoom <= 1 && group.length > 1) {
        const t = e.changedTouches[0];
        const dx = t.clientX - touchStart.x;
        const dy = t.clientY - touchStart.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
          show(dx > 0 ? idx - 1 : idx + 1);
        }
      }
      touchStart = null;

      // Détecter double-tap pour reset zoom.
      if (e.touches.length === 0) {
        const now = Date.now();
        if (now - lastTap < DOUBLE_TAP_MS) {
          // Double-tap : si zoomé → reset, sinon → zoom 2x sur le point.
          if (zoom > 1) {
            resetZoom();
          } else {
            zoom = 2;
            applyTransform();
          }
          lastTap = 0;
        } else {
          lastTap = now;
        }
      }
    });

    // ── Souris : molette = zoom, drag = pan quand zoomé ──
    stageEl.addEventListener('wheel', (e) => {
      if (!stageEl.querySelector('img.lb-img')) return;
      e.preventDefault();
      const before = zoom;
      zoom = clamp(zoom * (1 - e.deltaY * ZOOM_STEP_WHEEL), ZOOM_MIN, ZOOM_MAX);
      if (zoom <= 1.02) resetZoom();
      else if (zoom !== before) applyTransform();
    }, { passive: false });

    // Drag souris quand zoomé.
    let mouseDown = null;
    stageEl.addEventListener('mousedown', (e) => {
      if (zoom <= 1) return;
      if (e.button !== 0) return;
      mouseDown = { x: e.clientX, y: e.clientY, tx, ty };
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!mouseDown) return;
      tx = mouseDown.tx + (e.clientX - mouseDown.x);
      ty = mouseDown.ty + (e.clientY - mouseDown.y);
      applyTransform();
    });
    window.addEventListener('mouseup', () => { mouseDown = null; });

    // Double-clic souris = toggle zoom.
    stageEl.addEventListener('dblclick', (e) => {
      const img = stageEl.querySelector('img.lb-img');
      if (!img) return;
      e.preventDefault();
      if (zoom > 1) resetZoom();
      else { zoom = 2; applyTransform(); }
    });
  }

  function renderStage(item) {
    stageEl.innerHTML = '';
    resetZoom();
    let el;
    if (item.kind === 'image') {
      el = document.createElement('img');
      el.className = 'lb-media lb-img';
      el.alt = item.caption || '';
      el.src = item.src;
      el.draggable = false;
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
    const img = e.target.closest('img[data-lightbox-media]');
    if (img) {
      e.preventDefault();
      openFor(img);
    }
  });
})();
