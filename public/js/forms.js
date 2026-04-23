// Mémoire des Cévennes — formulaires (contributions + propositions de modif)
//
// Trois flux, tous en mode live uniquement :
//   1. Ajouter un lieu : clic sur la carte → modale → POST /api/places.
//   2. Ajouter un contenu à un lieu : ouvert depuis le panneau Lieu →
//      POST /api/stories (+ POST /api/stories/:id/media si fichier joint).
//   3. Proposer une modification d'un Lieu / Personne / Récit :
//      POST /api/:type/:id/edits avec le delta des champs modifiés.
//
// Les trois soumissions aboutissent en `status: pending` côté serveur — un
// admin approuve depuis /admin.html.
//
// Ce fichier doit être chargé APRÈS app.js (qui expose state, map, addBtn,
// addHint, escapeHtml…) mais avant la fin du parsing du DOM. Les handlers
// top-level utilisent des DOM refs initialisées à la volée.

// ── DOM refs ───────────────────────────────────────────────────────────
const dlgPlace = document.getElementById('dlg-place');
const formPlace = document.getElementById('form-place');
const dlgStory = document.getElementById('dlg-story');
const formStory = document.getElementById('form-story');
const storyType = document.getElementById('story-type');
const storyMediaLabel = document.getElementById('story-media-label');
const dlgEdit = document.getElementById('dlg-edit');
const formEdit = document.getElementById('form-edit');

dlgStory.querySelectorAll('[data-close]').forEach(b =>
  b.addEventListener('click', () => dlgStory.close('cancel'))
);
dlgEdit.querySelectorAll('[data-close]').forEach(b =>
  b.addEventListener('click', () => dlgEdit.close('cancel'))
);
storyType.addEventListener('change', updateStoryMediaVisibility);
updateStoryMediaVisibility();

// ── Flux 1 : ajouter un lieu ───────────────────────────────────────────
let addMode = false;
let pendingLatLng = null;

addBtn.addEventListener('click', () => {
  if (state.mode === 'static') {
    alert('Cette page est un aperçu en lecture seule. Lance l\'application localement (./run.sh) pour contribuer.');
    return;
  }
  addMode = !addMode;
  addHint.hidden = !addMode;
  addBtn.textContent = addMode ? '✕ Annuler' : '+ Ajouter un lieu';
  map.getContainer().style.cursor = addMode ? 'crosshair' : '';
});

map.on('click', (e) => {
  if (!addMode) return;
  pendingLatLng = e.latlng;
  document.getElementById('place-coords').textContent =
    `📍 ${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
  formPlace.reset();
  dlgPlace.showModal();
});

formPlace.addEventListener('close', async () => {
  if (dlgPlace.returnValue !== 'submit' || !pendingLatLng) {
    resetAddMode(); return;
  }
  const fd = new FormData(formPlace);
  const payload = {
    primaryName: fd.get('title'),
    description: fd.get('description'),
    lat: pendingLatLng.lat,
    lng: pendingLatLng.lng,
    submittedBy: fd.get('pseudo') ? { pseudo: fd.get('pseudo') } : undefined,
  };
  try {
    const res = await fetch('/api/places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    alert(data.message || 'Ajout reçu. En attente de validation par un·e admin avant affichage public.');
  } catch (err) {
    alert('Erreur : ' + err.message);
  } finally {
    resetAddMode();
  }
});

function resetAddMode() {
  addMode = false; pendingLatLng = null;
  addHint.hidden = true;
  addBtn.textContent = '+ Ajouter un lieu';
  map.getContainer().style.cursor = '';
}

// ── Flux 2 : ajouter un contenu (texte / photo / audio / vidéo / …) ────
function openStoryDialog(placeId) {
  formStory.reset();
  updateStoryMediaVisibility();
  formStory.dataset.placeId = placeId;
  const place = state.places.get(placeId);
  document.getElementById('story-place-name').textContent = `Pour : ${place ? place.primaryName : placeId}`;
  dlgStory.showModal();
}

function updateStoryMediaVisibility() {
  const t = storyType.value;
  storyMediaLabel.hidden = (t === 'text' || t === 'note');
}

formStory.addEventListener('submit', async (e) => {
  e.preventDefault();
  const placeId = formStory.dataset.placeId;
  if (!placeId) return;
  const fd = new FormData(formStory);
  const payload = {
    placeId,
    type: fd.get('type'),
    title: fd.get('title'),
    body: fd.get('body'),
    submittedBy: fd.get('pseudo') ? { pseudo: fd.get('pseudo') } : undefined,
  };
  try {
    const res = await fetch('/api/stories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);

    const file = fd.get('media');
    if (file && file.size > 0) {
      const mediaForm = new FormData();
      mediaForm.append('media', file);
      const mres = await fetch(`/api/stories/${encodeURIComponent(data.story.id)}/media`, {
        method: 'POST',
        body: mediaForm,
      });
      if (!mres.ok) {
        const mdata = await mres.json().catch(() => ({}));
        throw new Error(`Récit créé mais média refusé : ${mdata.error || mres.statusText}`);
      }
    }

    dlgStory.close('submit');
    alert(data.message || 'Récit reçu. En attente de validation avant affichage public.');
  } catch (err) {
    alert('Erreur : ' + err.message);
  }
});

// ── Flux 3 : proposer une modification (style Wikipédia) ───────────────
const EDIT_FIELDS = {
  places: [
    { key: 'primaryName', label: 'Nom principal', type: 'text', required: true },
    { key: 'description', label: 'Description', type: 'textarea', rows: 4 },
  ],
  people: [
    { key: 'primaryName', label: 'Nom principal', type: 'text', required: true },
    { key: 'maidenName', label: 'Nom de naissance (pour les femmes mariées)', type: 'text' },
    { key: 'bio', label: 'Biographie', type: 'textarea', rows: 4 },
  ],
  stories: [
    { key: 'title', label: 'Titre', type: 'text' },
    { key: 'memoryDate', label: 'Date du souvenir (libre : « années 40 », « 1952 »…)', type: 'text' },
    { key: 'body', label: 'Texte', type: 'textarea', rows: 6 },
  ],
};

function openEditDialog(entityType, entity) {
  formEdit.reset();
  formEdit.dataset.entityType = entityType;
  formEdit.dataset.entityId = entity.id;
  const name = entity.primaryName || entity.title || entity.id;
  const kindLabel = { places: 'le lieu', people: 'la personne', stories: 'le récit' }[entityType] || '';
  document.getElementById('edit-target-name').textContent = `Pour ${kindLabel} : ${name}`;

  const fields = EDIT_FIELDS[entityType] || [];
  const fieldsEl = document.getElementById('edit-fields');
  fieldsEl.innerHTML = fields.map(f => {
    const val = entity[f.key] ?? '';
    const req = f.required ? ' required' : '';
    if (f.type === 'textarea') {
      return `
        <label>${escapeHtml(f.label)}
          <textarea name="${f.key}" rows="${f.rows || 3}"${req}>${escapeHtml(val)}</textarea>
        </label>
      `;
    }
    return `
      <label>${escapeHtml(f.label)}
        <input type="text" name="${f.key}" value="${escapeAttr(val)}"${req} />
      </label>
    `;
  }).join('');

  formEdit.dataset.originalData = JSON.stringify(
    Object.fromEntries(fields.map(f => [f.key, entity[f.key] ?? '']))
  );
  dlgEdit.showModal();
}

formEdit.addEventListener('submit', async (e) => {
  e.preventDefault();
  const entityType = formEdit.dataset.entityType;
  const entityId = formEdit.dataset.entityId;
  const original = JSON.parse(formEdit.dataset.originalData || '{}');
  const fd = new FormData(formEdit);

  const changes = {};
  for (const [k, v] of fd.entries()) {
    if (k === 'note' || k === 'pseudo') continue;
    if (String(original[k] ?? '') !== String(v ?? '')) {
      changes[k] = v;
    }
  }

  if (Object.keys(changes).length === 0) {
    alert('Aucun changement détecté.');
    return;
  }

  const payload = {
    changes,
    note: fd.get('note') || '',
    submittedBy: fd.get('pseudo') ? { pseudo: fd.get('pseudo') } : undefined,
  };

  try {
    const res = await fetch(`/api/${entityType}/${encodeURIComponent(entityId)}/edits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    dlgEdit.close('submit');
    alert(data.message || 'Proposition reçue — en attente de validation.');
  } catch (err) {
    alert('Erreur : ' + err.message);
  }
});
