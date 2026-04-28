// Mémoire des Cévennes — frontend v0.2
// Architecture :
//   - 3 entités chargées au boot (places, people, stories) depuis /api/* en
//     mode serveur, ou depuis /data/*.json en statique (GitHub Pages).
//   - Un panneau latéral polymorphe qui affiche soit un Lieu, soit une Personne.
//   - Routing hash-based : #/lieu/<id>, #/personne/<id>, #/recit/<id>.
//   - Mentions dans le corps des récits rendues comme <a> cliquables (naviguent
//     via le hash, donc boutons ← → du navigateur marchent nativement).

// ─── Config ─────────────────────────────────────────────────────────────
// Le projet démarre focalisé sur Saint-Roman-de-Codières et ses alentours.
// Coordonnées de la Place de la Mairie (Nominatim/OSM 2026-04).
const DEFAULT_CENTER = [44.0027, 3.7786];   // Saint-Roman-de-Codières
const DEFAULT_ZOOM = 14;

const state = {
  mode: 'live',           // 'live' (API) ou 'static' (GitHub Pages)
  addMode: false,         // true quand l'utilisateur prépare la pose d'un lieu
  movePlaceId: null,      // si non null : ID du lieu en cours de déplacement (admin only)
  places: new Map(),      // id -> place
  people: new Map(),      // id -> person
  stories: [],            // liste ordonnée
  markers: new Map(),     // placeId -> Leaflet marker
  member: null,           // null ou { id, name, email, role, status } si connecté
};

// ─── Rôles ──────────────────────────────────────────────────────────────
const ROLES_ORDER = ['member', 'contributor', 'admin'];

/** Retourne true si le membre connecté a au moins le rôle minRole. */
function hasRole(minRole) {
  // Si le serveur a renvoyé un membre via /api/auth/me, le JWT était valide
  // au moment de la décodage — pas besoin de re-vérifier le status côté
  // client (le serveur a déjà refusé si status !== 'active' au login).
  if (!state.member) return false;
  return ROLES_ORDER.indexOf(state.member.role) >= ROLES_ORDER.indexOf(minRole);
}

// ─── Carte ──────────────────────────────────────────────────────────────
const map = L.map('map', { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
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
const authNav = document.getElementById('auth-nav'); // peut être null si absent du HTML

document.getElementById('panel-close').addEventListener('click', closePanel);
// Les dialogs (add-place / add-story / propose-edit) et leur logique vivent
// dans forms.js, chargé après app.js.

// Bandeau "lecture seule" : fermable, son état est mémorisé pour ne pas
// ré-apparaître à chaque visite.
const BANNER_DISMISSED_KEY = 'mdc-readonly-banner-dismissed';
document.getElementById('banner-close').addEventListener('click', () => {
  readonlyBanner.hidden = true;
  try { localStorage.setItem(BANNER_DISMISSED_KEY, '1'); } catch {}
});

// ─── Authentification ───────────────────────────────────────────────────
/**
 * Interroge /api/auth/me (cookie httpOnly envoyé automatiquement).
 * Remplit state.member ou le remet à null si non connecté / API absente.
 */
async function fetchMe() {
  if (state.mode === 'static') {
    state.member = null;
    return;
  }
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      state.member = data.member || null;
    } else {
      state.member = null;
    }
  } catch {
    state.member = null;
  }
}

/**
 * Met à jour le bloc de navigation auth (#auth-nav) :
 *   - non connecté → lien « Se connecter »
 *   - connecté     → nom + bouton « Déconnexion »
 */
function renderAuthNav() {
  // Cible les boutons du topbar de index.html.
  const loginBtn   = document.getElementById('btn-member-login');
  const logoutBtn  = document.getElementById('btn-member-logout');
  const greeting   = document.getElementById('member-greeting');

  if (!loginBtn || !logoutBtn || !greeting) {
    // Page sans ces hooks (login/register/admin) — rien à faire.
    return;
  }

  if (!state.member) {
    loginBtn.hidden  = false;
    logoutBtn.hidden = true;
    greeting.hidden  = true;
    return;
  }

  loginBtn.hidden  = true;
  logoutBtn.hidden = false;
  greeting.hidden  = false;
  greeting.textContent = `👤 ${state.member.name}`;

  // Branche le bouton de déconnexion (idempotent : on le rebranche à chaque rendu).
  logoutBtn.onclick = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch {}
    state.member = null;
    renderAuthNav();
    applyMode();
    location.reload();
  };
}

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
  // fetchMe en parallèle avec fetchAll pour ne pas ajouter de latence
  const [dataResult] = await Promise.all([
    fetchAll(),
    fetchMe(),
  ]);
  const { places, people, stories } = dataResult;
  state.places.clear();
  state.people.clear();
  places.forEach(p => state.places.set(p.id, p));
  people.forEach(p => state.people.set(p.id, p));
  state.stories = stories;
  refreshMarkers();
  applyMode();
  renderAuthNav();
  routeFromHash();
}

function refreshMarkers() {
  state.markers.forEach(m => map.removeLayer(m));
  state.markers.clear();
  for (const p of state.places.values()) {
    const marker = L.marker([p.lat, p.lng], { title: p.primaryName });
    marker.bindTooltip(p.primaryName);
    marker.on('click', (e) => {
      // En mode ajout d'un lieu, on laisse le clic « traverser » le
      // marqueur — l'utilisateur pose sa nouvelle épingle même s'il a
      // tapé tout près d'un marqueur existant. Sinon, Leaflet stoppe
      // la propagation et l'événement 'click' de la carte ne se déclenche
      // jamais (bug observé sur mobile près de Saint-Roman).
      if (state.addMode) {
        map.fire('click', { latlng: e.latlng || marker.getLatLng() });
        L.DomEvent.stop(e);
        return;
      }
      navigateTo('lieu', p.id);
    });
    marker.addTo(map);
    state.markers.set(p.id, marker);
  }
}

function applyMode() {
  // Bandeau lecture seule (mode statique GitHub Pages)
  if (state.mode === 'static') {
    const dismissed = (() => { try { return localStorage.getItem(BANNER_DISMISSED_KEY) === '1'; } catch { return false; } })();
    readonlyBanner.hidden = dismissed;
  } else {
    readonlyBanner.hidden = true;
  }

  // Bouton « + Ajouter un lieu » : visible uniquement pour contributor / admin.
  // Quand la personne n'a pas le rôle (anonyme ou simple member), on
  // remplace le bouton par un lien explicite vers /login.html, plutôt
  // que de juste le masquer (mauvaise UX, on ne sait pas pourquoi).
  if (addBtn) {
    const canAdd = state.mode === 'live' && hasRole('contributor');
    if (canAdd) {
      addBtn.hidden = false;
      addBtn.textContent = '+ Ajouter un lieu';
      addBtn.classList.remove('btn-locked');
      addBtn.disabled = false;
      addBtn.title = '';
      addBtn.onclick = null;       // libère pour le handler addEventListener de forms.js
    } else if (state.mode === 'static') {
      addBtn.hidden = true;
    } else {
      addBtn.hidden = false;
      const isLogged = !!state.member;
      addBtn.textContent = isLogged
        ? '🔒 Compte non habilité'
        : '🔒 Connecte-toi pour contribuer';
      addBtn.classList.add('btn-locked');
      addBtn.disabled = false;
      addBtn.title = isLogged
        ? 'Ton compte est en cours de validation par un admin.'
        : 'Tu dois être connecté avec un compte contributeur pour ajouter un lieu.';
      // Au clic, redirection /login.html si pas connecté.
      addBtn.onclick = (e) => {
        e.preventDefault();
        if (!state.member) location.href = 'login.html';
        else alert(addBtn.title);
      };
    }
  }
  // L'astuce « Touche la carte… » ne doit s'afficher QUE quand on a basculé
  // en mode addMode (clic sur « + Ajouter un lieu »), pas en permanence —
  // elle prend trop de place dans le topbar mobile.
  if (addHint) {
    addHint.hidden = !state.addMode;
  }
}

// Garde partagée : en mode statique, aucune écriture n'aboutit ; on
// affiche un message explicite au lieu de feindre. Retourne true si
// on est en statique (l'appelant doit abandonner).
function blockedByStaticMode(what = 'Cette action') {
  if (state.mode === 'static') {
    alert(`Aperçu en lecture seule — ${what} est visible pour montrer le design, mais aucun envoi n'est effectué.\n\nPour contribuer vraiment : clone le dépôt et lance \`./run.sh\` en local.`);
    return true;
  }
  return false;
}

/**
 * Garde d'authentification côté frontend.
 * Retourne true (et affiche un message) si l'utilisateur n'a pas le rôle
 * requis. L'appelant doit abandonner dans ce cas.
 */
function blockedByAuth(minRole = 'contributor', what = 'Cette action') {
  if (!state.member) {
    if (confirm(`${what} nécessite d'être connecté.\n\nAller à la page de connexion ?`)) {
      window.location.href = '/login.html';
    }
    return true;
  }
  if (!hasRole(minRole)) {
    alert(`${what} nécessite le rôle « ${minRole} » ou supérieur.\nVotre rôle actuel : ${state.member.role}.`);
    return true;
  }
  return false;
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
  if (!route) { closePanel(); closeFullTree(); return; }
  if (route.type !== 'arbre') closeFullTree();
  if (route.type === 'lieu') return openPlacePanel(route.id);
  if (route.type === 'personne') return openPersonPanel(route.id);
  if (route.type === 'recit') return openStoryFocus(route.id);
  if (route.type === 'arbre') return openFullTree(route.id);
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
  panelContent.querySelectorAll('.btn-propose-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.entityType;
      const id = btn.dataset.entityId;
      const entity =
        type === 'places' ? state.places.get(id)
        : type === 'people' ? state.people.get(id)
        : type === 'stories' ? state.stories.find(s => s.id === id)
        : null;
      if (entity) openEditDialog(type, entity);
    });
  });
  panelContent.querySelectorAll('.btn-complete-story').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.storyId;
      const story = state.stories.find(s => s.id === id);
      if (story) openCompleteDialog(story);
    });
  });
  panelContent.querySelectorAll('.btn-edit-completion').forEach(btn => {
    btn.addEventListener('click', () => {
      const sid = btn.dataset.storyId;
      const cid = btn.dataset.completionId;
      const story = state.stories.find(s => s.id === sid);
      const comp = (story?.completions || []).find(c => c.id === cid);
      if (story && comp) openEditCompletionDialog(story, comp);
    });
  });
  panelContent.querySelectorAll('.btn-move-place').forEach(btn => {
    btn.addEventListener('click', () => enterMovePlaceMode(btn.dataset.placeId));
  });
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

  // Bouton d'ajout de contenu uniquement pour contributor/admin.
  // Bouton "Déplacer" uniquement pour admin — corrige une position
  // approximative directement, sans passer par la file de modération.
  const canContribute = state.mode === 'live' && hasRole('contributor');
  const canMove       = state.mode === 'live' && hasRole('admin');
  const actions = `
    <div class="entity-actions">
      ${canContribute ? `<button class="btn-primary btn-add-story" type="button" data-place-id="${escapeAttr(place.id)}">+ Ajouter un contenu</button>` : ''}
      <button class="btn-ghost btn-propose-edit" type="button" data-entity-type="places" data-entity-id="${escapeAttr(place.id)}">✏️ Proposer une modification</button>
      ${canMove ? `<button class="btn-ghost btn-move-place" type="button" data-place-id="${escapeAttr(place.id)}">🔧 Déplacer ce lieu</button>` : ''}
    </div>`;

  openPanel(`
    <div class="entity-header">
      <span class="entity-kind">📍 Lieu</span>
      <h2>${escapeHtml(place.primaryName)}</h2>
      ${aliases ? `<div class="aliases">aussi appelé ${aliases}</div>` : ''}
    </div>
    ${place.description ? `<p class="desc">${escapeHtml(place.description)}</p>` : ''}
    ${actions}
    <h3 class="section-title">Récits (${related.length})</h3>
    ${related.length === 0
      ? '<p class="desc"><em>Aucun récit pour l\'instant.</em></p>'
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

  // Lieux sur lesquels cette personne a livré un récit (déduplication par
  // placeId d'ancrage + mentions de lieux dans ses contributions). Cliquables.
  const placesToldSet = new Set();
  asContrib.forEach(s => {
    if (s.placeId) placesToldSet.add(s.placeId);
    (s.mentions || []).forEach(m => {
      if (m.type === 'place') placesToldSet.add(m.entityId);
    });
  });
  const placesToldLinks = [...placesToldSet]
    .map(id => inlineEntity('lieu', id))
    .filter(Boolean)
    .join(' · ');

  const dates = [
    person.birth && `né·e en ${eventLabel(person.birth)}`,
    person.death && `† ${eventLabel(person.death)}`,
  ].filter(Boolean).join(' · ');

  const hasFamily = parentLinks || spouseLinks || childLinks;
  const actions = `
    <div class="entity-actions">
      <button class="btn-ghost btn-propose-edit" type="button" data-entity-type="people" data-entity-id="${escapeAttr(person.id)}">✏️ Proposer une modification</button>
    </div>`;

  openPanel(`
    <div class="entity-header">
      <span class="entity-kind">👤 Personne</span>
      <h2>${escapeHtml(person.primaryName)}${person.maidenName ? ` <small>(née ${escapeHtml(person.maidenName)})</small>` : ''}</h2>
      ${aliases ? `<div class="aliases">aussi appelé·e ${aliases}</div>` : ''}
      ${dates ? `<div class="dates">${dates}</div>` : ''}
    </div>
    ${person.bio ? `<p class="desc">${escapeHtml(person.bio)}</p>` : ''}
    ${actions}

    ${hasFamily ? `
      <h3 class="section-title">Arbre généalogique</h3>
      <div id="tree-mini"></div>
      <p class="tree-full-link">
        <a href="#/arbre/${encodeURIComponent(person.id)}">→ Voir l'arbre en grand</a>
      </p>
    ` : ''}

    ${placesToldLinks ? `
      <h3 class="section-title">Lieux où elle/il a livré ses récits</h3>
      <p class="places-told">${placesToldLinks}</p>
    ` : ''}

    <h3 class="section-title">🎙️ Récits qu'elle/il a racontés (${asContrib.length})</h3>
    ${asContrib.length ? asContrib.map(renderStoryCard).join('') : '<p class="desc"><em>Aucun récit livré pour l\'instant.</em></p>'}

    <h3 class="section-title">Récits où elle/il est mentionné·e (${asMention.length})</h3>
    ${asMention.length ? asMention.map(renderStoryCard).join('') : '<p class="desc"><em>Aucun.</em></p>'}
  `);

  // Rendu de l'arbre (version compacte dans le panneau)
  if (hasFamily && window.FamilyTree) {
    const el = document.getElementById('tree-mini');
    if (el) FamilyTree.render(el, person.id, state.people, {
      compact: true,
      onNavigate: (id) => navigateTo('personne', id),
    });
  }
}

function openFullTree(personId) {
  const person = state.people.get(personId);
  if (!person) {
    openPanel(`<p class="desc">Personne introuvable.</p>`);
    return;
  }
  // Overlay plein écran par-dessus la carte
  let overlay = document.getElementById('tree-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'tree-overlay';
    overlay.className = 'tree-overlay';
    overlay.innerHTML = `
      <div class="tree-overlay-head">
        <div class="tree-overlay-title"></div>
        <button type="button" class="btn-ghost tree-overlay-back">← Retour à la fiche</button>
        <button type="button" class="btn-ghost tree-overlay-close" aria-label="Fermer l'arbre">
          <span aria-hidden="true">×</span>
          <span class="close-label">Fermer</span>
        </button>
      </div>
      <div class="tree-overlay-body"></div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.tree-overlay-close').addEventListener('click', () => {
      history.replaceState(null, '', location.pathname + location.search);
      overlay.remove();
      closePanel();
    });
    overlay.querySelector('.tree-overlay-back').addEventListener('click', () => {
      navigateTo('personne', overlay.dataset.personId);
    });
  }
  overlay.dataset.personId = personId;
  overlay.querySelector('.tree-overlay-title').innerHTML =
    `🌳 <strong>${escapeHtml(person.primaryName)}</strong> — arbre généalogique`;
  const body = overlay.querySelector('.tree-overlay-body');
  if (window.FamilyTree) {
    FamilyTree.render(body, personId, state.people, {
      compact: false,
      onNavigate: (id) => navigateTo('arbre', id),
    });
  }
}

function closeFullTree() {
  const overlay = document.getElementById('tree-overlay');
  if (overlay) overlay.remove();
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

  // Bloc "raconté par" — mis en avant plutôt que mélangé aux autres méta.
  const contributor = s.contributorId ? state.people.get(s.contributorId) : null;
  const contribBlock = s.contributorId
    ? `<div class="story-byline">
         🎙️ Raconté par ${inlineEntity('personne', s.contributorId)}${
           contributor && (contributor.birth?.year || contributor.death?.year)
             ? ` <small>(${[contributor.birth?.year, contributor.death?.year].filter(Boolean).join('–')})</small>`
             : ''
         }
       </div>`
    : '';

  const dateBits = [
    s.memoryDate,
    s.createdAt ? `ajouté ${new Date(s.createdAt).toLocaleDateString('fr-FR')}` : null,
  ].filter(Boolean).join(' · ');

  const media = (s.mediaFiles || []).map(f => {
    if (!f.url) return '';
    if (f.mime && f.mime.startsWith('image/')) return `<img src="${f.url}" loading="lazy" alt="" />`;
    if (f.mime && f.mime.startsWith('audio/')) return `<audio controls preload="metadata" src="${f.url}"></audio>`;
    if (f.mime && f.mime.startsWith('video/')) return `<video controls preload="metadata" src="${f.url}" style="max-width:100%"></video>`;
    return `<p><a href="${f.url}" target="_blank" rel="noopener">Ouvrir le document</a></p>`;
  }).join('');

  // Complétions approuvées — chaque ajout attribué à son auteur·rice.
  const completions = (s.completions || [])
    .filter(c => c.status === 'approved')
    .map(c => renderCompletion(c, s.id)).join('');

  // Actions compactes placées juste après l'entête, pour qu'elles soient
  // visibles sans scroller — surtout sur mobile où le panel est un bottom
  // sheet court et où le corps du récit peut être long.
  const actions = `
    <div class="story-actions">
      <button type="button" class="btn-ghost btn-complete-story" data-story-id="${escapeAttr(s.id)}" title="Ajouter un souvenir ou une précision à cette histoire">➕ Compléter</button>
      <button type="button" class="btn-ghost btn-propose-edit" data-entity-type="stories" data-entity-id="${escapeAttr(s.id)}" title="Proposer une correction du texte">✏️ Modifier</button>
    </div>
  `;

  return `
    <article class="story" data-story-id="${escapeAttr(s.id)}">
      <h3>
        <span class="type-badge">${typeLabel}</span>
        <a href="#/recit/${encodeURIComponent(s.id)}" class="story-title">${escapeHtml(s.title || '(sans titre)')}</a>
      </h3>
      ${contribBlock}
      ${dateBits ? `<div class="meta">${dateBits}</div>` : ''}
      ${actions}
      ${s.body ? `<div class="body">${renderBodyWithMentions(s.body, s.mentions)}</div>` : ''}
      ${media}
      ${completions}
    </article>
  `;
}

function renderCompletion(c, storyId) {
  const who = c.submittedBy || {};
  // Si submittedBy.personId est renseigné, on lie le nom à la fiche de la
  // Personne correspondante — le graphe reste cohérent.
  const nameHtml = who.personId
    ? inlineEntity('personne', who.personId)
    : (who.name ? `<strong>${escapeHtml(who.name)}</strong>` : '<em>Anonyme</em>');
  const byline = [
    nameHtml,
    who.writtenFrom ? `depuis ${escapeHtml(who.writtenFrom)}` : null,
    who.relationship ? `<span class="rel">${escapeHtml(who.relationship)}</span>` : null,
  ].filter(Boolean).join(' · ');
  const date = c.createdAt ? new Date(c.createdAt).toLocaleDateString('fr-FR') : '';
  return `
    <div class="completion" data-completion-id="${escapeAttr(c.id)}">
      <div class="completion-head">
        <span class="completion-byline">✍️ ${byline}${date ? ` · <span class="completion-date">${date}</span>` : ''}</span>
        <button type="button" class="btn-ghost btn-edit-completion btn-inline"
                data-story-id="${escapeAttr(storyId || '')}" data-completion-id="${escapeAttr(c.id)}"
                title="Proposer une modification de ce texte">✏️</button>
      </div>
      <div class="completion-body">${escapeHtml(c.body)}</div>
    </div>
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

// ─── Déplacement d'un lieu (admin) ──────────────────────────────────────
// Active un mode "drag" sur un marker pour corriger ses coordonnées.
// Bandeau d'info en haut de la carte, ESC pour annuler. À la fin du
// drag, modale de confirmation avec les nouvelles coords avant POST.

let _moveBanner = null;
let _moveOriginalLatLng = null;
let _moveEscHandler = null;

function ensureMoveBanner() {
  if (_moveBanner) return _moveBanner;
  _moveBanner = document.createElement('div');
  _moveBanner.id = 'move-place-banner';
  _moveBanner.className = 'move-place-banner';
  _moveBanner.innerHTML = `
    <span class="move-banner-text"></span>
    <button type="button" class="btn-ghost" id="move-banner-cancel">Annuler (ESC)</button>
  `;
  document.body.appendChild(_moveBanner);
  _moveBanner.querySelector('#move-banner-cancel')
    .addEventListener('click', exitMovePlaceMode);
  return _moveBanner;
}

function enterMovePlaceMode(placeId) {
  if (!hasRole('admin')) return;
  if (state.movePlaceId === placeId) return;
  if (state.movePlaceId) exitMovePlaceMode();

  const place = state.places.get(placeId);
  const marker = state.markers.get(placeId);
  if (!place || !marker) return;

  state.movePlaceId = placeId;
  _moveOriginalLatLng = marker.getLatLng();

  marker.dragging.enable();
  marker.setOpacity(0.85);
  marker.on('dragend', _handleMarkerDragEnd);

  const banner = ensureMoveBanner();
  banner.querySelector('.move-banner-text').innerHTML =
    `🔧 <strong>Mode déplacement</strong> : glisse le marker de ` +
    `<em>${escapeHtml(place.primaryName)}</em> à sa position correcte.`;
  banner.classList.add('active');

  _moveEscHandler = (e) => { if (e.key === 'Escape') exitMovePlaceMode(); };
  window.addEventListener('keydown', _moveEscHandler);
}

function exitMovePlaceMode() {
  if (!state.movePlaceId) return;
  const marker = state.markers.get(state.movePlaceId);
  if (marker) {
    marker.off('dragend', _handleMarkerDragEnd);
    if (marker.dragging) marker.dragging.disable();
    marker.setOpacity(1);
    if (_moveOriginalLatLng) marker.setLatLng(_moveOriginalLatLng);
  }
  state.movePlaceId = null;
  _moveOriginalLatLng = null;
  if (_moveBanner) _moveBanner.classList.remove('active');
  if (_moveEscHandler) {
    window.removeEventListener('keydown', _moveEscHandler);
    _moveEscHandler = null;
  }
}

async function _handleMarkerDragEnd(e) {
  const placeId = state.movePlaceId;
  if (!placeId) return;
  const marker = e.target;
  const newPos = marker.getLatLng();
  const place = state.places.get(placeId);
  const ok = confirm(
    `Déplacer « ${place ? place.primaryName : placeId} » ?\n\n` +
    `Avant : ${_moveOriginalLatLng.lat.toFixed(5)}, ${_moveOriginalLatLng.lng.toFixed(5)}\n` +
    `Après : ${newPos.lat.toFixed(5)}, ${newPos.lng.toFixed(5)}`,
  );
  if (!ok) {
    // Reposition le marker à l'endroit d'origine, on reste en mode drag
    marker.setLatLng(_moveOriginalLatLng);
    return;
  }
  try {
    const res = await fetch(`/api/admin/places/${encodeURIComponent(placeId)}/move`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: newPos.lat, lng: newPos.lng }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `${res.status}`);
    // Persisté côté serveur — on quitte le mode et on recharge
    _moveOriginalLatLng = newPos; // empêche exitMovePlaceMode de reposer le marker
    exitMovePlaceMode();
    await reload();
    // Réouvre le panneau du lieu pour voir les coords mises à jour
    if (location.hash !== `#/lieu/${placeId}`) navigateTo('lieu', placeId);
  } catch (err) {
    alert('Erreur lors du déplacement : ' + err.message);
    marker.setLatLng(_moveOriginalLatLng);
  }
}

// ─── Bootstrap ──────────────────────────────────────────────────────────
reload().catch(err => {
  console.error(err);
  openPanel(`<p class="desc">Erreur au chargement : ${escapeHtml(err.message)}</p>`);
});
