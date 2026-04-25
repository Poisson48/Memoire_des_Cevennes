// Mémoire des Cévennes — mentions inline @nom dans les textareas
//
// Comportement : sur tout textarea marqué `data-mentions="on"`, taper @
// suivi de lettres ouvre un popover de suggestions (personnes, lieux,
// alias) issues de /api/resolve. ↑↓ navigue, ⏎ ou clic sélectionne.
// La sélection :
//   1. remplace `@requete` par le `primaryName` choisi,
//   2. ajoute { start, end, type, entityId } à un store local sur le textarea,
//      lu au moment de l'envoi du formulaire (forms.js l'injecte dans le payload).
//
// Architecture : un seul popover global réutilisé pour tous les textareas.
// Pas de bibliothèque externe — vanilla DOM.

(function () {
  if (!document.body) return;

  const POPOVER_ID = 'mention-popover';
  const DEBOUNCE_MS = 150;
  const MIN_CHARS = 1;
  const MAX_RESULTS = 6;

  // ── Popover global ──
  let popover = document.getElementById(POPOVER_ID);
  if (!popover) {
    popover = document.createElement('div');
    popover.id = POPOVER_ID;
    popover.className = 'mention-popover';
    popover.hidden = true;
    document.body.appendChild(popover);
  }

  // ── État courant ──
  let activeTextarea = null;
  let activeAt       = -1;     // index du @ dans le textarea
  let activeQuery    = '';
  let activeResults  = [];
  let activeIndex    = 0;
  let debounceTimer  = null;
  let searchAbort    = null;

  // ── Lecture / écriture du store de mentions ──
  // On stocke les mentions dans textarea.dataset.mentions (JSON).
  function getMentions(ta) {
    try { return JSON.parse(ta.dataset.mentions || '[]'); }
    catch { return []; }
  }
  function setMentions(ta, list) {
    ta.dataset.mentions = JSON.stringify(list);
  }

  // ── Détection : sommes-nous en train de taper @… ? ──
  function detectAt(ta) {
    const pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) return null;          // sélection en cours
    const text = ta.value;
    let i = pos - 1;
    // Remonte tant qu'on est sur des chars admissibles dans une mention.
    while (i >= 0) {
      const c = text[i];
      if (c === '@') {
        // Vérifie que le @ est en début, après espace, saut de ligne, ponctuation.
        const prev = text[i - 1];
        if (i === 0 || /\s|[(\[«"',.;:!?]/.test(prev)) {
          return { atIndex: i, query: text.slice(i + 1, pos) };
        }
        return null;
      }
      // Caractères admis dans la requête : lettres (y compris accentuées), tirets, espaces (limités), apostrophes
      if (!/[\p{L}\p{M}\d\- '’]/u.test(c)) return null;
      // Limite à ~24 caractères depuis le @ pour éviter de scanner toute la ligne.
      if (pos - i > 24) return null;
      i--;
    }
    return null;
  }

  // ── Recherche débounced ──
  function search(query) {
    clearTimeout(debounceTimer);
    if (query.length < MIN_CHARS) {
      hidePopover();
      return;
    }
    debounceTimer = setTimeout(async () => {
      if (searchAbort) searchAbort.abort();
      searchAbort = new AbortController();
      try {
        const url = '/api/resolve?q=' + encodeURIComponent(query) + '&limit=' + MAX_RESULTS;
        const res = await fetch(url, { signal: searchAbort.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const j = await res.json();
        activeResults = (j.results || []).slice(0, MAX_RESULTS);
        activeIndex   = 0;
        renderPopover();
      } catch (err) {
        if (err.name === 'AbortError') return;
        // En mode statique (GitHub Pages), /api/resolve n'existe pas — on cache
        // simplement le popover.
        hidePopover();
      }
    }, DEBOUNCE_MS);
  }

  // ── Rendu du popover ──
  function renderPopover() {
    if (!activeTextarea || !activeResults.length) {
      hidePopover();
      return;
    }
    popover.innerHTML = activeResults.map((r, i) => {
      const icon = r.type === 'person' ? '👤' : '📍';
      const ctxParts = [];
      if (r.source && r.source !== 'primary' && r.matched && r.matched !== r.name) {
        ctxParts.push(`alias : ${r.matched}`);
      }
      const ctx = ctxParts.length ? ` <span class="mention-ctx">${escapeHtml(ctxParts.join(' · '))}</span>` : '';
      return `<div class="mention-item${i === activeIndex ? ' active' : ''}" data-i="${i}">
        ${icon} <strong>${escapeHtml(r.name || '?')}</strong>${ctx}
      </div>`;
    }).join('');
    popover.hidden = false;

    // Position : sous le textarea actif, aligné à gauche.
    const r = activeTextarea.getBoundingClientRect();
    popover.style.top  = (window.scrollY + r.bottom + 4) + 'px';
    popover.style.left = (window.scrollX + r.left) + 'px';
    popover.style.minWidth = Math.min(r.width, 320) + 'px';

    // Branchements clic
    popover.querySelectorAll('.mention-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        // mousedown plutôt que click : sinon le focus quitte le textarea avant.
        e.preventDefault();
        const idx = parseInt(el.dataset.i, 10);
        pick(idx);
      });
    });
  }

  function hidePopover() {
    popover.hidden = true;
    activeResults = [];
    activeIndex   = 0;
  }

  // ── Sélection d'un résultat ──
  function pick(idx) {
    if (!activeTextarea) return;
    const r = activeResults[idx];
    if (!r) return;
    const ta = activeTextarea;
    const before = ta.value.slice(0, activeAt);
    const after  = ta.value.slice(ta.selectionStart);
    const inserted = r.name || '';
    ta.value = before + inserted + after;
    const newCaret = activeAt + inserted.length;
    ta.selectionStart = ta.selectionEnd = newCaret;

    // Enregistre la mention { start, end, type, entityId }
    const mentions = getMentions(ta);
    mentions.push({
      start:    activeAt,
      end:      activeAt + inserted.length,
      type:     r.type,
      entityId: r.id,
    });
    setMentions(ta, mentions);

    hidePopover();
    activeAt = -1;
    activeQuery = '';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
  }

  // ── Hooks textarea ──
  function onInput(e) {
    const ta = e.target;
    if (!ta.matches || !ta.matches('textarea[data-mentions="on"]')) return;
    activeTextarea = ta;
    const detect = detectAt(ta);
    if (!detect) {
      hidePopover();
      activeAt = -1;
      return;
    }
    activeAt = detect.atIndex;
    activeQuery = detect.query;
    search(detect.query);
  }

  function onKeyDown(e) {
    if (popover.hidden) return;
    const ta = e.target;
    if (!ta.matches || !ta.matches('textarea[data-mentions="on"]')) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % activeResults.length;
      renderPopover();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + activeResults.length) % activeResults.length;
      renderPopover();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (activeResults.length) {
        e.preventDefault();
        pick(activeIndex);
      }
    } else if (e.key === 'Escape') {
      hidePopover();
    }
  }

  function onBlur(e) {
    // mousedown sur popover préemptait déjà — ce blur est juste un nettoyage.
    setTimeout(hidePopover, 120);
  }

  // ── Délégation événements ──
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('blur', onBlur, true);

  // ── Helpers ──
  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }
})();
