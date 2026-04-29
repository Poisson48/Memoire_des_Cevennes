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
storyType.addEventListener('change', updateStoryMediaVisibility);
updateStoryMediaVisibility();

// Rendu dynamique des prévisualisations + champ « Légende » par fichier
// sélectionné. Mis à jour à chaque changement de l'input fichier.
storyMediaInput.addEventListener('change', renderMediaCaptions);
function renderMediaCaptions() {
  const div = document.getElementById('story-media-captions');
  if (!div) return;
  div.innerHTML = '';
  const files = Array.from(storyMediaInput.files || []);
  if (!files.length) return;
  files.forEach((f, i) => {
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
    row.appendChild(thumb);
    row.appendChild(right);
    div.appendChild(row);
  });
}

// ── Flux 1 : ajouter un lieu ───────────────────────────────────────────
// `state.addMode` est partagé (défini dans app.js) — on en lit la valeur
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
// position pendant que la modale est ouverte — bouton « Utiliser ma
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
  updateStoryMediaVisibility();
  formStory.dataset.placeId = placeId;
  const place = state.places.get(placeId);
  document.getElementById('story-place-name').textContent = `Pour : ${place ? place.primaryName : placeId}`;
  dlgStory.showModal();
}

function resetRecorderIfAvailable() {
  // `resetRecorder` est défini plus bas — on teste sa présence pour éviter
  // une ReferenceError si le widget n'a pas été initialisé (nav sans
  // MediaRecorder par ex.).
  if (typeof resetRecorder === 'function') resetRecorder();
}

// ── UI de compression ────────────────────────────────────────────────
const compressStatus = document.getElementById('compress-status');
const compressText   = document.getElementById('compress-text');
const compressBar    = document.getElementById('compress-bar-fill');

function showCompressUI(label) {
  compressText.textContent = label;
  compressBar.style.width = '0%';
  compressStatus.hidden = false;
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
}

async function runCompression(file, label) {
  if (!window.Compress) {
    return { blob: file, filename: file.name };
  }
  showCompressUI(label);
  try {
    const result = await window.Compress.compressIfNeeded(file, {
      onProgress: (p) => updateCompressUI(p),
      onStatus: (s) => updateCompressUI(null, `${label} — ${s}`),
    });
    // Petit récap visuel avant de passer au suivant
    if (!result.skipped) {
      const ratio = Math.round((1 - result.compressed / result.original) * 100);
      const from = Math.round(result.original / 1024);
      const to   = Math.round(result.compressed / 1024);
      updateCompressUI(1, `${label} — compressé : ${from} Ko → ${to} Ko (-${ratio}%)`);
      await sleep(400);
    }
    return result;
  } catch (err) {
    console.warn('compression error:', err);
    updateCompressUI(null, `${label} — compression ignorée (${err.message}), envoi du fichier original`);
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
// relationship, email) — voir le fieldset.contributor-id dans index.html.
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
// exploité par le serveur que si submittedBy.personId est vide — sinon
// le nom est déjà lié à une fiche existante.
function extractNewPerson(fd) {
  const out = {};
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
  return Object.keys(out).length ? out : undefined;
}

// ── Capture caméra / micro selon le type ───────────────────────────────
function updateStoryMediaVisibility() {
  const t = storyType.value;
  const textOnly = (t === 'text' || t === 'note');
  storyMediaLabel.hidden = textOnly;
  storyRecorder.hidden = textOnly || t !== 'audio';

  // Oriente l'accept du file input selon le type et, sur mobile, ouvre
  // directement l'appareil photo / caméra pour les photos et vidéos.
  const config = {
    photo:   { accept: 'image/*', capture: 'environment' },
    video:   { accept: 'video/*', capture: 'environment' },
    audio:   { accept: 'audio/*', capture: null },
    drawing: { accept: 'image/*', capture: null },
    note:    { accept: '', capture: null },
    text:    { accept: '', capture: null },
  }[t] || { accept: 'image/*,audio/*,video/*,application/pdf', capture: null };
  storyMediaInput.accept = config.accept || 'image/*,audio/*,video/*,application/pdf';
  if (config.capture) storyMediaInput.setAttribute('capture', config.capture);
  else storyMediaInput.removeAttribute('capture');
}

formStory.addEventListener('submit', async (e) => {
  e.preventDefault();
  const placeId = formStory.dataset.placeId;
  if (!placeId) return;
  if (blockedByStaticMode('l\'ajout d\'un contenu')) return;
  const fd = new FormData(formStory);
  const bodyTextarea = formStory.querySelector('textarea[name=body]');
  const titleInput   = formStory.querySelector('input[name=title]');
  const payload = {
    placeId,
    type: fd.get('type'),
    title: fd.get('title'),
    body: fd.get('body'),
    mentions:      readMentions(bodyTextarea, fd.get('body')  || ''),
    titleMentions: readMentions(titleInput,   fd.get('title') || ''),
    visibility: fd.get('visibility') || 'members',
    consentGiven: true,           // implicite : la charte a été acceptée à l'inscription
    submittedBy: extractSubmittedBy(fd),
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
    // même ordre que les fichiers — multer les récupère via req.body.
    const mediaForm = new FormData();
    let added = 0;
    const filesToProcess = [...(storyMediaInput.files || [])];
    for (let idx = 0; idx < filesToProcess.length; idx++) {
      const file = filesToProcess[idx];
      if (!file || file.size <= 0) continue;
      const label = filesToProcess.length > 1
        ? `Fichier ${idx + 1}/${filesToProcess.length} — ${file.name}`
        : `${file.name}`;
      const result = await runCompression(file, label);
      mediaForm.append('media', result.blob, result.filename || file.name);
      const cap = document.querySelector(`#dlg-story input[name="caption_${idx}"]`)?.value || '';
      mediaForm.append('captions', cap);
      added++;
    }
    if (recordedBlob) {
      const ext = (recordedBlob.type.includes('webm') ? 'webm' : 'ogg');
      mediaForm.append('media', recordedBlob, `enregistrement-${Date.now()}.${ext}`);
      mediaForm.append('captions', '');   // pas de légende sur enregistrement direct
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

    dlgStory.close('submit');
    resetRecorder();
    alert(data.message || 'Récit reçu. En attente de validation avant affichage public.');
  } catch (err) {
    alert('Erreur : ' + err.message);
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
    alert(data.message || 'Complétion reçue — en attente de validation.');
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
    alert(data.message || 'Proposition envoyée — en attente de validation.');
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
    if (String(original[k] ?? '') !== String(v ?? '')) {
      changes[k] = v;
    }
  }

  if (Object.keys(changes).length === 0) {
    alert('Aucun changement détecté.');
    return;
  }
  if (blockedByStaticMode('la proposition de modification')) return;

  const payload = {
    changes,
    note: fd.get('note') || '',
    submittedBy: extractSubmittedBy(fd),
    newPerson: extractNewPerson(fd),
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
