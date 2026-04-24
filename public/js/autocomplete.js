// Mémoire des Cévennes — autocomplétion des noms de contributeur.
//
// Chaque <input data-autocomplete="person"> déclenche une recherche
// debounced via /api/resolve quand l'utilisateur tape. Les Personnes
// correspondantes apparaissent dans un petit menu sous l'input. Cliquer
// sur une suggestion :
//   - remplace la valeur de l'input par le primaryName choisi,
//   - stocke l'id de la Personne dans un input caché `personId` (créé à
//     la volée dans le même parent), qui est envoyé au serveur dans
//     submittedBy.personId.
//
// Si l'utilisateur tape un nom qui ne matche rien, submittedBy.personId
// reste vide et seul le texte est stocké (pas de lien).
//
// Objectif UX : quand quelqu'un a déjà contribué ou quand son nom existe
// déjà dans le graphe (via un témoignage, une mention, l'arbre généalo-
// gique), son nom lui est automatiquement suggéré — son identité reste
// cohérente d'un ajout à l'autre, au lieu d'avoir trois variantes du
// même nom dans la base.

(function() {
  const DEBOUNCE_MS = 180;
  const MIN_CHARS = 2;

  // Nom du hidden : data-autocomplete-target (par défaut "personId").
  function targetName(input) {
    return input.dataset.autocompleteTarget || 'personId';
  }
  function ensureHiddenPersonId(input) {
    const name = targetName(input);
    let hidden = input.parentElement.querySelector(`input[type="hidden"][name="${name}"]`);
    if (!hidden) {
      hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = name;
      input.parentElement.appendChild(hidden);
    }
    return hidden;
  }

  function clearPersonLink(input) {
    const hidden = input.parentElement.querySelector(`input[type="hidden"][name="${targetName(input)}"]`);
    if (hidden) hidden.value = '';
  }

  function buildMenu() {
    const ul = document.createElement('ul');
    ul.className = 'autocomplete-menu';
    ul.setAttribute('role', 'listbox');
    return ul;
  }

  function positionMenu(menu, input) {
    // Positionne le menu juste sous l'input, dans le même parent.
    const rect = input.getBoundingClientRect();
    const parent = input.parentElement;
    const parentRect = parent.getBoundingClientRect();
    menu.style.top = `${rect.bottom - parentRect.top + 2}px`;
    menu.style.left = `${rect.left - parentRect.left}px`;
    menu.style.width = `${rect.width}px`;
  }

  function attachTo(input) {
    if (input.dataset.autocompleteAttached === '1') return;
    input.dataset.autocompleteAttached = '1';
    // Le parent doit être position: relative pour que le menu se place.
    if (!input.parentElement.style.position) {
      input.parentElement.style.position = 'relative';
    }
    const menu = buildMenu();
    menu.hidden = true;
    input.parentElement.appendChild(menu);
    ensureHiddenPersonId(input);

    let debounce = null;
    let lastQuery = '';

    input.addEventListener('input', () => {
      clearPersonLink(input); // retape = rompt le lien jusqu'à nouvelle sélection
      const q = input.value.trim();
      if (debounce) clearTimeout(debounce);
      if (q.length < MIN_CHARS) {
        menu.hidden = true;
        return;
      }
      debounce = setTimeout(async () => {
        lastQuery = q;
        try {
          const res = await fetch(`/api/resolve?q=${encodeURIComponent(q)}&limit=8`);
          if (!res.ok) throw new Error('réseau');
          const data = await res.json();
          if (lastQuery !== q) return; // course ignorée
          const hits = (data.results || []).filter(r => r.type === 'person');
          renderMenu(menu, input, hits);
          positionMenu(menu, input);
          menu.hidden = hits.length === 0;
        } catch {
          menu.hidden = true;
        }
      }, DEBOUNCE_MS);
    });

    input.addEventListener('blur', () => {
      // Laisse le temps au click du menu de se déclencher.
      setTimeout(() => { menu.hidden = true; }, 150);
    });

    input.addEventListener('focus', () => {
      if (input.value.trim().length >= MIN_CHARS && menu.children.length > 0) {
        positionMenu(menu, input);
        menu.hidden = false;
      }
    });
  }

  function renderMenu(menu, input, hits) {
    menu.innerHTML = hits.map(h => {
      const aliasBit = h.source === 'alias' && h.alias
        ? ` <span class="ac-alias">— alias « ${escapeHtml(h.matched)} »</span>`
        : '';
      return `<li role="option" data-id="${escapeAttr(h.id)}" data-name="${escapeAttr(h.name)}">
        <strong>${escapeHtml(h.name)}</strong>${aliasBit}
      </li>`;
    }).join('');
    menu.querySelectorAll('li[data-id]').forEach(li => {
      li.addEventListener('mousedown', (e) => {
        // mousedown (pas click) pour gagner la course avec blur.
        e.preventDefault();
        input.value = li.dataset.name;
        const hidden = ensureHiddenPersonId(input);
        hidden.value = li.dataset.id;
        menu.hidden = true;
      });
    });
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // Injection du bloc « nouvelle fiche » après chaque contributor-id.
  // Les champs sont optionnels : date de naissance, parents, bio. Ils ne
  // servent que si le nom typé ne matche aucune Personne existante — dans
  // ce cas le serveur crée une Personne pending avec ces infos.
  function attachNewPersonBlock(fieldset) {
    if (fieldset.dataset.newPersonInjected === '1') return;
    fieldset.dataset.newPersonInjected = '1';
    const details = document.createElement('details');
    details.className = 'new-person';
    details.innerHTML = `
      <summary>🌱 Nouvelle fiche — seulement si mon nom n'existe pas encore dans la base</summary>
      <p class="new-person-hint">
        Tous les champs sont optionnels. Ils seront ignorés si tu as
        choisi ton nom dans la liste suggérée plus haut.
      </p>
      <label>Année de naissance
        <input type="text" name="newPerson.birthYear" inputmode="numeric" pattern="[0-9]{0,4}" maxlength="4" placeholder="1954" />
      </label>
      <label>Fille / fils de
        <input type="text" data-autocomplete="person" data-autocomplete-target="newPerson.parent1Id" placeholder="nom du parent (suggéré si déjà dans la base)" />
      </label>
      <label>Autre parent
        <input type="text" data-autocomplete="person" data-autocomplete-target="newPerson.parent2Id" placeholder="nom du second parent (facultatif)" />
      </label>
      <label>Biographie courte (3-4 phrases max)
        <textarea name="newPerson.bio" rows="2" maxlength="500"></textarea>
      </label>
    `;
    fieldset.after(details);
    // Attache l'autocomplete aux nouveaux inputs parent.
    details.querySelectorAll('input[data-autocomplete="person"]').forEach(attachTo);
  }

  // Découvre tous les inputs data-autocomplete au chargement et injecte
  // le bloc new-person sous chaque fieldset.contributor-id.
  function initAll() {
    document.querySelectorAll('input[data-autocomplete="person"]').forEach(attachTo);
    document.querySelectorAll('fieldset.contributor-id').forEach(attachNewPersonBlock);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
