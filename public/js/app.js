// Mémoire des Cévennes — frontend v0.2
// Architecture :
//   - 3 entités chargées au boot (places, people, stories) depuis /api/* en
//     mode serveur, ou depuis /data/*.json en statique (GitHub Pages).
//   - Un panneau latéral polymorphe qui affiche soit un Lieu, soit une Personne.
//   - Routing hash-based : #/lieu/<id>, #/personne/<id>, #/recit/<id>.
//   - Mentions dans le corps des récits rendues comme <a> cliquables (naviguent
//     via le hash, donc boutons ← → du navigateur marchent nativement).

// ─── Config ─────────────────────────────────────────────────────────────
const CEVENNES_CENTER = [44.25, 3.75];
const CEVENNES_ZOOM = 10;

const state = {
  mode: 'live',           // 'live' (API) ou 'static' (GitHub Pages)
  places: new Map(),      // id -> place
  people: new Map(),      // id -> person
  stories: [],            // liste ordonnée
  markers: new Map(),     // placeId -> Leaflet marker
};

// ─── Carte ──────────────────────────────────────────────────────────────
const map = L.map('map', { zoomControl: true }).setView(CEVENNES_CENTER, CEVENNES_ZOOM);
L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap France | © OpenStreetMap contributors',
}).addTo(map);

// ─── DOM refs ───────────────────────────────────────────────────────────
const panel = document.getElementById('panel');
const panelContent = document.getElementById('panel-content');
const readonlyBanner = document.getElementById('readonly-banner');
const addBtn = document.getElementById('btn-add-place');
const addHint = document.getElementById('add-hint');

const dlgPlace = document.getElementById('dlg-place');
const formPlace = document.getElementById('form-place');
const dlgStory = document.getElementById('dlg-story');
const formStory = document.getElementById('form-story');
const storyType = document.getElementById('story-type');
const storyMediaLabel = document.getElementById('story-media-label');

document.getElementById('panel-close').addEventListener('click', closePanel);
dlgStory.querySelectorAll('[data-close]').forEach(b =>
  b.addEventListener('click', () => dlgStory.close('cancel'))
);
storyType.addEventListener('change', updateStoryMediaVisibility);
updateStoryMediaVisibility();

// ─── Chargement données ─────────────────────────────────────────────────
async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function fetchAll() {
  // On tente d'abord l'API. Si elle ne répond pas (GitHub Pages), on bascule
  // sur les fichiers statiques.
  try {
    const [pls, ppl, sts] = await Promise.all([
      fetchJson('/api/places'),
      fetchJson('/api/people'),
      fetchJson('/api/stories'),
    ]);
    state.mode = 'live';
    return { places: pls.places, people: ppl.people, stories: sts.stories };
  } catch {
    state.mode = 'static';
    const [pls, ppl, sts] = await Promise.all([
      fetchJson('data/places.json'),
      fetchJson('data/people.json'),
      fetchJson('data/stories.json'),
    ]);
    return {
      places: (pls.places || []).filter(p => p.status === 'approved'),
      people: (ppl.people || []).filter(p => p.status === 'approved'),
      stories: (sts.stories || []).filter(s => s.status === 'approved'),
    };
  }
}

async function reload() {
  const { places, people, stories } = await fetchAll();
  state.places.clear();
  state.people.clear();
  places.forEach(p => state.places.set(p.id, p));
  people.forEach(p => state.people.set(p.id, p));
  state.stories = stories;
  refreshMarkers();
  applyMode();
  routeFromHash();
}

function refreshMarkers() {
  state.markers.forEach(m => map.removeLayer(m));
  state.markers.clear();
  for (const p of state.places.values()) {
    const marker = L.marker([p.lat, p.lng], { title: p.primaryName });
    marker.bindTooltip(p.primaryName);
    marker.on('click', () => navigateTo('lieu', p.id));
    marker.addTo(map);
    state.markers.set(p.id, marker);
  }
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

// ─── Routage hash ───────────────────────────────────────────────────────
function parseHash() {
  const h = (location.hash || '').replace(/^#\/?/, '');
  const [type, id] = h.split('/').map(decodeURIComponent);
  if (!type || !id) return null;
  return { type, id };
}

function navigateTo(type, id) {
  const target = `#/${type}/${encodeURIComponent(id)}`;
  if (location.hash !== target) location.hash = target;
  else routeFromHash();
}

window.addEventListener('hashchange', routeFromHash);

function routeFromHash() {
  const route = parseHash();
  if (!route) { closePanel(); return; }
  if (route.type === 'lieu') return openPlacePanel(route.id);
  if (route.type === 'personne') return openPersonPanel(route.id);
  if (route.type === 'recit') return openStoryFocus(route.id);
  closePanel();
}

// ─── Panneau ────────────────────────────────────────────────────────────
function openPanel(html) {
  panelContent.innerHTML = html;
  panel.setAttribute('aria-hidden', 'false');
  document.body.classList.add('panel-open');
  // délégation de clic pour les mentions internes
  panelContent.querySelectorAll('a.mention').forEach(a => {
    a.addEventListener('click', (e) => {
      const [, type, id] = (a.getAttribute('href') || '').split('/');
      if (type && id) {
        e.preventDefault();
        navigateTo(type, decodeURIComponent(id));
      }
    });
  });
  const addStoryBtn = panelContent.querySelector('.btn-add-story');
  if (addStoryBtn) {
    const placeId = addStoryBtn.dataset.placeId;
    addStoryBtn.addEventListener('click', () => openStoryDialog(placeId));
  }
}

function closePanel() {
  panel.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('panel-open');
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

function openPlacePanel(placeId) {
  const place = state.places.get(placeId);
  if (!place) {
    openPanel(`<p class="desc">Lieu introuvable (<code>${escapeHtml(placeId)}</code>).</p>`);
    return;
  }
  const related = state.stories.filter(s =>
    s.placeId === placeId ||
    (s.mentions || []).some(m => m.type === 'place' && m.entityId === placeId)
  );
  const aliases = (place.aliases || []).map(a => {
    const ctx = [a.context, periodLabel(a)].filter(Boolean).join(' · ');
    return `<span class="chip">${escapeHtml(a.name)}${ctx ? ` <em>(${escapeHtml(ctx)})</em>` : ''}</span>`;
  }).join('');

  const addStoryBtn = state.mode === 'live'
    ? `<div class="add-story"><button class="btn-primary btn-add-story" type="button" data-place-id="${escapeAttr(place.id)}">+ Ajouter un contenu</button></div>`
    : '';

  openPanel(`
    <div class="entity-header">
      <span class="entity-kind">📍 Lieu</span>
      <h2>${escapeHtml(place.primaryName)}</h2>
      ${aliases ? `<div class="aliases">aussi appelé ${aliases}</div>` : ''}
    </div>
    ${place.description ? `<p class="desc">${escapeHtml(place.description)}</p>` : ''}
    ${addStoryBtn}
    <h3 class="section-title">Récits (${related.length})</h3>
    ${related.length === 0
      ? '<p class="desc"><em>Aucun récit pour l\\'instant.</em></p>'
      : related.map(renderStoryCard).join('')}
  `);
}

function openPersonPanel(personId) {
  const person = state.people.get(personId);
  if (!person) {
    openPanel(`<p class="desc">Personne introuvable (<code>${escapeHtml(personId)}</code>).</p>`);
    return;
  }
  const aliases = (person.aliases || []).map(a => {
    const ctx = [a.context, periodLabel(a)].filter(Boolean).join(' · ');
    return `<span class="chip">${escapeHtml(a.name)}${ctx ? ` <em>(${escapeHtml(ctx)})</em>` : ''}</span>`;
  }).join('');

  // Relations
  const children = [...state.people.values()]
    .filter(p => (p.parents || []).some(par => par.id === person.id))
    .map(p => p.id);
  const parentLinks = (person.parents || []).map(p => inlineEntity('personne', p.id)).join(', ');
  const spouseLinks = (person.spouses || []).map(s => {
    const span = [s.start, s.end].filter(Boolean).join('–');
    return `${inlineEntity('personne', s.id)}${span ? ` <small>(${span})</small>` : ''}`;
  }).join(', ');
  const childLinks = children.map(id => inlineEntity('personne', id)).join(', ');

  // Récits contributrice / mentionnée
  const asContrib = state.stories.filter(s => s.contributorId === person.id);
  const asMention = state.stories.filter(s =>
    (s.mentions || []).some(m => m.type === 'person' && m.entityId === person.id)
    && s.contributorId !== person.id
  );

  const dates = [
    person.birth && `né·e en ${eventLabel(person.birth)}`,
    person.death && `† ${eventLabel(person.death)}`,
  ].filter(Boolean).join(' · ');

  openPanel(`
    <div class="entity-header">
      <span class="entity-kind">👤 Personne</span>
      <h2>${escapeHtml(person.primaryName)}${person.maidenName ? ` <small>(née ${escapeHtml(person.maidenName)})</small>` : ''}</h2>
      ${aliases ? `<div class="aliases">aussi appelé·e ${aliases}</div>` : ''}
      ${dates ? `<div class="dates">${dates}</div>` : ''}
    </div>
    ${person.bio ? `<p class="desc">${escapeHtml(person.bio)}</p>` : ''}

    ${(parentLinks || spouseLinks || childLinks) ? `
      <h3 class="section-title">Famille</h3>
      <ul class="relations">
        ${parentLinks ? `<li><strong>Parents :</strong> ${parentLinks}</li>` : ''}
        ${spouseLinks ? `<li><strong>Uni·e à :</strong> ${spouseLinks}</li>` : ''}
        ${childLinks  ? `<li><strong>Enfants :</strong> ${childLinks}</li>` : ''}
      </ul>
    ` : ''}

    <h3 class="section-title">Récits où elle/il contribue (${asContrib.length})</h3>
    ${asContrib.length ? asContrib.map(renderStoryCard).join('') : '<p class="desc"><em>Aucun.</em></p>'}

    <h3 class="section-title">Récits où elle/il est mentionné·e (${asMention.length})</h3>
    ${asMention.length ? asMention.map(renderStoryCard).join('') : '<p class="desc"><em>Aucun.</em></p>'}
  `);
}

function openStoryFocus(storyId) {
  const story = state.stories.find(s => s.id === storyId);
  if (!story) {
    openPanel(`<p class="desc">Récit introuvable.</p>`);
    return;
  }
  openPanel(`
    <div class="entity-header">
      <span class="entity-kind">📖 Récit</span>
      <h2>${escapeHtml(story.title || '(sans titre)')}</h2>
      ${story.placeId ? `<div class="dates">ancré sur ${inlineEntity('lieu', story.placeId)}</div>` : ''}
    </div>
    ${renderStoryCard(story, { full: true })}
  `);
}

// ─── Rendu récit ────────────────────────────────────────────────────────
function renderStoryCard(s, { full = false } = {}) {
  const typeLabel = {
    text: 'Histoire', photo: 'Photo', audio: 'Audio',
    video: 'Vidéo', drawing: 'Dessin', note: 'Note',
  }[s.type] || s.type;
  const dateBits = [
    s.memoryDate,
    s.createdAt ? `ajouté ${new Date(s.createdAt).toLocaleDateString('fr-FR')}` : null,
  ].filter(Boolean).join(' · ');
  const contribHtml = s.contributorId
    ? `par ${inlineEntity('personne', s.contributorId)}`
    : '';
  const meta = [contribHtml, dateBits].filter(Boolean).join(' · ');

  const media = (s.mediaFiles || []).map(f => {
    if (!f.url) return '';
    if (f.mime && f.mime.startsWith('image/')) return `<img src="${f.url}" loading="lazy" alt="" />`;
    if (f.mime && f.mime.startsWith('audio/')) return `<audio controls preload="metadata" src="${f.url}"></audio>`;
    if (f.mime && f.mime.startsWith('video/')) return `<video controls preload="metadata" src="${f.url}" style="max-width:100%"></video>`;
    return `<p><a href="${f.url}" target="_blank" rel="noopener">Ouvrir le document</a></p>`;
  }).join('');

  return `
    <article class="story">
      <h3>
        <span class="type-badge">${typeLabel}</span>
        <a href="#/recit/${encodeURIComponent(s.id)}" class="story-title">${escapeHtml(s.title || '(sans titre)')}</a>
      </h3>
      ${meta ? `<div class="meta">${meta}</div>` : ''}
      ${s.body ? `<div class="body">${renderBodyWithMentions(s.body, s.mentions)}</div>` : ''}
      ${media}
    </article>
  `;
}

function renderBodyWithMentions(body, mentions) {
  if (!mentions || !mentions.length) return escapeHtml(body);
  const sorted = [...mentions].sort((a, b) => a.start - b.start);
  let html = '';
  let pos = 0;
  for (const m of sorted) {
    if (m.start < pos || m.end > body.length) continue;
    html += escapeHtml(body.slice(pos, m.start));
    const span = body.slice(m.start, m.end);
    html += inlineMention(m.type, m.entityId, span);
    pos = m.end;
  }
  html += escapeHtml(body.slice(pos));
  return html;
}

function inlineMention(type, id, span) {
  const label = type === 'person'
    ? (state.people.get(id)?.primaryName || id)
    : (state.places.get(id)?.primaryName || id);
  const typeSlug = type === 'person' ? 'personne' : 'lieu';
  const cls = `mention mention-${type}`;
  return `<a href="#/${typeSlug}/${encodeURIComponent(id)}" class="${cls}" title="${escapeAttr(label)}">${escapeHtml(span)}</a>`;
}

function inlineEntity(typeSlug, id) {
  if (!id) return '';
  const entity = typeSlug === 'personne' ? state.people.get(id) : state.places.get(id);
  const name = entity ? entity.primaryName : id;
  const type = typeSlug === 'personne' ? 'person' : 'place';
  return `<a href="#/${typeSlug}/${encodeURIComponent(id)}" class="mention mention-${type}">${escapeHtml(name)}</a>`;
}

// ─── Helpers ────────────────────────────────────────────────────────────
function periodLabel(a) {
  if (a.startYear && a.endYear) return `${a.startYear}–${a.endYear}`;
  if (a.startYear) return `depuis ${a.startYear}`;
  if (a.endYear) return `jusqu'à ${a.endYear}`;
  return '';
}
function eventLabel(e) {
  if (!e) return '';
  const parts = [e.year, e.month ? String(e.month).padStart(2, '0') : null, e.day ? String(e.day).padStart(2, '0') : null].filter(Boolean);
  return parts.join('-');
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str);
}

// ─── Ajout lieu / récit (mode live uniquement) ─────────────────────────
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

    // Upload média si présent
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

// ─── Bootstrap ──────────────────────────────────────────────────────────
reload().catch(err => {
  console.error(err);
  openPanel(`<p class="desc">Erreur au chargement : ${escapeHtml(err.message)}</p>`);
});
