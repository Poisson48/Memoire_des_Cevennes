// Mémoire des Cévennes : formulaires (contributions + propositions de modif)
//
// Trois flux, tous en mode live uniquement :
//   1. Ajouter un lieu : clic sur la carte → modale → POST /api/places.
//   2. Ajouter un contenu à un lieu : ouvert depuis le panneau Lieu →
//      POST /api/stories (+ POST /api/stories/:id/media si fichier joint).
//   3. Proposer une modification d'un Lieu / Personne / Récit :
//      POST /api/:type/:id/edits avec le delta des champs modifiés.
//
// Les trois soumissions aboutissent en `status: pending` côté serveur : un
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
const storyTypeCards = document.getElementById('story-type-cards');
function getStoryType() {
  // Lit la valeur du radio coché. Si rien n'est coché (cas théorique),
  // on retombe sur 'text' qui est le défaut HTML.
  return formStory.elements.type ? (formStory.elements.type.value || 'text') : 'text';
}
const storyMediaLabel = document.getElementById('story-media-label');
const storyRecorder = document.getElementById('story-recorder');
const storyMediaInput = document.getElementById('story-media-input');
const dlgEdit = document.getElementById('dlg-edit');
const formEdit = document.getElementById('form-edit');
const dlgComplete = document.getElementById('dlg-complete');
const formComplete = document.getElementById('form-complete');

dlgStory.querySelectorAll('[data-close]').forEach(b =>
  b.addEventListener('click', () => dlgStory.close('cancel'))
);
dlgEdit.querySelectorAll('[data-close]').forEach(b =>
  b.addEventListener('click', () => dlgEdit.close('cancel'))
);
dlgComplete.querySelectorAll('[data-close]').forEach(b =>
  b.addEventListener('click', () => dlgComplete.close('cancel'))
);
storyTypeCards.addEventListener('change', updateStoryMediaVisibility);
updateStoryMediaVisibility();

// ── Brouillon localStorage du formulaire de récit ─────────────────────
// Stocke le contenu en cours toutes les ~400 ms. Restauré à la prochaine
// ouverture du dialog pour le même placeId, purgé après envoi réussi
// ou effacement explicite. Pas de personId stocké : on laisse l'auto-
// complétion relier au moment de l'envoi (évite les liens vers fiches
// supprimées entre deux sessions).
const DRAFT_PREFIX = 'mdc:story-draft:';
const DRAFT_FIELDS = ['type', 'title', 'memoryDate', 'body', 'name', 'writtenFrom', 'relationship', 'visibility'];
const draftBanner = document.getElementById('story-draft-banner');
const draftMeta   = document.getElementById('story-draft-meta');
const draftClear  = document.getElementById('story-draft-clear');
let draftSaveTimer = null;

function draftKey(placeId) { return DRAFT_PREFIX + placeId; }

function readDraft(placeId) {
  try {
    const raw = localStorage.getItem(draftKey(placeId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeDraft(placeId, data) {
  try { localStorage.setItem(draftKey(placeId), JSON.stringify(data)); }
  catch { /* quota / private mode : silencieux */ }
}

function clearDraft(placeId) {
  try { localStorage.removeItem(draftKey(placeId)); } catch { /* idem */ }
  if (draftBanner) draftBanner.hidden = true;
}

function captureDraft(placeId) {
  if (!placeId) return;
  const fd = new FormData(formStory);
  const data = {};
  for (const k of DRAFT_FIELDS) {
    const v = fd.get(k);
    if (v != null && String(v).trim()) data[k] = String(v);
  }
  // Si on a juste type=text (la valeur par défaut) et rien d'autre, on
  // considère que l'utilisateur n'a rien tapé : pas de brouillon à garder.
  const meaningful = Object.keys(data).filter(k => k !== 'type' && k !== 'visibility');
  if (meaningful.length === 0) {
    clearDraft(placeId);
    return;
  }
  writeDraft(placeId, { ...data, savedAt: Date.now() });
}

function scheduleDraftSave() {
  const placeId = formStory.dataset.placeId;
  if (!placeId) return;
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => captureDraft(placeId), 400);
}

function applyDraft(data) {
  if (!data) return false;
  let any = false;
  if (data.type) {
    const r = formStory.querySelector(`input[name=type][value="${data.type}"]`);
    if (r) { r.checked = true; }
  }
  for (const k of ['title', 'memoryDate', 'body', 'name', 'writtenFrom', 'relationship']) {
    if (data[k] == null) continue;
    const el = formStory.querySelector(`[name="${k}"]`);
    if (el) {
      el.value = data[k];
      if (data[k]) any = true;
    }
  }
  if (data.visibility) {
    const r = formStory.querySelector(`input[name=visibility][value="${data.visibility}"]`);
    if (r) r.checked = true;
  }
  return any;
}

function formatDraftAge(savedAt) {
  if (!savedAt) return '';
  const diff = Math.max(0, Date.now() - Number(savedAt));
  const mins = Math.round(diff / 60000);
  if (mins < 1) return '(à l\'instant)';
  if (mins < 60) return `(il y a ${mins} min)`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `(il y a ${hours} h)`;
  const days = Math.round(hours / 24);
  return `(il y a ${days} j)`;
}

function showDraftBanner(savedAt) {
  if (!draftBanner) return;
  if (draftMeta) draftMeta.textContent = formatDraftAge(savedAt);
  draftBanner.hidden = false;
}

if (draftClear) {
  draftClear.addEventListener('click', () => {
    const placeId = formStory.dataset.placeId;
    formStory.reset();
    updateStoryMediaVisibility();
    const capsDiv = document.getElementById('story-media-captions');
    if (capsDiv) capsDiv.innerHTML = '';
    if (placeId) clearDraft(placeId);
  });
}

// Ecoute toute saisie/changement dans le formulaire pour déclencher la
// sauvegarde. On évite de reposer ce listener à chaque ouverture grâce
// à un attachement unique au form.
formStory.addEventListener('input',  scheduleDraftSave);
formStory.addEventListener('change', scheduleDraftSave);

// Rendu dynamique des prévisualisations + champ « Légende » par fichier
// sélectionné. Mis à jour à chaque changement de l'input fichier.
storyMediaInput.addEventListener('change', renderMediaCaptions);
function renderMediaCaptions() {
  const div = document.getElementById('story-media-captions');
  if (!div) return;
  div.innerHTML = '';
  const files = Array.from(storyMediaInput.files || []);
  if (!files.length) return;
  const bodyTa = formStory.querySelector('textarea[name=body]');
  files.forEach((f, i) => div.appendChild(mediaRow(f, i, bodyTa)));
}

// Construit une ligne média : vignette + légende + (pour les images) bloc
// OCR. `bodyTextarea` = la zone de texte du récit où insérer le texte OCR
// (formStory en création, formEdit en édition). Réutilisé par les deux flux.
function mediaRow(f, i, bodyTextarea) {
  const row = document.createElement('div');
  row.className = 'media-caption-row';

  const thumb = document.createElement('div');
  thumb.className = 'media-thumb';
  if (f.type.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(f);
    img.onload = () => URL.revokeObjectURL(img.src);
    thumb.appendChild(img);
  } else {
    const icon =
      f.type.startsWith('audio/') ? '🎙️' :
      f.type.startsWith('video/') ? '🎬' : '📎';
    thumb.textContent = icon;
  }

  const right = document.createElement('div');
  right.className = 'media-cap-right';
  const fname = document.createElement('div');
  fname.className = 'media-fname';
  fname.textContent = f.name;
  const cap = document.createElement('input');
  cap.type = 'text';
  cap.name = `caption_${i}`;
  cap.placeholder = 'Légende (facultatif)';
  cap.maxLength = 500;
  cap.className = 'media-caption-input';

  right.appendChild(fname);
  right.appendChild(cap);

  // OCR : pour les images, propose d'extraire le texte (document scanné,
  // lettre, page de cahier…). Disponible seulement si le serveur a
  // l'OCR actif (window.__ocrAvailable, sondé au chargement).
  if (f.type.startsWith('image/') && window.__ocrAvailable) {
    const ocrWrap = document.createElement('div');
    ocrWrap.className = 'ocr-wrap';

    const ocrBtn = document.createElement('button');
    ocrBtn.type = 'button';
    ocrBtn.className = 'ocr-btn';
    ocrBtn.textContent = '🔎 Extraire le texte (OCR)';

    const ocrArea = document.createElement('textarea');
    ocrArea.name = `ocr_${i}`;
    ocrArea.className = 'ocr-text';
    ocrArea.rows = 4;
    ocrArea.placeholder = 'Le texte extrait apparaîtra ici (corrige-le si besoin).';
    ocrArea.hidden = true;
    ocrArea.maxLength = 30000;

    const insertBtn = document.createElement('button');
    insertBtn.type = 'button';
    insertBtn.className = 'ocr-insert-btn';
    insertBtn.textContent = '⤵ Insérer dans le récit';
    insertBtn.hidden = true;

    ocrBtn.addEventListener('click', () => runOcr(f, ocrBtn, ocrArea, insertBtn));
    insertBtn.addEventListener('click', () => insertOcrIntoBody(ocrArea.value, bodyTextarea));

    ocrWrap.appendChild(ocrBtn);
    ocrWrap.appendChild(ocrArea);
    ocrWrap.appendChild(insertBtn);
    right.appendChild(ocrWrap);
  }

  row.appendChild(thumb);
  row.appendChild(right);
  return row;
}

// Appelle l'OCR serveur sur une image et remplit la zone de texte editable.
async function runOcr(file, btn, area, insertBtn) {
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Lecture en cours…';
  try {
    const fd = new FormData();
    fd.append('media', file, file.name);
    const res = await fetch('/api/ocr', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    area.value = (data.text || '').trim();
    area.hidden = false;
    insertBtn.hidden = !area.value;
    btn.textContent = area.value ? '🔁 Relancer l’OCR' : 'Aucun texte détecté';
    if (typeof dlgStory !== 'undefined' && dlgStory.open) scheduleDraftSave();
  } catch (err) {
    alert('OCR : ' + err.message);
    btn.textContent = orig;
  } finally {
    btn.disabled = false;
  }
}

// Ajoute le texte OCR à la fin de la zone de texte ciblée.
function insertOcrIntoBody(text, ta) {
  if (!text) return;
  ta = ta || formStory.querySelector('textarea[name=body]');
  if (!ta) return;
  ta.value = (ta.value.trim() ? ta.value.trim() + '\n\n' : '') + text.trim();
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus();
}

// Sonde la disponibilité de l'OCR une fois, pour afficher/masquer le bouton.
fetch('/api/ocr/status').then(r => r.json()).then(d => {
  window.__ocrAvailable = !!(d && d.available);
}).catch(() => { window.__ocrAvailable = false; });

// ── Médias dans l'édition d'un récit ───────────────────────────────────
// L'édition (proposition de modif) gère désormais aussi les images : on peut
// en retirer et en ajouter (avec OCR). Contrairement au texte (qui passe en
// modération), les médias sont membres-only et appliqués immédiatement, comme
// à la création.
let editMediaToDelete = new Set();
const editMediaInput = document.getElementById('edit-media-input');
if (editMediaInput) {
  editMediaInput.addEventListener('change', () => {
    const rows = document.getElementById('edit-media-rows');
    rows.innerHTML = '';
    const files = Array.from(editMediaInput.files || []);
    const bodyTa = formEdit.querySelector('textarea[name=body]');
    files.forEach((f, i) => rows.appendChild(mediaRow(f, i, bodyTa)));
  });
}

function setupEditMedia(story) {
  editMediaToDelete = new Set();
  if (editMediaInput) editMediaInput.value = '';
  const rows = document.getElementById('edit-media-rows');
  if (rows) rows.innerHTML = '';
  const isMember = typeof hasRole === 'function' && hasRole('member') && state.mode === 'live';
  document.getElementById('edit-media-hint').hidden = isMember;
  document.getElementById('edit-media-add').style.display = isMember ? '' : 'none';
  renderEditExisting(story, isMember);
}

function renderEditExisting(story, isMember) {
  const wrap = document.getElementById('edit-media-existing');
  const imgs = (story.mediaFiles || []).filter(m => (m.mime || '').startsWith('image/'));
  if (!imgs.length) {
    wrap.innerHTML = '<p class="dialog-note">Aucune image pour l’instant.</p>';
    return;
  }
  const storyId = story.id;
  wrap.innerHTML = '';
  imgs.forEach(m => {
    const block = document.createElement('div');
    block.className = 'edit-media-existing-block';

    const row = document.createElement('div');
    row.className = 'edit-media-existing-row';
    const img = document.createElement('img');
    img.src = m.url; img.alt = m.caption || '';
    const info = document.createElement('span');
    info.className = 'media-fname';
    info.textContent = (m.caption || m.url.split('/').pop()) +
      (m.ocrText ? '  ✓ texte OCR enregistré' : '');
    row.appendChild(img);
    row.appendChild(info);

    if (isMember) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn-ghost btn-inline';
      del.textContent = '🗑️ Retirer';
      del.addEventListener('click', () => {
        if (editMediaToDelete.has(m.url)) {
          editMediaToDelete.delete(m.url); block.classList.remove('to-delete'); del.textContent = '🗑️ Retirer';
        } else {
          editMediaToDelete.add(m.url); block.classList.add('to-delete'); del.textContent = '↩️ Garder';
        }
      });
      row.appendChild(del);
    }
    block.appendChild(row);

    // OCR a posteriori sur cette image deja uploadee.
    if (isMember && window.__ocrAvailable) {
      const ocrWrap = document.createElement('div');
      ocrWrap.className = 'ocr-wrap';

      const ocrBtn = document.createElement('button');
      ocrBtn.type = 'button';
      ocrBtn.className = 'ocr-btn';
      ocrBtn.textContent = m.ocrText ? '🔁 Relancer l’OCR' : '🔎 Extraire le texte (OCR)';

      const area = document.createElement('textarea');
      area.className = 'ocr-text';
      area.rows = 4;
      area.maxLength = 30000;
      area.value = m.ocrText || '';
      area.hidden = !m.ocrText;

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'ocr-insert-btn';
      saveBtn.textContent = '💾 Enregistrer le texte';
      saveBtn.hidden = !m.ocrText;

      const insertBtn = document.createElement('button');
      insertBtn.type = 'button';
      insertBtn.className = 'ocr-insert-btn';
      insertBtn.textContent = '⤵ Insérer dans le récit';
      insertBtn.hidden = !m.ocrText;

      ocrBtn.addEventListener('click', async () => {
        const orig = ocrBtn.textContent;
        ocrBtn.disabled = true; ocrBtn.textContent = '⏳ Lecture en cours…';
        try {
          const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}/media/ocr`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ url: m.url }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || res.statusText);
          area.value = (data.text || '').trim();
          area.hidden = false; saveBtn.hidden = false; insertBtn.hidden = !area.value;
          ocrBtn.textContent = '🔁 Relancer l’OCR';
        } catch (err) {
          alert('OCR : ' + err.message);
          ocrBtn.textContent = orig;
        } finally { ocrBtn.disabled = false; }
      });

      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        try {
          const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}/media`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ url: m.url, ocrText: area.value }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || res.statusText);
          m.ocrText = area.value.trim();
          saveBtn.textContent = '✓ Enregistré';
          setTimeout(() => { saveBtn.textContent = '💾 Enregistrer le texte'; }, 1500);
        } catch (err) {
          alert('Erreur : ' + err.message);
        } finally { saveBtn.disabled = false; }
      });

      insertBtn.addEventListener('click', () =>
        insertOcrIntoBody(area.value, formEdit.querySelector('textarea[name=body]')));

      ocrWrap.appendChild(ocrBtn);
      ocrWrap.appendChild(area);
      ocrWrap.appendChild(saveBtn);
      ocrWrap.appendChild(insertBtn);
      block.appendChild(ocrWrap);
    }

    wrap.appendChild(block);
  });
}

// Upload des nouvelles images (compression + légende + OCR) sur un récit.
// `scopeSelector` borne la recherche des champs caption_/ocr_ au bon dialog.
async function uploadNewMedia(storyId, inputEl, scopeSelector) {
  const files = [...((inputEl && inputEl.files) || [])];
  if (!files.length) return 0;
  const mediaForm = new FormData();
  let added = 0;
  for (let idx = 0; idx < files.length; idx++) {
    const file = files[idx];
    if (!file || file.size <= 0) continue;
    const result = await runCompression(file, file.name, new AbortController().signal);
    mediaForm.append('media', result.blob, result.filename || file.name);
    const cap = document.querySelector(`${scopeSelector} input[name="caption_${idx}"]`)?.value || '';
    mediaForm.append('captions', cap);
    const ocr = document.querySelector(`${scopeSelector} textarea[name="ocr_${idx}"]`)?.value || '';
    mediaForm.append('ocrText', ocr);
    added++;
  }
  if (added > 0) {
    const r = await fetch(`/api/stories/${encodeURIComponent(storyId)}/media`, { method: 'POST', body: mediaForm });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || r.statusText); }
  }
  return added;
}

// ── Flux 1 : ajouter un lieu ───────────────────────────────────────────
// `state.addMode` est partagé (défini dans app.js) : on en lit la valeur
// aussi depuis refreshMarkers() pour que les marqueurs existants ne
// captent pas le clic en phase de pose d'un nouveau lieu.
let pendingLatLng = null;

addBtn.addEventListener('click', () => {
  state.addMode = !state.addMode;
  addHint.hidden = !state.addMode;
  addBtn.textContent = state.addMode ? '✕ Annuler' : '+ Ajouter un lieu';
  map.getContainer().style.cursor = state.addMode ? 'crosshair' : '';
  // Active la mire fixe au centre via .map-crosshair (cf. style.css)
  document.body.classList.toggle('add-mode', state.addMode);
});

// Voie 1 : touche directement la carte (rapide sur desktop / quand on
// vise précisément un point connu).
map.on('click', (e) => {
  if (!state.addMode) return;
  pendingLatLng = e.latlng;
  renderPlaceCoords(e.latlng);
  if (!dlgPlace.open) {
    formPlace.reset();
    dlgPlace.showModal();
  }
});

// Voie 2 (touch-friendly) : centre la carte avec la mire et tape « Placer ici ».
// Le doigt n'occulte jamais la cible, et on peut paner/zoomer librement
// avant de valider.
document.getElementById('btn-place-here').addEventListener('click', () => {
  if (!state.addMode) return;
  pendingLatLng = map.getCenter();
  renderPlaceCoords(pendingLatLng);
  if (!dlgPlace.open) {
    formPlace.reset();
    dlgPlace.showModal();
  }
});

// Exposé (hoisted, scope script) pour que js/geo.js puisse corriger la
// position pendant que la modale est ouverte : bouton « Utiliser ma
// position » à l'intérieur du dialogue.
function setPendingLatLng(latlng) {
  pendingLatLng = latlng;
  renderPlaceCoords(latlng);
}

function renderPlaceCoords(latlng) {
  document.getElementById('place-coords').textContent =
    `📍 ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
}

dlgPlace.addEventListener('close', async () => {
  if (dlgPlace.returnValue !== 'submit' || !pendingLatLng) {
    resetAddMode(); return;
  }
  if (blockedByStaticMode('l\'ajout d\'un lieu')) {
    resetAddMode(); return;
  }
  const fd = new FormData(formPlace);
  const payload = {
    primaryName: fd.get('title'),
    description: fd.get('description'),
    lat: pendingLatLng.lat,
    lng: pendingLatLng.lng,
    visibility: fd.get('visibility') || 'members',
    consentGiven: true,           // implicite : la charte a été acceptée à l'inscription
    submittedBy: extractSubmittedBy(fd),
    newPerson: extractNewPerson(fd),
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
  state.addMode = false;
  pendingLatLng = null;
  addHint.hidden = true;
  addBtn.textContent = '+ Ajouter un lieu';
  map.getContainer().style.cursor = '';
  document.body.classList.remove('add-mode');
}

// ── Flux 2 : ajouter un contenu (texte / photo / audio / vidéo / …) ────
function openStoryDialog(placeId) {
  formStory.reset();
  // formStory.reset() vide l'input fichier mais ne déclenche pas 'change' :
  // on nettoie manuellement la liste des légendes.
  const capsDiv = document.getElementById('story-media-captions');
  if (capsDiv) capsDiv.innerHTML = '';
  resetRecorderIfAvailable();
  formStory.dataset.placeId = placeId;
  const place = state.places.get(placeId);
  document.getElementById('story-place-name').textContent = `Pour : ${place ? place.primaryName : placeId}`;
  // Restauration du brouillon avant d'afficher : applyDraft positionne
  // les radios (type, visibilité), updateStoryMediaVisibility lit
  // ensuite la bonne valeur de type pour montrer/cacher recorder & file.
  if (draftBanner) draftBanner.hidden = true;
  const draft = readDraft(placeId);
  if (draft && applyDraft(draft)) {
    showDraftBanner(draft.savedAt);
  }
  updateStoryMediaVisibility();
  dlgStory.showModal();
}

function resetRecorderIfAvailable() {
  // `resetRecorder` est défini plus bas : on teste sa présence pour éviter
  // une ReferenceError si le widget n'a pas été initialisé (nav sans
  // MediaRecorder par ex.).
  if (typeof resetRecorder === 'function') resetRecorder();
}

// ── UI de compression ────────────────────────────────────────────────
const compressStatus  = document.getElementById('compress-status');
const compressText    = document.getElementById('compress-text');
const compressBar     = document.getElementById('compress-bar-fill');
const compressElapsed = document.getElementById('compress-elapsed');
const compressMeta    = document.getElementById('compress-meta');
const compressCancel  = document.getElementById('compress-cancel');

let compressStart = 0;
let compressTimer = null;
let activeCompressAbort = null;

function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

function showCompressUI(label, fileSize) {
  compressText.textContent = label;
  compressBar.style.width = '0%';
  if (compressMeta) {
    compressMeta.textContent = fileSize ? `Source : ${fmtSize(fileSize)}` : '';
  }
  compressStatus.hidden = false;
  compressStart = Date.now();
  if (compressElapsed) compressElapsed.textContent = '00:00';
  if (compressTimer) clearInterval(compressTimer);
  compressTimer = setInterval(() => {
    if (compressElapsed) compressElapsed.textContent = fmtDuration(Date.now() - compressStart);
  }, 500);
}
function updateCompressUI(percent, status) {
  if (typeof percent === 'number') {
    compressBar.style.width = `${Math.round(percent * 100)}%`;
  }
  if (status) compressText.textContent = status;
}
function hideCompressUI() {
  compressStatus.hidden = true;
  compressBar.style.width = '0%';
  if (compressTimer) { clearInterval(compressTimer); compressTimer = null; }
  if (compressMeta) compressMeta.textContent = '';
}

if (compressCancel) {
  compressCancel.addEventListener('click', () => {
    if (activeCompressAbort) activeCompressAbort.abort();
  });
}

async function runCompression(file, label, signal) {
  if (!window.Compress) {
    return { blob: file, filename: file.name };
  }
  showCompressUI(label, file.size);
  try {
    const result = await window.Compress.compressIfNeeded(file, {
      onProgress: (p) => updateCompressUI(p),
      onStatus: (s) => updateCompressUI(null, `${label} : ${s}`),
      signal,
    });
    // Petit récap visuel avant de passer au suivant
    if (!result.skipped) {
      const ratio = Math.round((1 - result.compressed / result.original) * 100);
      const from = Math.round(result.original / 1024);
      const to   = Math.round(result.compressed / 1024);
      updateCompressUI(1, `${label} compressé : ${from} Ko → ${to} Ko (-${ratio}%)`);
      await sleep(400);
    }
    return result;
  } catch (err) {
    // L'utilisateur a cliqué Annuler : on remonte l'AbortError au submit
    // pour qu'il abandonne tout le pipeline (sans fallback sur l'original).
    if (err.name === 'AbortError') throw err;
    console.warn('compression error:', err);
    updateCompressUI(null, `${label} : compression ignorée (${err.message}), envoi du fichier original`);
    await sleep(600);
    return { blob: file, filename: file.name };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Lit les mentions inline @ stockées par js/inline-mentions.js dans
// `dataset.mentions` du textarea. Filtre celles dont le texte a été
// modifié après coup (offsets devenus invalides).
function readMentions(textarea, currentBody) {
  if (!textarea) return [];
  let raw;
  try { raw = JSON.parse(textarea.dataset.mentions || '[]'); }
  catch { return []; }
  if (!Array.isArray(raw) || !raw.length) return [];
  return raw.filter(m =>
    m && typeof m.start === 'number' && typeof m.end === 'number'
    && m.start >= 0 && m.end <= currentBody.length && m.start < m.end
    && (m.type === 'person' || m.type === 'place') && m.entityId
  );
}

// Extraction cohérente de l'identité du contributeur depuis un FormData.
// Tous les dialogs utilisent les mêmes noms de champs (name, writtenFrom,
// relationship, email) : voir le fieldset.contributor-id dans index.html.
// Retourne `personId` si l'utilisateur a piqué son nom dans l'autocomplétion.
function extractSubmittedBy(fd) {
  const out = {};
  for (const k of ['name', 'writtenFrom', 'relationship', 'email']) {
    const v = fd.get(k);
    if (v) out[k] = String(v).trim();
  }
  const pid = fd.get('personId');
  if (pid) out.personId = String(pid).trim();
  // Champ legacy `pseudo` pour les dialogs qui ne l'auraient pas encore migré.
  if (!out.name) {
    const p = fd.get('pseudo');
    if (p) out.name = String(p).trim();
  }
  return Object.keys(out).length ? out : undefined;
}

// Extrait l'objet newPerson (création à la volée d'une Personne dans le
// graphe) si l'utilisateur a rempli au moins un champ optionnel. N'est
// exploité par le serveur que si submittedBy.personId est vide : sinon
// le nom est déjà lié à une fiche existante.
function extractNewPerson(fd) {
  // confirmCreate: true par défaut. Si le nom typé ne matche aucune fiche,
  // le serveur en crée une (minimale si aucun champ optionnel n'est rempli,
  // enrichie sinon). Si le nom matche une fiche existante, le serveur lie
  // au personId trouvé et ignore newPerson : aucun doublon créé.
  const out = { confirmCreate: true };
  const year = fd.get('newPerson.birthYear');
  if (year && /^\d{3,4}$/.test(String(year))) out.birth = { year: Number(year) };
  const parents = [];
  const p1 = fd.get('newPerson.parent1Id');
  const p2 = fd.get('newPerson.parent2Id');
  if (p1) parents.push({ id: String(p1), kind: 'bio' });
  if (p2) parents.push({ id: String(p2), kind: 'bio' });
  if (parents.length) out.parents = parents;
  const bio = fd.get('newPerson.bio');
  if (bio && String(bio).trim()) out.bio = String(bio).trim();
  return out;
}

// ── Capture caméra / micro selon le type ───────────────────────────────
function updateStoryMediaVisibility() {
  const t = getStoryType();
  const textOnly = (t === 'text' || t === 'note');
  storyMediaLabel.hidden = textOnly;
  storyRecorder.hidden = textOnly || t !== 'audio';

  // Oriente l'accept du file input selon le type. Pas de `capture` pour la
  // vidéo : on veut laisser choisir un fichier existant (qu'on compresse
  // ensuite côté client) plutôt que forcer la caméra. Pour la photo, on
  // garde `environment` parce que prendre la photo sur place est le geste
  // attendu.
  const config = {
    photo:   { accept: 'image/*', capture: 'environment' },
    video:   { accept: 'video/*', capture: null },
    audio:   { accept: 'audio/*', capture: null },
    drawing: { accept: 'image/*', capture: null },
    note:    { accept: '', capture: null },
    text:    { accept: '', capture: null },
  }[t] || { accept: 'image/*,audio/*,video/*,application/pdf', capture: null };
  storyMediaInput.accept = config.accept || 'image/*,audio/*,video/*,application/pdf';
  if (config.capture) storyMediaInput.setAttribute('capture', config.capture);
  else storyMediaInput.removeAttribute('capture');
}

// Garde anti-double-submit : la compression vidéo peut prendre plusieurs
// minutes, et chaque clic sur Envoyer relance tout le pipeline (POST
// /api/stories + compression + upload média). Sans ce verrou, un
// utilisateur impatient se retrouve avec autant de tickets que de clics.
let storySubmitting = false;

formStory.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (storySubmitting) return;
  const placeId = formStory.dataset.placeId;
  if (!placeId) return;
  if (blockedByStaticMode('l\'ajout d\'un contenu')) return;
  const fd = new FormData(formStory);
  const submittedBy = extractSubmittedBy(fd);

  // Validation locale : si le conteur n'a pas été piqué dans
  // l'autocomplétion (pas de personId), on exige un nom complet pour
  // éviter de créer des fiches mononymes (« Léo », « Marc ») qui se
  // mêleront ensuite à toutes les futures fiches du même prénom. Mêmes
  // règles que côté serveur dans contributor.js → isCompleteName.
  if (submittedBy && submittedBy.name && !submittedBy.personId) {
    const tokens = submittedBy.name.trim().split(/\s+/).filter(t => t.length >= 2);
    if (tokens.length < 2) {
      alert(`Tape le nom complet du conteur (prénom et nom) ou choisis-le dans la liste suggérée.\n\n« ${submittedBy.name} » est trop court : ça créerait une fiche qui se mêlera à toutes les futures fiches portant ce prénom.`);
      return;
    }
  }

  const submitBtn = formStory.querySelector('button[type=submit]');
  storySubmitting = true;
  // Controller exposé au bouton « Annuler » de la barre de compression.
  // Réinitialisé à chaque submit pour ne pas hériter d'un abort précédent.
  activeCompressAbort = new AbortController();
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.dataset.origLabel = submitBtn.textContent;
    submitBtn.textContent = 'Envoi en cours…';
  }
  const bodyTextarea = formStory.querySelector('textarea[name=body]');
  const titleInput   = formStory.querySelector('input[name=title]');
  const payload = {
    placeId,
    type: fd.get('type'),
    title: fd.get('title'),
    body: fd.get('body'),
    memoryDate: fd.get('memoryDate'),
    mentions:      readMentions(bodyTextarea, fd.get('body')  || ''),
    titleMentions: readMentions(titleInput,   fd.get('title') || ''),
    visibility: fd.get('visibility') || 'members',
    consentGiven: true,           // implicite : la charte a été acceptée à l'inscription
    submittedBy,
    newPerson: extractNewPerson(fd),
  };
  try {
    const res = await fetch('/api/stories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);

    // Fichiers sélectionnés (plusieurs possibles) + enregistrement in-browser.
    // On passe chaque fichier dans le compresseur client avant upload.
    // Les légendes saisies sont envoyées dans des champs `captions[]` du
    // même ordre que les fichiers : multer les récupère via req.body.
    const mediaForm = new FormData();
    let added = 0;
    const filesToProcess = [...(storyMediaInput.files || [])];
    for (let idx = 0; idx < filesToProcess.length; idx++) {
      const file = filesToProcess[idx];
      if (!file || file.size <= 0) continue;
      const label = filesToProcess.length > 1
        ? `Fichier ${idx + 1}/${filesToProcess.length} : ${file.name}`
        : `${file.name}`;
      const result = await runCompression(file, label, activeCompressAbort.signal);
      mediaForm.append('media', result.blob, result.filename || file.name);
      const cap = document.querySelector(`#dlg-story input[name="caption_${idx}"]`)?.value || '';
      mediaForm.append('captions', cap);
      const ocr = document.querySelector(`#dlg-story textarea[name="ocr_${idx}"]`)?.value || '';
      mediaForm.append('ocrText', ocr);
      added++;
    }
    if (recordedBlob) {
      const ext = (recordedBlob.type.includes('webm') ? 'webm' : 'ogg');
      mediaForm.append('media', recordedBlob, `enregistrement-${Date.now()}.${ext}`);
      mediaForm.append('captions', '');   // pas de légende sur enregistrement direct
      mediaForm.append('ocrText', '');     // pas d'OCR sur enregistrement audio
      added++;
    }
    hideCompressUI();
    if (added > 0) {
      const mres = await fetch(`/api/stories/${encodeURIComponent(data.story.id)}/media`, {
        method: 'POST',
        body: mediaForm,
      });
      if (!mres.ok) {
        const mdata = await mres.json().catch(() => ({}));
        throw new Error(`Récit créé mais média refusé : ${mdata.error || mres.statusText}`);
      }
    }

    // Envoi réussi : on purge le brouillon de ce lieu pour ne pas le
    // re-proposer à la prochaine ouverture.
    clearDraft(placeId);
    dlgStory.close('submit');
    resetRecorder();
    alert(data.message || 'Récit reçu. En attente de validation avant affichage public.');
  } catch (err) {
    // Annulation par le bouton « ✕ Annuler » de la barre : on ne pollue
    // pas l'utilisateur avec une alerte d'erreur. Le récit créé côté
    // serveur (pré-compression) reste à l'état pending sans média : il
    // sera nettoyé par modération (refus). Le brouillon est conservé.
    if (err.name !== 'AbortError') {
      alert('Erreur : ' + err.message);
    }
  } finally {
    storySubmitting = false;
    activeCompressAbort = null;
    hideCompressUI();
    if (submitBtn) {
      submitBtn.disabled = false;
      if (submitBtn.dataset.origLabel) {
        submitBtn.textContent = submitBtn.dataset.origLabel;
        delete submitBtn.dataset.origLabel;
      }
    }
  }
});

// ── Enregistrement audio in-browser ────────────────────────────────────
// On utilise MediaRecorder. Fallback : si l'API n'est pas dispo, on
// masque le widget et le contributeur utilise le file input.
let mediaRecorder = null;
let recordedChunks = [];
let recordedBlob = null;
let recordingStream = null;
let recordingStarted = 0;
let recordingTimer = null;

const recStart = document.getElementById('rec-start');
const recStop  = document.getElementById('rec-stop');
const recRedo  = document.getElementById('rec-redo');
const recLive  = document.getElementById('rec-live');
const recPreview = document.getElementById('rec-preview');
const recError = document.getElementById('rec-error');
const recTimer = document.getElementById('rec-timer');
const recPlayback = document.getElementById('rec-playback');

function hasMediaRecorder() {
  return typeof MediaRecorder !== 'undefined'
      && navigator.mediaDevices
      && typeof navigator.mediaDevices.getUserMedia === 'function';
}

if (!hasMediaRecorder()) {
  // Cache le widget, laisse juste le file input.
  storyRecorder.hidden = true;
}

function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

recStart.addEventListener('click', async () => {
  recError.hidden = true;
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    recError.textContent = 'Accès au micro refusé ou indisponible : ' + err.message;
    recError.hidden = false;
    return;
  }
  const mimeType = pickMimeType();
  try {
    mediaRecorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined);
  } catch (err) {
    recError.textContent = 'Enregistrement impossible sur ce navigateur : ' + err.message;
    recError.hidden = false;
    recordingStream.getTracks().forEach(t => t.stop());
    return;
  }
  recordedChunks = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.onstop = () => {
    recordedBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    recPlayback.src = URL.createObjectURL(recordedBlob);
    recLive.hidden = true;
    recStart.hidden = true;
    recPreview.hidden = false;
    if (recordingStream) {
      recordingStream.getTracks().forEach(t => t.stop());
      recordingStream = null;
    }
    if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null; }
  };
  mediaRecorder.start();
  recordingStarted = Date.now();
  recStart.hidden = true;
  recLive.hidden = false;
  recPreview.hidden = true;
  recordingTimer = setInterval(() => {
    const s = Math.floor((Date.now() - recordingStarted) / 1000);
    recTimer.textContent = `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  }, 250);
});

recStop.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
});

recRedo.addEventListener('click', () => {
  resetRecorder();
});

function resetRecorder() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    try { mediaRecorder.stop(); } catch {}
  }
  if (recordingStream) {
    recordingStream.getTracks().forEach(t => t.stop());
    recordingStream = null;
  }
  if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null; }
  mediaRecorder = null;
  recordedChunks = [];
  recordedBlob = null;
  recPlayback.removeAttribute('src');
  recLive.hidden = true;
  recPreview.hidden = true;
  recError.hidden = true;
  recStart.hidden = false;
  recTimer.textContent = '00:00';
}

// ── Flux 3 : proposer une modification (style Wikipédia) ───────────────
const VISIBILITY_OPTIONS = [
  { value: 'members', label: 'Membres (réservé aux personnes connectées)' },
  { value: 'public',  label: 'Public (visible aussi par les visiteurs anonymes)' },
];
const EDIT_FIELDS = {
  places: [
    { key: 'primaryName', label: 'Nom principal', type: 'text', required: true },
    { key: 'description', label: 'Description', type: 'textarea', rows: 4 },
    { key: 'visibility',  label: 'Visibilité',   type: 'radio', options: VISIBILITY_OPTIONS },
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
    { key: 'visibility', label: 'Visibilité', type: 'radio', options: VISIBILITY_OPTIONS },
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
    if (f.type === 'radio') {
      const opts = (f.options || []).map(o => `
        <label class="visibility-option">
          <input type="radio" name="${f.key}" value="${escapeAttr(o.value)}"${o.value === val ? ' checked' : ''} />
          <span>${escapeHtml(o.label)}</span>
        </label>
      `).join('');
      return `
        <fieldset class="visibility-choice">
          <legend>${escapeHtml(f.label)}</legend>
          ${opts}
        </fieldset>
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

  // Section images : seulement pour les récits.
  const mediaSection = document.getElementById('edit-media-section');
  if (mediaSection) {
    if (entityType === 'stories') { mediaSection.hidden = false; setupEditMedia(entity); }
    else { mediaSection.hidden = true; }
  }

  dlgEdit.showModal();
}

// ── Flux 4 : compléter une histoire ────────────────────────────────────
function openCompleteDialog(story) {
  formComplete.reset();
  formComplete.dataset.storyId = story.id;
  const title = story.title || '(sans titre)';
  document.getElementById('complete-story-title').textContent = `Pour : ${title}`;
  dlgComplete.showModal();
}

formComplete.addEventListener('submit', async (e) => {
  e.preventDefault();
  const storyId = formComplete.dataset.storyId;
  if (!storyId) return;
  const fd = new FormData(formComplete);
  if (blockedByStaticMode('la complétion d\'une histoire')) return;

  const bodyTextarea = formComplete.querySelector('textarea[name=body]');
  const payload = {
    body: fd.get('body') || '',
    mentions: readMentions(bodyTextarea, fd.get('body') || ''),
    consentGiven: true,           // implicite : la charte a été acceptée à l'inscription
    submittedBy: extractSubmittedBy(fd),
    newPerson: extractNewPerson(fd),
  };
  try {
    const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    dlgComplete.close('submit');
    alert(data.message || 'Complétion reçue : en attente de validation.');
  } catch (err) {
    alert('Erreur : ' + err.message);
  }
});

// Dialog : modifier une complétion
function openEditCompletionDialog(story, completion) {
  const form = document.getElementById('form-edit-completion');
  const dlg = document.getElementById('dlg-edit-completion');
  form.reset();
  form.dataset.storyId = story.id;
  form.dataset.completionId = completion.id;
  document.getElementById('edit-completion-info').textContent =
    `Complétion sur « ${story.title || story.id} » par ${completion.submittedBy?.name || 'Anonyme'}`;
  form.querySelector('textarea[name="body"]').value = completion.body || '';
  dlg.showModal();
}
document.getElementById('dlg-edit-completion').querySelectorAll('[data-close]').forEach(b =>
  b.addEventListener('click', () => document.getElementById('dlg-edit-completion').close('cancel'))
);
document.getElementById('form-edit-completion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const sid = form.dataset.storyId;
  const cid = form.dataset.completionId;
  if (!sid || !cid) return;
  if (blockedByStaticMode('la modification d\'une complétion')) return;
  const fd = new FormData(form);
  const newBody = (fd.get('body') || '').trim();
  const payload = {
    changes: { body: newBody },
    note: fd.get('note') || '',
    submittedBy: extractSubmittedBy(fd),
    newPerson: extractNewPerson(fd),
  };
  try {
    const res = await fetch(`/api/stories/${encodeURIComponent(sid)}/completions/${encodeURIComponent(cid)}/edits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    document.getElementById('dlg-edit-completion').close('submit');
    alert(data.message || 'Proposition envoyée : en attente de validation.');
  } catch (err) {
    alert('Erreur : ' + err.message);
  }
});

formEdit.addEventListener('submit', async (e) => {
  e.preventDefault();
  const entityType = formEdit.dataset.entityType;
  const entityId = formEdit.dataset.entityId;
  const original = JSON.parse(formEdit.dataset.originalData || '{}');
  const fd = new FormData(formEdit);

  const changes = {};
  for (const [k, v] of fd.entries()) {
    if (k === 'note' || k === 'pseudo') continue;
    // Champs de la section média (légendes / OCR) : ne pas confondre avec
    // les champs éditables texte.
    if (/^caption_\d+$/.test(k) || /^ocr_\d+$/.test(k)) continue;
    if (String(original[k] ?? '') !== String(v ?? '')) {
      changes[k] = v;
    }
  }

  const isStory = entityType === 'stories';
  const hasMediaOps = isStory && (
    (editMediaInput && editMediaInput.files && editMediaInput.files.length > 0) ||
    editMediaToDelete.size > 0
  );

  if (Object.keys(changes).length === 0 && !hasMediaOps) {
    alert('Aucun changement détecté.');
    return;
  }
  if (blockedByStaticMode('la proposition de modification')) return;

  try {
    // 1) Changements texte → proposition de modification (modération).
    if (Object.keys(changes).length > 0) {
      const payload = {
        changes,
        note: fd.get('note') || '',
        submittedBy: extractSubmittedBy(fd),
        newPerson: extractNewPerson(fd),
      };
      const res = await fetch(`/api/${entityType}/${encodeURIComponent(entityId)}/edits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
    }

    // 2) Médias (immédiat, membres) : suppressions puis ajouts.
    if (hasMediaOps) {
      for (const url of editMediaToDelete) {
        const r = await fetch(`/api/stories/${encodeURIComponent(entityId)}/media`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ url }),
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || r.statusText); }
      }
      await uploadNewMedia(entityId, editMediaInput, '#dlg-edit');
      hideCompressUI();
    }

    dlgEdit.close('submit');
    const txtMsg = Object.keys(changes).length
      ? 'Proposition de texte envoyée (en attente de validation).'
      : '';
    const medMsg = hasMediaOps ? ' Images mises à jour.' : '';
    alert((txtMsg + medMsg).trim() || 'Modifications enregistrées.');
    if (hasMediaOps) location.reload();
  } catch (err) {
    alert('Erreur : ' + err.message);
  }
});
