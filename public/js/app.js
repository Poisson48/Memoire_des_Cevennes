// Mémoire des Cévennes — frontend
// Carte Leaflet + panneau latéral pour les lieux et contenus.
// Fonctionne en deux modes :
//   - "live" : servi par server.js (Express), lecture + écriture via /api.
//   - "static" : servi en statique (GitHub Pages), lecture seule depuis data/places.json.

const CEVENNES_CENTER = [44.25, 3.75];
const CEVENNES_ZOOM = 10;

const state = {
  mode: 'live', // basculé à 'static' si l'API /api/places n'est pas joignable
};

const map = L.map('map', { zoomControl: true }).setView(CEVENNES_CENTER, CEVENNES_ZOOM);

L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap France | © OpenStreetMap contributors',
}).addTo(map);

const panel = document.getElementById('panel');
const panelContent = document.getElementById('panel-content');
document.getElementById('panel-close').addEventListener('click', closePanel);

const dlgPlace = document.getElementById('dlg-place');
const formPlace = document.getElementById('form-place');
const dlgStory = document.getElementById('dlg-story');
const formStory = document.getElementById('form-story');
const storyType = document.getElementById('story-type');
const storyMediaLabel = document.getElementById('story-media-label');
const readonlyBanner = document.getElementById('readonly-banner');

dlgStory.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => dlgStory.close('cancel'));
});

storyType.addEventListener('change', updateStoryMediaVisibility);
updateStoryMediaVisibility();

function updateStoryMediaVisibility() {
  const t = storyType.value;
  const mediaHidden = (t === 'text' || t === 'note');
  storyMediaLabel.hidden = mediaHidden;
}

// ---- Ajout d'un lieu ----------------------------------------------------
let addMode = false;
let pendingLatLng = null;
const addBtn = document.getElementById('btn-add-place');
const addHint = document.getElementById('add-hint');

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
    resetAddMode();
    return;
  }
  const fd = new FormData(formPlace);
  const payload = {
    title: fd.get('title'),
    description: fd.get('description'),
    lat: pendingLatLng.lat,
    lng: pendingLatLng.lng,
  };
  try {
    const res = await fetch('/api/places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    const { place } = await res.json();
    addMarker(place);
    openPanel(place);
  } catch (err) {
    alert('Erreur lors de la création du lieu : ' + err.message);
  } finally {
    resetAddMode();
  }
});

function resetAddMode() {
  addMode = false;
  pendingLatLng = null;
  addHint.hidden = true;
  addBtn.textContent = '+ Ajouter un lieu';
  map.getContainer().style.cursor = '';
}

// ---- Markers -----------------------------------------------------------
const markersById = new Map();

function addMarker(place) {
  const m = L.marker([place.lat, place.lng], { title: place.title });
  m.on('click', () => openPanel(place));
  m.bindTooltip(place.title);
  m.addTo(map);
  markersById.set(place.id, { marker: m, place });
}

async function fetchPlaces() {
  try {
    const res = await fetch('/api/places', { cache: 'no-store' });
    if (res.ok) {
      state.mode = 'live';
      const { places } = await res.json();
      return places;
    }
    throw new Error('api not ok');
  } catch {
    state.mode = 'static';
    const res = await fetch('data/places.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('Impossible de charger les lieux.');
    const data = await res.json();
    return data.places || [];
  }
}

async function reloadMarkers() {
  const places = await fetchPlaces();
  markersById.forEach(({ marker }) => map.removeLayer(marker));
  markersById.clear();
  places.forEach(addMarker);
  applyMode();
}

function applyMode() {
  if (state.mode === 'static') {
    readonlyBanner.hidden = false;
    addBtn.textContent = '🔒 Lecture seule';
    addBtn.classList.add('btn-locked');
  } else {
    readonlyBanner.hidden = true;
    addBtn.classList.remove('btn-locked');
  }
}

// ---- Panneau latéral ---------------------------------------------------
let currentPlaceId = null;

async function openPanel(place) {
  currentPlaceId = place.id;
  let p = place;
  if (state.mode === 'live') {
    const fresh = await fetch(`/api/places/${encodeURIComponent(place.id)}`)
      .then(r => r.ok ? r.json() : null)
      .then(j => j && j.place)
      .catch(() => null);
    p = fresh || place;
  }
  panelContent.innerHTML = renderPlace(p);
  panel.setAttribute('aria-hidden', 'false');
  document.body.classList.add('panel-open');

  const btn = panelContent.querySelector('.btn-add-story');
  if (btn) btn.addEventListener('click', () => openStoryDialog(p));
}

function closePanel() {
  panel.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('panel-open');
  currentPlaceId = null;
}

function renderPlace(p) {
  const stories = (p.stories || []).slice().reverse();
  const addStoryBtn = state.mode === 'live'
    ? '<div class="add-story"><button class="btn-primary btn-add-story" type="button">+ Ajouter un contenu</button></div>'
    : '';
  return `
    <h2>${escapeHtml(p.title)}</h2>
    <p class="desc">${escapeHtml(p.description || '')}</p>
    ${addStoryBtn}
    ${stories.length === 0
      ? '<p class="desc"><em>Aucun contenu pour l\\'instant.</em></p>'
      : stories.map(renderStory).join('')}
  `;
}

function renderStory(s) {
  const typeLabel = {
    text: 'Histoire', photo: 'Photo', audio: 'Audio',
    drawing: 'Dessin', note: 'Note',
  }[s.type] || s.type;

  let media = '';
  if (s.mediaUrl) {
    if (s.mediaMime && s.mediaMime.startsWith('image/')) {
      media = `<img src="${s.mediaUrl}" alt="${escapeHtml(s.title || '')}" loading="lazy" />`;
    } else if (s.mediaMime && s.mediaMime.startsWith('audio/')) {
      media = `<audio controls preload="metadata" src="${s.mediaUrl}"></audio>`;
    } else {
      media = `<p><a href="${s.mediaUrl}" target="_blank" rel="noopener">Ouvrir le fichier</a></p>`;
    }
  }

  const date = s.createdAt ? new Date(s.createdAt).toLocaleDateString('fr-FR') : '';
  const metaBits = [s.author, date].filter(Boolean).join(' · ');

  return `
    <article class="story">
      <h3><span class="type-badge">${typeLabel}</span>${escapeHtml(s.title || '(sans titre)')}</h3>
      ${metaBits ? `<div class="meta">${escapeHtml(metaBits)}</div>` : ''}
      ${s.body ? `<div class="body">${escapeHtml(s.body)}</div>` : ''}
      ${media}
    </article>
  `;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// ---- Ajout d'un contenu ------------------------------------------------
function openStoryDialog(place) {
  formStory.reset();
  updateStoryMediaVisibility();
  document.getElementById('story-place-name').textContent = `Pour : ${place.title}`;
  dlgStory.showModal();
}

formStory.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentPlaceId) return;
  const fd = new FormData(formStory);
  try {
    const res = await fetch(`/api/places/${encodeURIComponent(currentPlaceId)}/stories`, {
      method: 'POST',
      body: fd,
    });
    if (!res.ok) throw new Error(await res.text());
    dlgStory.close('submit');
    const placeRes = await fetch(`/api/places/${encodeURIComponent(currentPlaceId)}`);
    const { place } = await placeRes.json();
    panelContent.innerHTML = renderPlace(place);
    const btn = panelContent.querySelector('.btn-add-story');
    if (btn) btn.addEventListener('click', () => openStoryDialog(place));
  } catch (err) {
    alert('Erreur lors de l\'ajout : ' + err.message);
  }
});

// ---- Bootstrap ---------------------------------------------------------
reloadMarkers().catch(err => {
  console.error(err);
  panelContent.innerHTML = `<p class="desc">Erreur : ${escapeHtml(err.message)}</p>`;
  panel.setAttribute('aria-hidden', 'false');
});
