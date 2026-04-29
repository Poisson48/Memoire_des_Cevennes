// Mémoire des Cévennes — admin / alias des Lieux et Personnes
// Hors file de modération : la requête PATCH /api/admin/{type}/:id/aliases
// remplace l'array d'alias d'un coup. UI : recherche + carte par entité,
// chaque alias éditable inline (texte + bouton supprimer), bouton ➕ pour
// en ajouter, bouton « Enregistrer » par carte.

const aliasesListEl  = document.getElementById('aliases-list');
const aliasSearchEl  = document.getElementById('alias-search');
const aliasTypeRadios = document.querySelectorAll('input[name="alias-type"]');

let aliasState = {
  type: 'people',
  query: '',
  items: [],   // entités telles que servies par l'API
  drafts: {},  // id → array d'alias brouillons en cours d'édition
};

function aliasItemMatches(item, q) {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  if ((item.primaryName || '').toLowerCase().includes(needle)) return true;
  return (item.aliases || []).some(a => (a.name || '').toLowerCase().includes(needle));
}

async function refreshAliases() {
  if (!aliasesListEl) return;
  aliasesListEl.innerHTML = '<p class="empty">Chargement…</p>';
  try {
    const url = aliasState.type === 'places' ? '/api/places' : '/api/people';
    const data = await fetchJson(url, authFetchOpts());
    aliasState.items = data[aliasState.type] || [];
    aliasState.drafts = {};
    renderAliases();
  } catch (err) {
    aliasesListEl.innerHTML = `<p class="empty">Erreur : ${escapeHtml(err.message)}</p>`;
  }
}

function renderAliases() {
  if (!aliasesListEl) return;
  const items = aliasState.items
    .filter(it => aliasItemMatches(it, aliasState.query))
    .sort((a, b) => (a.primaryName || '').localeCompare(b.primaryName || '', 'fr'));
  if (items.length === 0) {
    aliasesListEl.innerHTML = '<p class="empty">Aucun résultat.</p>';
    return;
  }
  const isPlace = aliasState.type === 'places';
  aliasesListEl.innerHTML = items.map(it => {
    const draft = aliasState.drafts[it.id] != null
      ? aliasState.drafts[it.id]
      : (it.aliases || []).map(a => a.name);
    const aliasesUI = draft.map((name, i) => `
      <div class="alias-row">
        <input type="text" data-alias-input data-id="${escapeHtml(it.id)}" data-i="${i}"
               value="${escapeHtml(name)}" maxlength="160" placeholder="Forme alternative…" />
        <button type="button" class="btn-ghost btn-alias-del" data-id="${escapeHtml(it.id)}" data-i="${i}"
                title="Retirer cet alias">✕</button>
      </div>
    `).join('');
    const dirty = aliasState.drafts[it.id] != null;
    return `
      <article class="alias-card ${dirty ? 'is-dirty' : ''}" data-id="${escapeHtml(it.id)}">
        <header class="alias-card-head">
          <strong>${escapeHtml(it.primaryName || '(sans nom)')}</strong>
          <a class="alias-card-link" href="${isPlace ? '/#/lieu/' : '/#/personne/'}${encodeURIComponent(it.id)}" target="_blank" rel="noopener">↗ Voir la fiche</a>
        </header>
        <div class="alias-card-list">
          ${aliasesUI || '<p class="empty">Aucun alias pour l\'instant.</p>'}
        </div>
        <div class="alias-card-actions">
          <button type="button" class="btn-ghost btn-alias-add" data-id="${escapeHtml(it.id)}">+ Ajouter un alias</button>
          <button type="button" class="btn-primary btn-alias-save" data-id="${escapeHtml(it.id)}" ${dirty ? '' : 'disabled'}>Enregistrer</button>
          <button type="button" class="btn-ghost btn-alias-cancel" data-id="${escapeHtml(it.id)}" ${dirty ? '' : 'disabled'}>Annuler</button>
          <span class="alias-card-feedback" data-id="${escapeHtml(it.id)}"></span>
        </div>
      </article>
    `;
  }).join('');
}

function readDraft(id) {
  const item = aliasState.items.find(it => it.id === id);
  if (!item) return null;
  if (aliasState.drafts[id] != null) return aliasState.drafts[id];
  return (item.aliases || []).map(a => a.name);
}

function setDraft(id, values) {
  aliasState.drafts[id] = values;
}

aliasesListEl?.addEventListener('input', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement) || !t.matches('[data-alias-input]')) return;
  const id = t.dataset.id;
  const i  = Number(t.dataset.i);
  const draft = readDraft(id) || [];
  draft[i] = t.value;
  setDraft(id, draft);
  // Marque la carte dirty + active le bouton sans rerender complet.
  const card = aliasesListEl.querySelector(`.alias-card[data-id="${CSS.escape(id)}"]`);
  if (card) {
    card.classList.add('is-dirty');
    card.querySelector('.btn-alias-save').disabled = false;
    card.querySelector('.btn-alias-cancel').disabled = false;
  }
});

aliasesListEl?.addEventListener('click', async (e) => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  const id = t.dataset.id;
  if (!id) return;

  if (t.classList.contains('btn-alias-del')) {
    const i = Number(t.dataset.i);
    const draft = readDraft(id) || [];
    draft.splice(i, 1);
    setDraft(id, draft);
    renderAliases();
    return;
  }
  if (t.classList.contains('btn-alias-add')) {
    const draft = readDraft(id) || [];
    draft.push('');
    setDraft(id, draft);
    renderAliases();
    // Focus le nouvel input
    const card = aliasesListEl.querySelector(`.alias-card[data-id="${CSS.escape(id)}"]`);
    const inputs = card?.querySelectorAll('[data-alias-input]') || [];
    inputs[inputs.length - 1]?.focus();
    return;
  }
  if (t.classList.contains('btn-alias-cancel')) {
    delete aliasState.drafts[id];
    renderAliases();
    return;
  }
  if (t.classList.contains('btn-alias-save')) {
    const draft = readDraft(id) || [];
    const aliases = draft
      .map(name => String(name || '').trim())
      .filter(Boolean)
      .map(name => ({ name }));
    const fbEl = aliasesListEl.querySelector(`.alias-card-feedback[data-id="${CSS.escape(id)}"]`);
    try {
      t.disabled = true;
      const out = await fetchJson(
        `/api/admin/${aliasState.type}/${encodeURIComponent(id)}/aliases`,
        authFetchOpts({ method: 'PATCH', body: JSON.stringify({ aliases }) }),
      );
      const idx = aliasState.items.findIndex(it => it.id === id);
      if (idx >= 0 && out.item) aliasState.items[idx] = out.item;
      delete aliasState.drafts[id];
      if (fbEl) {
        fbEl.textContent = '✓ enregistré';
        fbEl.className = 'alias-card-feedback level-success';
      }
      renderAliases();
    } catch (err) {
      t.disabled = false;
      if (fbEl) {
        fbEl.textContent = 'Erreur : ' + err.message;
        fbEl.className = 'alias-card-feedback level-error';
      }
    }
  }
});

aliasSearchEl?.addEventListener('input', () => {
  aliasState.query = aliasSearchEl.value || '';
  renderAliases();
});

aliasTypeRadios.forEach(r => {
  r.addEventListener('change', () => {
    if (!r.checked) return;
    aliasState.type = r.value === 'places' ? 'places' : 'people';
    refreshAliases();
  });
});
