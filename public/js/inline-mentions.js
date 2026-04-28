// Mémoire des Cévennes — mentions inline @nom dans les textareas
//
// Comportement : sur tout textarea marqué `data-mentions="on"`, taper @
// suivi de lettres ouvre un popover de suggestions (personnes, lieux,
// alias) issues de /api/resolve. ↑↓ navigue, ⏎ ou clic sélectionne.
// La sélection :
//   1. CONSERVE le texte tapé par l'utilisateur (ex. "Doucette" reste "Doucette",
//      même si l'entité s'appelle Joséphine). Une exception : si la requête
//      est une troncature préfixe du primaryName (ex. "@jo" → Joséphine),
//      on remplace par le primaryName, parce que c'est clairement une saisie
//      raccourcie et pas un surnom volontaire.
//   2. Ajoute { start, end, type, entityId } à un store local sur le textarea,
//      lu au moment de l'envoi du formulaire (forms.js l'injecte dans le payload).
//   3. Si le texte tapé n'est ni le primaryName, ni un alias existant, ni un
//      préfixe trivial, on POSTe en arrière-plan une proposition d'ajout
//      d'alias (passe par la file de modération).
//
// Le popover affiche un descripteur de désambiguïsation (filiation / conjoint·e
// / dates) pour distinguer plusieurs personnes au même prénom.
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
        // Toujours proposer un item "Créer cette personne" en dernier (sauf si
        // un nom matche déjà exactement, auquel cas la création serait un
        // doublon évident). On laisse l'utilisateur juger sinon.
        if (canCreateAsPerson(query)) {
          activeResults.push({ kind: 'create-person', label: prettifyName(query) });
        }
        renderPopover();
      } catch (err) {
        if (err.name === 'AbortError') return;
        // En mode statique (GitHub Pages), /api/resolve n'existe pas, on cache
        // simplement le popover.
        hidePopover();
      }
    }, DEBOUNCE_MS);
  }

  // Capitalise simplement la première lettre de chaque mot. On n'invente pas
  // d'accent ; l'utilisateur ou l'admin pourra corriger ensuite via la fiche.
  function prettifyName(s) {
    return String(s || '').trim().replace(/\s+/g, ' ').replace(/(^|[\s\-'’])(\p{L})/gu,
      (_, sep, letter) => sep + letter.toUpperCase());
  }

  // On propose la création seulement si la requête fait au moins 2 caractères
  // (évite le bruit) et n'a pas déjà un match exact dans les résultats.
  function canCreateAsPerson(query) {
    const q = String(query || '').trim();
    if (q.length < 2) return false;
    const qn = norm(q);
    return !activeResults.some(r => norm(r.name) === qn);
  }

  // ── Rendu du popover ──
  function renderPopover() {
    if (!activeTextarea || !activeResults.length) {
      hidePopover();
      return;
    }
    popover.innerHTML = activeResults.map((r, i) => {
      const cls = `mention-item${i === activeIndex ? ' active' : ''}`;
      if (r.kind === 'create-person') {
        return `<div class="${cls} mention-create" data-i="${i}">
          ➕ <strong>Créer la personne « ${escapeHtml(r.label)} »</strong>
          <span class="mention-ctx">(en attente de validation)</span>
        </div>`;
      }
      const icon = r.type === 'person' ? '👤' : '📍';
      const ctxParts = [];
      if (r.descriptor) ctxParts.push(r.descriptor);
      if (r.source && r.source !== 'primary' && r.matched && r.matched !== r.name) {
        ctxParts.push(`alias : ${r.matched}`);
      }
      const ctx = ctxParts.length
        ? ` <span class="mention-ctx">(${escapeHtml(ctxParts.join(' · '))})</span>`
        : '';
      return `<div class="${cls}" data-i="${i}">
        ${icon} <strong>${escapeHtml(r.name || '?')}</strong>${ctx}
      </div>`;
    }).join('');
    // Si le textarea est dans une <dialog> modale, on doit insérer le popover
    // DANS la dialog : sinon il reste sous le top-layer du navigateur et reste
    // invisible. position:fixed → coordonnées viewport directes, pas de
    // window.scrollY.
    const container = activeTextarea.closest('dialog[open]') || document.body;
    if (popover.parentNode !== container) container.appendChild(popover);
    popover.hidden = false;

    const r = activeTextarea.getBoundingClientRect();
    popover.style.top  = (r.bottom + 4) + 'px';
    popover.style.left = r.left + 'px';
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

  // Normalisation insensible casse + accents (doit matcher celle du serveur).
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD')
      .replace(/[̀-ͯ]/g, '').trim();
  }

  // Décide si on garde le texte tapé ou si on le remplace par le primaryName.
  // Retourne { label, isNewAlias } : `label` est ce qu'on insère dans le textarea,
  // `isNewAlias` indique qu'on devrait proposer ce label comme nouvel alias.
  function decideLabel(typed, result) {
    const t = String(typed || '').trim();
    const tn = norm(t);
    const pn = norm(result.name);
    if (!t)            return { label: result.name, isNewAlias: false };
    if (tn === pn)     return { label: result.name, isNewAlias: false };
    // Saisie raccourcie (préfixe court du nom complet) : on remplace par le
    // primaryName plutôt que de garder une troncature peu lisible.
    if (pn.startsWith(tn) && t.length < 4) {
      return { label: result.name, isNewAlias: false };
    }
    // Le texte tapé matche un alias existant : on le garde tel quel.
    const aliases = (result.existingAliases || []).map(norm);
    if (aliases.includes(tn)) {
      return { label: t, isNewAlias: false };
    }
    // Texte délibéré, ni nom ni alias connu : on garde et on propose en alias.
    return { label: t, isNewAlias: true };
  }

  // POST en arrière-plan : ajoute le label aux aliases (passe par modération).
  function proposeAlias(result, label) {
    if (result.type !== 'person' && result.type !== 'place') return;
    const targetType = result.type === 'person' ? 'people' : 'places';
    const newAliases = [
      ...(result.existingAliases || []).map(name => ({ name })),
      { name: label, context: 'mention dans un récit' },
    ];
    fetch(`/api/${targetType}/${encodeURIComponent(result.id)}/edits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changes: { aliases: newAliases },
        note: `Surnom "${label}" repéré dans une mention inline.`,
      }),
    }).catch(() => { /* mode statique ou réseau coupé : silencieux */ });
  }

  // Crée une nouvelle personne en arrière-plan (POST /api/people).
  // Retourne { id } ou null si l'API n'est pas joignable / refus.
  async function createPersonInline(name) {
    try {
      const res = await fetch('/api/people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryName: name,
          consentGiven: true,
        }),
      });
      if (!res.ok) return null;
      const j = await res.json();
      return j && j.person ? { id: j.person.id } : null;
    } catch (_) {
      return null;
    }
  }

  // Pour les inputs "Qui es-tu" (data-autocomplete="person"), on ne
  // stocke pas la mention dans dataset.mentions ; à la place on remplit
  // le hidden personId du même fieldset, exactement comme autocomplete.js.
  // Sinon le serveur recevrait un name brut sans lien à la fiche.
  function isContributorNameField(ta) {
    return ta.tagName === 'INPUT' && ta.dataset.autocomplete === 'person';
  }
  function setHiddenPersonId(ta, id) {
    const target = ta.dataset.autocompleteTarget || 'personId';
    let hidden = ta.parentElement.querySelector(`input[type="hidden"][name="${target}"]`);
    if (!hidden) {
      hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = target;
      ta.parentElement.appendChild(hidden);
    }
    hidden.value = id || '';
  }

  // ── Sélection d'un résultat ──
  async function pick(idx) {
    if (!activeTextarea) return;
    const r = activeResults[idx];
    if (!r) return;
    const ta = activeTextarea;
    const typed = ta.value.slice(activeAt + 1, ta.selectionStart);

    // Cas spécial : "Créer la personne" → crée d'abord la fiche, puis attache
    // la mention à l'ID retourné. Si la création échoue (non connecté…),
    // on insère le texte tapé sans mention plutôt que de bloquer.
    if (r.kind === 'create-person') {
      const created = await createPersonInline(r.label);
      const label = typed || r.label;
      const before = ta.value.slice(0, activeAt);
      const after  = ta.value.slice(ta.selectionStart);
      ta.value = before + label + after;
      ta.selectionStart = ta.selectionEnd = activeAt + label.length;
      if (created) {
        if (isContributorNameField(ta)) {
          setHiddenPersonId(ta, created.id);
        } else {
          const mentions = getMentions(ta);
          mentions.push({
            start:    activeAt,
            end:      activeAt + label.length,
            type:     'person',
            entityId: created.id,
          });
          setMentions(ta, mentions);
        }
      } else {
        // Feedback discret. Le texte reste, sans lien.
        flashMessage(ta, `Impossible de créer « ${r.label} » (non connecté·e ?). Le nom est gardé sans lien.`);
      }
      hidePopover();
      activeAt = -1;
      activeQuery = '';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.focus();
      return;
    }

    // Pour le champ "Qui es-tu", on remplace tout le contenu par le nom
    // choisi (pas d'insertion partielle) et on remplit le hidden personId.
    // Ça aligne le comportement avec autocomplete.js. On ne dispatche pas
    // d'événement 'input' pour ne pas réveiller autocomplete.js qui
    // viderait aussitôt le hidden personId qu'on vient de poser.
    if (isContributorNameField(ta) && r.type === 'person') {
      ta.value = r.name;
      ta.selectionStart = ta.selectionEnd = r.name.length;
      setHiddenPersonId(ta, r.id);
      hidePopover();
      activeAt = -1;
      activeQuery = '';
      ta.focus();
      return;
    }

    const { label, isNewAlias } = decideLabel(typed, r);
    const before = ta.value.slice(0, activeAt);
    const after  = ta.value.slice(ta.selectionStart);
    ta.value = before + label + after;
    const newCaret = activeAt + label.length;
    ta.selectionStart = ta.selectionEnd = newCaret;

    // Enregistre la mention { start, end, type, entityId }
    const mentions = getMentions(ta);
    mentions.push({
      start:    activeAt,
      end:      activeAt + label.length,
      type:     r.type,
      entityId: r.id,
    });
    setMentions(ta, mentions);

    if (isNewAlias) proposeAlias(r, label);

    hidePopover();
    activeAt = -1;
    activeQuery = '';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
  }

  // Toast minimaliste sous le textarea, auto-fade après 3s.
  function flashMessage(ta, text) {
    const tip = document.createElement('div');
    tip.className = 'mention-flash';
    tip.textContent = text;
    const container = ta.closest('dialog[open]') || document.body;
    container.appendChild(tip);
    const r = ta.getBoundingClientRect();
    tip.style.top = (r.bottom + 4) + 'px';
    tip.style.left = r.left + 'px';
    setTimeout(() => tip.remove(), 3000);
  }

  // ── Hooks textarea ──
  function onInput(e) {
    const ta = e.target;
    if (!ta.matches || !ta.matches('textarea[data-mentions="on"], input[type="text"][data-mentions="on"]')) return;
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
    if (!ta.matches || !ta.matches('textarea[data-mentions="on"], input[type="text"][data-mentions="on"]')) return;
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
