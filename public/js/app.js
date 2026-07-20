// Mémoire des Cévennes : frontend v0.2
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
// member < admin. "contributor" historique fusionné avec member ; on garde
// un alias rétro-compat dans hasRole() pour les vieux JWT pas encore expirés.
const ROLES_ORDER = ['member', 'admin'];

/** Retourne true si le membre connecté a au moins le rôle minRole. */
function hasRole(minRole) {
  // Si le serveur a renvoyé un membre via /api/auth/me, le JWT était valide
  // au moment de la décodage : pas besoin de re-vérifier le status côté
  // client (le serveur a déjà refusé si status !== 'active' au login).
  if (!state.member) return false;
  // Alias rétro-compat : JWT pré-fusion peuvent encore porter role="contributor".
  const role = state.member.role === 'contributor' ? 'member' : state.member.role;
  const need = minRole === 'contributor' ? 'member' : minRole;
  return ROLES_ORDER.indexOf(role) >= ROLES_ORDER.indexOf(need);
}

// ─── Cache client des tuiles de carte ─────────────────────────────────────
// Un petit service worker (public/sw.js) met en cache les tuiles OSM / IGN
// côté navigateur : re-visites et déplacements plus rapides, moins de charge
// sur les serveurs de tuiles. Sans effet si le navigateur refuse le SW
// (accès HTTP non sécurisé) : on ignore silencieusement l'échec.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ─── Carte ──────────────────────────────────────────────────────────────
// maxZoom à 22 : permet à l'utilisateur de zoomer au-delà de la résolution
// native des tuiles (Leaflet upscale les tuiles natives, ça devient flou
// mais reste exploitable : utile pour aligner précisément un point au
// doigt sur tél, par ex. la calibration cadastre). Chaque couche a son
// propre `maxNativeZoom` pour que l'upscale parte du bon niveau au lieu
// de virer au gris.
// Défauts appliqués à TOUTES les couches de tuiles (fond OSM + IGN/cadastre
// de map-layers.js, créées après ce script). Corrige le symptôme « on est
// trop zoomé, on se déplace et la tuile ne charge pas » :
//   - updateWhenIdle:false → charge les tuiles PENDANT le déplacement, pas
//     seulement une fois arrêté (sur mobile ce défaut vaut true, d'où les
//     zones qui restaient blanches tant qu'on faisait glisser la carte).
//   - keepBuffer élargi → garde plus de tuiles autour du cadre : en fort
//     sur-zoom (tuiles natives très agrandies) le pruning était trop
//     agressif et laissait des trous en pannant.
//   - updateWhenZooming:false → évite les requêtes intermédiaires en plein
//     zoom animé.
L.GridLayer.prototype.options.updateWhenIdle = false;
L.GridLayer.prototype.options.updateWhenZooming = false;
L.GridLayer.prototype.options.keepBuffer = 6;

const map = L.map('map', { zoomControl: true, maxZoom: 22 }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
// Fond par défaut. Exposé pour que map-layers.js puisse le piloter via le
// sélecteur de couches (cadastre, cartes anciennes, photos aériennes IGN).
const defaultBaseLayer = L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
  maxNativeZoom: 19,
  maxZoom: 22,
  attribution: '© OpenStreetMap France | © OpenStreetMap contributors',
}).addTo(map);

// Mire fixe au centre de la carte. Affichée via la classe `add-mode` ou
// `move-mode` sur <body> (forms.js / app.js gèrent ces classes). On
// pane/zoome la carte sous la mire au lieu de glisser un marker sous
// le doigt : le doigt n'occulte plus la cible.
{
  const ch = document.createElement('div');
  ch.className = 'map-crosshair';
  ch.setAttribute('aria-hidden', 'true');
  ch.innerHTML = '<svg viewBox="-16 -16 32 32" width="40" height="40">' +
    '<circle r="13" fill="none" stroke="rgba(0,0,0,0.55)" stroke-width="1"/>' +
    '<line x1="-12" y1="0" x2="-3" y2="0" stroke="rgba(0,0,0,0.85)" stroke-width="1.6"/>' +
    '<line x1="3" y1="0" x2="12" y2="0" stroke="rgba(0,0,0,0.85)" stroke-width="1.6"/>' +
    '<line x1="0" y1="-12" x2="0" y2="-3" stroke="rgba(0,0,0,0.85)" stroke-width="1.6"/>' +
    '<line x1="0" y1="3" x2="0" y2="12" stroke="rgba(0,0,0,0.85)" stroke-width="1.6"/>' +
    '<circle r="2" fill="#d63b3b" stroke="#fff" stroke-width="0.8"/></svg>';
  map.getContainer().appendChild(ch);
}

// ─── DOM refs ───────────────────────────────────────────────────────────
const panel = document.getElementById('panel');
const panelContent = document.getElementById('panel-content');
const readonlyBanner = document.getElementById('readonly-banner');
const addBtn = document.getElementById('btn-add-place');
const addHint = document.getElementById('add-hint');
const authNav = document.getElementById('auth-nav'); // peut être null si absent du HTML

document.getElementById('panel-close').addEventListener('click', closePanel);

// ─── Zoom de lecture PROPRE au panneau (indépendant du texte global) ────
// Le visiteur peut grossir le récit affiché sans changer la taille du reste
// du site. Mémorisé entre les visites.
const PANEL_ZOOM_KEY = 'mdc-panel-zoom';
const PANEL_ZOOM_MIN = 1, PANEL_ZOOM_MAX = 2.2, PANEL_ZOOM_STEP = 0.15;
let panelZoom = parseFloat(localStorage.getItem(PANEL_ZOOM_KEY));
if (!Number.isFinite(panelZoom)) panelZoom = 1.15;   // « histoire en gros » par défaut

function applyPanelZoom() {
  const c = document.getElementById('panel-content');
  if (c) c.style.zoom = panelZoom;
}
function setPanelZoom(z) {
  panelZoom = Math.min(PANEL_ZOOM_MAX, Math.max(PANEL_ZOOM_MIN, Math.round(z * 100) / 100));
  try { localStorage.setItem(PANEL_ZOOM_KEY, String(panelZoom)); } catch {}
  applyPanelZoom();
}
{
  const zin = document.getElementById('panel-zoom-in');
  const zout = document.getElementById('panel-zoom-out');
  if (zin) zin.addEventListener('click', () => setPanelZoom(panelZoom + PANEL_ZOOM_STEP));
  if (zout) zout.addEventListener('click', () => setPanelZoom(panelZoom - PANEL_ZOOM_STEP));
}

// Fond grisé (PC) : clic à côté de la fenêtre centrée = fermeture.
const panelBackdrop = document.getElementById('panel-backdrop');
if (panelBackdrop) panelBackdrop.addEventListener('click', closePanel);
// Échap ferme le panneau (sauf si un dialog modal est ouvert : il gère son
// propre Échap nativement).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.querySelector('dialog[open]')) return;
  if (document.body.classList.contains('panel-open')) closePanel();
});
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
  const accountLink = document.getElementById('menu-account');
  const adminLink  = document.getElementById('menu-admin');

  if (!loginBtn || !logoutBtn || !greeting) {
    // Page sans ces hooks (login/register/admin) : rien à faire.
    return;
  }

  if (!state.member) {
    loginBtn.hidden  = false;
    logoutBtn.hidden = true;
    greeting.hidden  = true;
    if (accountLink) accountLink.hidden = true;
    if (adminLink) adminLink.hidden = true;
    return;
  }

  loginBtn.hidden  = true;
  logoutBtn.hidden = false;
  greeting.hidden  = false;
  // En-tête du menu : qui est connecté (texte simple). L'accès au compte
  // est un item dédié « 👤 Mon compte » juste en dessous.
  greeting.textContent = `Connecté·e : ${state.member.name}`;
  if (accountLink) accountLink.hidden = false;
  // Le lien vers la console d'administration n'apparaît que pour les admins.
  if (adminLink) adminLink.hidden = !hasRole('admin');

  // Branche le bouton de déconnexion (idempotent : on le rebranche à chaque rendu).
  logoutBtn.onclick = async () => {
    const ok = window.MdcConfirm
      ? await window.MdcConfirm('Vous allez être déconnecté de votre compte.')
      : window.confirm('Vous allez être déconnecté de votre compte.');
    if (!ok) return;
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
  buildNamesIndex();
  refreshMarkers();
  applyMode();
  renderAuthNav();
  routeFromHash();
}

// Index nom : entité, alimenté à chaque reload(). Sert à transformer les
// occurrences de noms de Lieux ou Personnes dans les textes (descriptions,
// bios, corps de récits, complétions) en liens vers la fiche correspondante.
// Le regex `regex` est construit à partir des noms triés par longueur
// décroissante (longest-first) pour qu'un nom plus long matche avant son
// préfixe (ex. "Saint-Roman-de-Codières" gagne sur "Saint-Roman").
const namesIndex = { places: new Map(), people: new Map(), regex: null };
function buildNamesIndex() {
  namesIndex.places.clear();
  namesIndex.people.clear();
  function pushNames(entity, indexMap) {
    if (entity.primaryName) {
      indexMap.set(entity.primaryName.toLowerCase().trim(), entity);
    }
    (entity.aliases || []).forEach(a => {
      const name = typeof a === 'string' ? a : (a && a.name);
      if (name) indexMap.set(String(name).toLowerCase().trim(), entity);
    });
  }
  state.places.forEach(p => pushNames(p, namesIndex.places));
  state.people.forEach(p => pushNames(p, namesIndex.people));
  // Construit le regex auto-detect : alternance de tous les noms,
  // longest-first, avec frontières non-lettre/non-chiffre pour ne pas
  // matcher au milieu d'un mot. \p{L} couvre les lettres accentuées.
  const all = [...namesIndex.places.keys(), ...namesIndex.people.keys()]
    .filter(n => n.length >= 3) // évite les noms trop courts (faux positifs)
    .sort((a, b) => b.length - a.length);
  if (all.length) {
    namesIndex.altPattern = all
      .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
  } else {
    namesIndex.altPattern = null;
  }
}

function refreshMarkers() {
  state.markers.forEach(m => map.removeLayer(m));
  state.markers.clear();
  for (const p of state.places.values()) {
    const marker = L.marker([p.lat, p.lng], { title: p.primaryName });
    marker.bindTooltip(p.primaryName);
    marker.on('click', (e) => {
      // En mode ajout d'un lieu, on laisse le clic « traverser » le
      // marqueur : l'utilisateur pose sa nouvelle épingle même s'il a
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
  // En anonyme on le masque (le bouton « Connexion membre » fait déjà le job
  // sans surcharger la topbar). En membre simple non habilité, on garde un
  // bouton verrouillé qui explique au clic.
  if (addBtn) {
    const canAdd = state.mode === 'live' && hasRole('member');
    if (canAdd) {
      addBtn.hidden = false;
      addBtn.textContent = '+ Ajouter un lieu';
      addBtn.classList.remove('btn-locked');
      addBtn.disabled = false;
      addBtn.title = '';
      addBtn.onclick = null;       // libère pour le handler addEventListener de forms.js
    } else if (state.mode === 'static' || !state.member) {
      addBtn.hidden = true;
      addBtn.onclick = null;
    } else {
      addBtn.hidden = false;
      addBtn.textContent = '🔒 Compte non habilité';
      addBtn.classList.add('btn-locked');
      addBtn.disabled = false;
      addBtn.title = 'Ton compte est en cours de validation par un admin.';
      addBtn.onclick = (e) => {
        e.preventDefault();
        alert(addBtn.title);
      };
    }
  }
  // L'astuce « Touche la carte… » ne doit s'afficher QUE quand on a basculé
  // en mode addMode (clic sur « + Ajouter un lieu »), pas en permanence :
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
    alert(`Aperçu en lecture seule : ${what} est visible pour montrer le design, mais aucun envoi n'est effectué.\n\nPour contribuer vraiment : clone le dépôt et lance \`./run.sh\` en local.`);
    return true;
  }
  return false;
}

/**
 * Garde d'authentification côté frontend.
 * Retourne true (et affiche un message) si l'utilisateur n'a pas le rôle
 * requis. L'appelant doit abandonner dans ce cas.
 */
function blockedByAuth(minRole = 'member', what = 'Cette action') {
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
  applyPanelZoom();
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
  panelContent.querySelectorAll('.btn-share').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.shareUrl;
      const label = btn.dataset.shareLabel || 'cette page';
      const caption = btn.dataset.shareCaption || '';
      if (typeof window.openShare === 'function') {
        window.openShare({ url, label, caption });
      }
    });
  });
  panelContent.querySelectorAll('.btn-listen').forEach(btn => {
    btn.addEventListener('click', () => toggleListen(btn));
  });
  panelContent.querySelectorAll('.btn-redact').forEach(btn => {
    btn.addEventListener('click', () => {
      if (typeof window.openRedactDialog === 'function') {
        window.openRedactDialog(btn.dataset.storyId);
      }
    });
  });
}

// ─── Synthèse vocale (accessibilité) ───────────────────────────────────
// Lecture 100% côté client via la synthèse vocale du navigateur (Web Speech
// API). On n'appelle plus l'audio Piper du serveur : ça évite de solliciter
// son CPU à chaque écoute. Le corps des récits est déjà filtré par audience
// côté serveur (GET /api/stories), donc aucun passage masqué ne fuite ici.
let currentTtsBtn = null;

// Nettoie le texte pour la lecture vocale (mêmes règles que src/tts.js) :
// pas d'astérisques, de parenthèses ni de guillemets prononcés.
function cleanForSpeech(text) {
  let t = String(text || '');
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  t = t.replace(/https?:\/\/\S+/g, ' ');
  t = t.replace(/[*_`#~>]/g, ' ');
  t = t.replace(/[«»"“”]/g, ' ');
  t = t.replace(/(\d)\s*[-–—]\s*(\d)/g, '$1 à $2');
  t = t.replace(/[()\[\]{}]/g, ', ');
  t = t.replace(/^\s*[-•]\s+/gm, '');
  t = t.replace(/\s*,(\s*,)+/g, ',');
  t = t.replace(/\s+([,.;:!?])/g, '$1');
  t = t.replace(/,(\s*[.;:!?])/g, '$1');
  t = t.replace(/[ \t]{2,}/g, ' ');
  return t.trim();
}

function stopListening() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (currentTtsBtn) {
    currentTtsBtn.classList.remove('playing');
    currentTtsBtn.setAttribute('aria-pressed', 'false');
    currentTtsBtn.textContent = '🔊 Écouter';
    currentTtsBtn = null;
  }
}

function markPlaying(btn) {
  currentTtsBtn = btn;
  btn.classList.add('playing');
  btn.setAttribute('aria-pressed', 'true');
  btn.textContent = '⏹ Arrêter';
}

function toggleListen(btn) {
  // Re-clic sur le bouton en cours : on arrête.
  if (currentTtsBtn === btn) { stopListening(); return; }
  stopListening();
  const kind = btn.dataset.listenKind || 'story';
  const id = btn.dataset.listenId;
  if (!id) return;
  speakInBrowser(kind, id, btn);
}

// Texte brut à lire selon le type d'entité.
function listenTextFor(kind, id) {
  if (kind === 'place') {
    const p = state.places.get(id);
    return p ? (p.primaryName ? p.primaryName + '. ' : '') + (p.description || '') : '';
  }
  if (kind === 'person') {
    const p = state.people.get(id);
    return p ? (p.primaryName ? p.primaryName + '. ' : '') + (p.bio || '') : '';
  }
  const s = state.stories.find(x => x.id === id);
  return s ? (s.title ? s.title + '. ' : '') + String(s.body || '').replace(/<[^>]+>/g, '') : '';
}

// Lecture via la synthèse vocale du navigateur (Web Speech API), 100% local.
function speakInBrowser(kind, id, btn) {
  if (!window.speechSynthesis) { alert('La lecture vocale n’est pas disponible sur ce navigateur.'); return; }
  const text = cleanForSpeech(listenTextFor(kind, id));
  if (!text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR';
  u.rate = 0.95;
  const frVoice = window.speechSynthesis.getVoices().find(v => /fr/i.test(v.lang));
  if (frVoice) u.voice = frVoice;
  u.onend = stopListening;
  markPlaying(btn);
  window.speechSynthesis.speak(u);
}

function closePanel() {
  stopListening();
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
  // Bouton "Déplacer" uniquement pour admin : corrige une position
  // approximative directement, sans passer par la file de modération.
  const canContribute = state.mode === 'live' && hasRole('member');
  const canMove       = state.mode === 'live' && hasRole('admin');
  const editLabel = hasRole('admin') ? '✏️ Modifier' : '✏️ Proposer une modification';
  const actions = `
    <div class="entity-actions">
      ${canContribute ? `<button class="btn-primary btn-add-story" type="button" data-place-id="${escapeAttr(place.id)}">+ Ajouter un contenu</button>` : ''}
      ${place.description ? `<button class="btn-ghost btn-listen" type="button" data-listen-kind="place" data-listen-id="${escapeAttr(place.id)}" aria-pressed="false" title="Écouter ce lieu à voix haute">🔊 Écouter</button>` : ''}
      <button class="btn-ghost btn-propose-edit" type="button" data-entity-type="places" data-entity-id="${escapeAttr(place.id)}">${editLabel}</button>
      <button class="btn-ghost btn-share" type="button" data-share-url="${escapeAttr(`${location.origin}/#/lieu/${place.id}`)}" data-share-label="${escapeAttr(place.primaryName)}" data-share-caption="${escapeAttr(place.description || '')}">📤 Partager</button>
      ${canMove ? `<button class="btn-ghost btn-move-place" type="button" data-place-id="${escapeAttr(place.id)}">🔧 Déplacer ce lieu</button>` : ''}
    </div>`;

  openPanel(`
    <div class="entity-header">
      <span class="entity-kind">📍 Lieu</span>
      <h2>${escapeHtml(place.primaryName)}</h2>
      ${aliases ? `<div class="aliases">aussi appelé ${aliases}</div>` : ''}
    </div>
    ${place.description ? `<p class="desc">${renderEmphasisAndAutoLinks(place.description)}</p>` : ''}
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
  const editLabelP = hasRole('admin') ? '✏️ Modifier' : '✏️ Proposer une modification';
  const actions = `
    <div class="entity-actions">
      ${person.bio ? `<button class="btn-ghost btn-listen" type="button" data-listen-kind="person" data-listen-id="${escapeAttr(person.id)}" aria-pressed="false" title="Écouter cette fiche à voix haute">🔊 Écouter</button>` : ''}
      <button class="btn-ghost btn-propose-edit" type="button" data-entity-type="people" data-entity-id="${escapeAttr(person.id)}">${editLabelP}</button>
      <button class="btn-ghost btn-share" type="button" data-share-url="${escapeAttr(`${location.origin}/#/personne/${person.id}`)}" data-share-label="${escapeAttr(person.primaryName)}" data-share-caption="${escapeAttr(dates || '')}">📤 Partager</button>
    </div>`;

  openPanel(`
    <div class="entity-header">
      <span class="entity-kind">👤 Personne</span>
      <h2>${escapeHtml(person.primaryName)}${person.maidenName ? ` <small>(née ${escapeHtml(person.maidenName)})</small>` : ''}</h2>
      ${aliases ? `<div class="aliases">aussi appelé·e ${aliases}</div>` : ''}
      ${dates ? `<div class="dates">${dates}</div>` : ''}
    </div>
    ${person.bio ? `<p class="desc">${renderEmphasisAndAutoLinks(person.bio)}</p>` : ''}
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

// Compte des récits liés à une personne (racontés + mentions), pour la
// pastille des cartes de l'arbre et le panneau latéral.
function personStoryCount(id) {
  let n = 0;
  for (const s of state.stories) {
    if (s.contributorId === id) { n++; continue; }
    if ((s.mentions || []).some(m => m.type === 'person' && m.entityId === id)) n++;
  }
  return n;
}

const STORY_TYPE_ICON = {
  text: '📖', photo: '📷', audio: '🔊', video: '🎬', drawing: '🖌️', note: '📝',
};

// Panneau latéral de l'arbre : récits de la personne au centre (racontés +
// mentions) et lieux de ses récits, le tout cliquable. Refait à chaque
// recentrage pour suivre la navigation dans l'arbre.
function treeAsideHtml(person) {
  const asContrib = state.stories.filter(s => s.contributorId === person.id);
  const asMention = state.stories.filter(s =>
    (s.mentions || []).some(m => m.type === 'person' && m.entityId === person.id)
    && s.contributorId !== person.id
  );
  // Lieux tirés de tous les récits liés à la personne (racontés + mentions) :
  // ancrage placeId et mentions de lieux.
  const placeIds = new Set();
  [...asContrib, ...asMention].forEach(s => {
    if (s.placeId) placeIds.add(s.placeId);
    (s.mentions || []).forEach(m => { if (m.type === 'place') placeIds.add(m.entityId); });
  });

  const storyItem = (s) => {
    const icon = STORY_TYPE_ICON[s.type] || '📖';
    const title = (s.title || '').trim() || '(sans titre)';
    return `<a class="tree-aside-item" href="#/recit/${encodeURIComponent(s.id)}">
      <span class="tas-icon" aria-hidden="true">${icon}</span>
      <span class="tas-title">${escapeHtml(title)}</span>
    </a>`;
  };
  const emptyLine = (txt) => `<p class="tree-aside-empty">${txt}</p>`;

  const dates = [
    person.birth && `né·e en ${eventLabel(person.birth)}`,
    person.death && `† ${eventLabel(person.death)}`,
  ].filter(Boolean).join(' · ');

  const placeChips = [...placeIds]
    .map(id => state.places.get(id))
    .filter(Boolean)
    .map(p => `<a class="tree-aside-place" href="#/lieu/${encodeURIComponent(p.id)}">📍 ${escapeHtml(p.primaryName)}</a>`)
    .join('');

  return `
    <div class="tree-aside-person">
      <div class="tree-aside-name">👤 ${escapeHtml(person.primaryName)}</div>
      ${dates ? `<div class="tree-aside-dates">${dates}</div>` : ''}
      <a class="tree-aside-fiche" href="#/personne/${encodeURIComponent(person.id)}">Voir la fiche complète →</a>
    </div>
    <hr class="tree-aside-divider" />
    <section>
      <h4>🎙️ Récits racontés (${asContrib.length})</h4>
      ${asContrib.length ? asContrib.map(storyItem).join('') : emptyLine('Aucun récit livré pour l\'instant.')}
    </section>
    <section>
      <h4>Récits où il/elle est cité·e (${asMention.length})</h4>
      ${asMention.length ? asMention.map(storyItem).join('') : emptyLine('Aucune mention.')}
    </section>
    ${placeChips ? `
    <section>
      <h4>📍 Lieux de ses récits</h4>
      <div class="tree-aside-places">${placeChips}</div>
    </section>` : ''}
  `;
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
        <div class="tree-search">
          <input type="search" class="tree-search-input" autocomplete="off"
                 placeholder="Chercher une personne ou un lieu…"
                 aria-label="Chercher une personne ou un lieu dans l'arbre" />
          <ul class="tree-search-results" role="listbox" hidden></ul>
        </div>
        <button type="button" class="btn-ghost tree-overlay-back">👤 Voir la fiche</button>
        <button type="button" class="btn-ghost tree-overlay-close" aria-label="Fermer l'arbre">
          <span aria-hidden="true">×</span>
          <span class="close-label">Fermer</span>
        </button>
      </div>
      <div class="tree-overlay-body">
        <div class="tree-canvas"></div>
        <aside class="tree-aside" aria-label="Récits et lieux de la personne"></aside>
      </div>
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
    wireTreeSearch(overlay);
  }
  overlay.dataset.personId = personId;
  overlay.querySelector('.tree-overlay-title').innerHTML =
    `🌳 <strong>${escapeHtml(person.primaryName)}</strong> : arbre généalogique`;
  const searchInput = overlay.querySelector('.tree-search-input');
  if (searchInput) { searchInput.value = ''; }
  if (overlay._treeSearchReset) overlay._treeSearchReset();
  const canvas = overlay.querySelector('.tree-canvas');
  if (window.FamilyTree && canvas) {
    FamilyTree.render(canvas, personId, state.people, {
      compact: false,
      badge: personStoryCount,
      onNavigate: (id) => navigateTo('arbre', id),
    });
  }
  const aside = overlay.querySelector('.tree-aside');
  if (aside) aside.innerHTML = treeAsideHtml(person);
}

// Barre de recherche de l'arbre. Cherche à la fois les personnes (nom / alias)
// et les lieux. Comme les familles peuvent être déconnectées les unes des
// autres, c'est le moyen d'atteindre n'importe qui. Choisir une personne
// recentre l'arbre ; choisir un lieu déroule les personnes qui y sont citées
// (contributrices + mentions dans les récits du lieu), pour rebondir de la
// carte vers la parenté. Priorise les personnes déjà reliées, clavier géré.
function wireTreeSearch(overlay) {
  const input = overlay.querySelector('.tree-search-input');
  const list  = overlay.querySelector('.tree-search-results');
  if (!input || !list) return;
  let active = -1;
  let placeCtx = null; // lieu choisi : la liste montre alors ses personnes

  const norm = (s) => (s || '').toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "");

  function famChecker() {
    const cc = new Map();
    state.people.forEach(p => (p.parents || []).forEach(par => {
      cc.set(par.id, (cc.get(par.id) || 0) + 1);
    }));
    return (p) => !!((p.parents || []).length || (p.spouses || []).length || (cc.get(p.id) || 0));
  }

  function peopleMatching(q, limit) {
    const nq = norm(q);
    const hasFam = famChecker();
    const people = [...state.people.values()].filter(p => {
      if (!nq) return true;
      const names = [p.primaryName, p.maidenName, ...((p.aliases || []).map(a => a.name))];
      return names.some(n => norm(n).includes(nq));
    });
    people.sort((a, b) => {
      const fa = hasFam(a) ? 0 : 1, fb = hasFam(b) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      return a.primaryName.localeCompare(b.primaryName, 'fr');
    });
    return people.slice(0, limit).map(p => ({ kind: 'person', p, fam: hasFam(p) }));
  }

  function placesMatching(q, limit) {
    const nq = norm(q);
    if (!nq) return [];
    return [...state.places.values()].filter(pl => {
      const names = [pl.primaryName, ...((pl.aliases || []).map(a => a.name))];
      return names.some(n => norm(n).includes(nq));
    })
      .sort((a, b) => a.primaryName.localeCompare(b.primaryName, 'fr'))
      .slice(0, limit)
      .map(pl => ({ kind: 'place', pl }));
  }

  function peopleOfPlace(placeId) {
    const rel = state.stories.filter(s =>
      s.placeId === placeId ||
      (s.mentions || []).some(m => m.type === 'place' && m.entityId === placeId)
    );
    const ids = new Set();
    rel.forEach(s => {
      if (s.contributorId) ids.add(s.contributorId);
      (s.mentions || []).forEach(m => { if (m.type === 'person') ids.add(m.entityId); });
    });
    const hasFam = famChecker();
    return [...ids].map(id => state.people.get(id)).filter(Boolean)
      .sort((a, b) => a.primaryName.localeCompare(b.primaryName, 'fr'))
      .map(p => ({ kind: 'person', p, fam: hasFam(p) }));
  }

  function itemHtml(it, i) {
    const cls = `tree-search-item${i === active ? ' active' : ''}`;
    if (it.kind === 'person') {
      return `<li role="option" data-kind="person" data-id="${escapeAttr(it.p.id)}" class="${cls}">
        <span class="tree-search-name">${escapeHtml(it.p.primaryName)}</span>
        ${it.fam ? '<span class="tree-search-badge">🌿 parenté</span>' : ''}
      </li>`;
    }
    return `<li role="option" data-kind="place" data-id="${escapeAttr(it.pl.id)}" class="${cls} tree-search-place">
      <span class="tree-search-name">📍 ${escapeHtml(it.pl.primaryName)}</span>
      <span class="tree-search-type">voir les personnes →</span>
    </li>`;
  }

  function renderList() {
    let items, prefix = '';
    if (placeCtx) {
      prefix = `<li class="tree-search-head" aria-disabled="true">
        <span>📍 ${escapeHtml(placeCtx.primaryName)} : personnes citées</span>
        <button type="button" class="tree-search-back">← retour</button>
      </li>`;
      items = peopleOfPlace(placeCtx.id);
      if (!items.length) {
        list.innerHTML = prefix + `<li class="tree-search-empty" aria-disabled="true">Aucune personne citée dans ce lieu</li>`;
        list.hidden = false;
        return;
      }
    } else {
      const q = input.value.trim();
      items = [...peopleMatching(q, q ? 8 : 12), ...placesMatching(q, 6)];
      if (!items.length) {
        list.innerHTML = `<li class="tree-search-empty" aria-disabled="true">Aucun résultat</li>`;
        list.hidden = false;
        return;
      }
    }
    if (active >= items.length) active = items.length - 1;
    list.innerHTML = prefix + items.map((it, i) => itemHtml(it, i)).join('');
    list.hidden = false;
  }

  function activate(kind, id) {
    if (!id) return;
    if (kind === 'place') {
      placeCtx = state.places.get(id) || null;
      active = -1;
      renderList();
      input.focus();
    } else {
      list.hidden = true;
      input.value = '';
      placeCtx = null;
      navigateTo('arbre', id);
    }
  }

  function goBack() {
    placeCtx = null;
    active = -1;
    renderList();
    input.focus();
  }

  input.addEventListener('input', () => { placeCtx = null; active = -1; renderList(); });
  input.addEventListener('focus', () => renderList());
  input.addEventListener('keydown', (e) => {
    const items = Array.from(list.querySelectorAll('.tree-search-item'));
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, items.length - 1); renderList(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); renderList(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = items[active] || items[0];
      if (pick) activate(pick.dataset.kind, pick.dataset.id);
    } else if (e.key === 'Escape') {
      if (placeCtx) { goBack(); }
      else { list.hidden = true; input.blur(); }
    }
  });
  list.addEventListener('mousedown', (e) => {
    // mousedown (pas click) pour devancer le blur de l'input.
    if (e.target.closest('.tree-search-back')) { e.preventDefault(); goBack(); return; }
    const li = e.target.closest('.tree-search-item');
    if (li) { e.preventDefault(); activate(li.dataset.kind, li.dataset.id); }
  });
  input.addEventListener('blur', () => { setTimeout(() => { list.hidden = true; }, 150); });

  // Réinitialise le drill-down « personnes d'un lieu » quand on rouvre l'arbre
  // sur quelqu'un d'autre (l'overlay et son closure sont réutilisés).
  overlay._treeSearchReset = () => { placeCtx = null; active = -1; list.hidden = true; };
}

function closeFullTree() {
  const overlay = document.getElementById('tree-overlay');
  if (overlay) overlay.remove();
}

// Point d'entrée « Arbre généalogique » depuis le menu : l'arbre est toujours
// centré sur une personne, donc on ouvre celui de la personne la mieux reliée
// (parents + conjoints + enfants). À défaut de liens familiaux, on prend la
// première personne disponible.
function openBestTree() {
  const people = [...state.people.values()];
  if (!people.length) {
    openPanel(`<p class="desc">Aucune personne à afficher pour l'instant.</p>`);
    return;
  }
  const childCount = new Map();
  people.forEach(p => {
    (p.parents || []).forEach(par => {
      childCount.set(par.id, (childCount.get(par.id) || 0) + 1);
    });
  });
  const score = (p) =>
    (p.parents || []).length + (p.spouses || []).length + (childCount.get(p.id) || 0);
  let best = people[0];
  let bestScore = score(best);
  for (const p of people) {
    const s = score(p);
    if (s > bestScore) { best = p; bestScore = s; }
  }
  navigateTo('arbre', best.id);
}

const treeMenuBtn = document.getElementById('menu-tree');
if (treeMenuBtn) treeMenuBtn.addEventListener('click', openBestTree);

function openStoryFocus(storyId) {
  const story = state.stories.find(s => s.id === storyId);
  if (!story) {
    openPanel(`<p class="desc">Récit introuvable.</p>`);
    return;
  }
  openPanel(`
    <div class="entity-header">
      <span class="entity-kind">📖 Récit</span>
      <h2>${story.title ? renderBodyWithMentions(story.title, story.titleMentions) : '(sans titre)'}</h2>
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

  // Bloc "raconté par" : mis en avant plutôt que mélangé aux autres méta.
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

  // Chaque média est marqué data-lightbox-media pour que la lightbox
  // (js/lightbox.js) puisse l'agrandir / cycler entre eux. Pour l'audio
  // et la vidéo, on ajoute un bouton ↗ d'expansion : le clic sur la
  // surface de lecture est réservé aux contrôles natifs (play/pause).
  const media = (s.mediaFiles || []).map((f, i) => {
    if (!f.url) return '';
    const cap = f.caption ? `data-caption="${escapeAttr(f.caption)}"` : '';
    const mediaId = `m-${escapeAttr(s.id)}-${i}`;
    const altCap = escapeAttr(f.caption || '');
    if (f.mime && f.mime.startsWith('image/')) {
      return `<img id="${mediaId}" data-lightbox-media src="${escapeAttr(f.url)}" loading="lazy" alt="${altCap}" ${cap} />`;
    }
    if (f.mime && f.mime.startsWith('audio/')) {
      return `<div class="media-clip">
          <audio id="${mediaId}" data-lightbox-media controls preload="metadata" src="${escapeAttr(f.url)}" ${cap}></audio>
          <button type="button" class="lb-expand" data-lightbox-target="${mediaId}" aria-label="Agrandir">↗</button>
        </div>`;
    }
    if (f.mime && f.mime.startsWith('video/')) {
      return `<div class="media-clip">
          <video id="${mediaId}" data-lightbox-media controls preload="metadata" src="${escapeAttr(f.url)}" style="max-width:100%" ${cap}></video>
          <button type="button" class="lb-expand" data-lightbox-target="${mediaId}" aria-label="Agrandir">↗</button>
        </div>`;
    }
    return `<p><a href="${escapeAttr(f.url)}" target="_blank" rel="noopener">Ouvrir le document</a></p>`;
  }).join('');

  // Complétions approuvées : chaque ajout attribué à son auteur·rice.
  const completions = (s.completions || [])
    .filter(c => c.status === 'approved')
    .map(c => renderCompletion(c, s.id)).join('');

  // Actions compactes placées juste après l'entête, pour qu'elles soient
  // visibles sans scroller : surtout sur mobile où le panel est un bottom
  // sheet court et où le corps du récit peut être long.
  const shareLabel = s.title ? s.title.replace(/<[^>]+>/g, '') : 'ce récit';
  const shareCaption = (s.body || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 240);
  const canRedact = state.mode === 'live' && hasRole('member');
  const actions = `
    <div class="story-actions">
      ${s.body ? `<button type="button" class="btn-ghost btn-listen" data-listen-kind="story" data-listen-id="${escapeAttr(s.id)}" title="Écouter ce récit à voix haute" aria-pressed="false">🔊 Écouter</button>` : ''}
      <button type="button" class="btn-ghost btn-complete-story" data-story-id="${escapeAttr(s.id)}" title="Ajouter un souvenir ou une précision à cette histoire">➕ Compléter</button>
      <button type="button" class="btn-ghost btn-propose-edit" data-entity-type="stories" data-entity-id="${escapeAttr(s.id)}" title="Proposer une correction du texte">✏️ Modifier</button>
      ${canRedact ? `<button type="button" class="btn-ghost btn-redact" data-story-id="${escapeAttr(s.id)}" title="Anonymiser ou censurer un passage (vie privée)">🕶️ Anonymiser</button>` : ''}
      <button type="button" class="btn-ghost btn-share" data-share-url="${escapeAttr(`${location.origin}/#/recit/${s.id}`)}" data-share-label="${escapeAttr(shareLabel)}" data-share-caption="${escapeAttr(shareCaption)}" title="Partager ce récit">📤 Partager</button>
    </div>
  `;

  return `
    <article class="story" data-story-id="${escapeAttr(s.id)}" data-lightbox-group>
      <h3>
        <span class="type-badge">${typeLabel}</span>
        <a href="#/recit/${encodeURIComponent(s.id)}" class="story-title">${s.title ? renderBodyWithMentions(s.title, s.titleMentions) : '(sans titre)'}</a>
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
  // Personne correspondante : le graphe reste cohérent.
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
      <div class="completion-body">${renderBodyWithMentions(c.body || '', c.mentions)}</div>
    </div>
  `;
}

function renderBodyWithMentions(body, mentions) {
  if (!mentions || !mentions.length) return renderEmphasisAndAutoLinks(body);
  const sorted = [...mentions].sort((a, b) => a.start - b.start);
  let html = '';
  let pos = 0;
  for (const m of sorted) {
    if (m.start < pos || m.end > body.length) continue;
    // Si la mention est entourée de ** dans le body, on absorbe les **
    // dans le rendu : le lien devient gras, les marqueurs disparaissent.
    const wrappedBold = m.start - 2 >= pos
      && body.slice(m.start - 2, m.start) === '**'
      && body.slice(m.end, m.end + 2) === '**';
    const preEnd    = wrappedBold ? m.start - 2 : m.start;
    const postStart = wrappedBold ? m.end + 2  : m.end;
    html += renderEmphasisAndAutoLinks(body.slice(pos, preEnd));
    const span = body.slice(m.start, m.end);
    html += inlineMention(m.type, m.entityId, span, { bold: wrappedBold });
    pos = postStart;
  }
  html += renderEmphasisAndAutoLinks(body.slice(pos));
  return html;
}

// Rend un texte brut en HTML : escape, puis transforme `**X**` en gras,
// `*X*` en italique, et auto-linke chaque occurrence d'un nom indexé
// (Lieu ou Personne, primaryName ou alias) vers sa fiche.
//
// Trois alternances dans un seul regex : bold, italic, nom. Chaque match
// produit un fragment HTML adéquat ; les portions intermédiaires sont
// simplement escapées.
// Whitelist d'URL pour les liens externes [texte](url) écrits par les
// contributeurs : http(s), mailto, ancres et chemins relatifs uniquement.
// Bloque javascript:, data:, etc.
function safeHrefExternal(url) {
  const u = String(url).trim();
  if (/^(https?:\/\/|mailto:|#|\/)/i.test(u)) return u;
  if (!/:/.test(u)) return u;
  return '#';
}

function renderEmphasisAndAutoLinks(rawText) {
  if (!rawText) return '';
  // Capture [label](url) (m[1]/m[2]), **bold** (m[3]), *italic* (m[4]),
  // nom auto-detect (m[5]). L'ordre compte : un lien explicite gagne sur
  // l'auto-détection (utile quand le label est aussi un nom indexé).
  const reSrc =
      '\\[([^\\]\\n]+)\\]\\(([^)\\n\\s]+)\\)'
    + '|\\*\\*([^*\\n]+)\\*\\*'
    + '|(?:^|(?<=[^*]))\\*([^*\\n]+)\\*(?!\\*)'
    + (namesIndex.altPattern
        ? '|(?<![\\p{L}\\d])(' + namesIndex.altPattern + ')(?![\\p{L}\\d])'
        : '');
  const re = new RegExp(reSrc, 'giu');
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(rawText)) !== null) {
    out += escapeHtml(rawText.slice(last, m.index));
    if (m[1] !== undefined) {
      // Lien externe explicite : [label](url). target=_blank pour ne pas
      // perdre le contexte de lecture du récit.
      const label = m[1];
      const safe = escapeAttr(safeHrefExternal(m[2]));
      out += `<a class="mention mention-external" href="${safe}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
    } else if (m[3] !== undefined) {
      // bold : le nom à l'intérieur peut aussi être un lien.
      const inner = m[3];
      const link = autoLinkForName(inner);
      out += link
        ? `<a ${link.attrs}><strong>${escapeHtml(inner)}</strong></a>`
        : `<strong>${escapeHtml(inner)}</strong>`;
    } else if (m[4] !== undefined) {
      const inner = m[4];
      const link = autoLinkForName(inner);
      out += link
        ? `<a ${link.attrs}><em>${escapeHtml(inner)}</em></a>`
        : `<em>${escapeHtml(inner)}</em>`;
    } else if (m[5] !== undefined) {
      // nom plain-text : auto-link direct.
      const inner = m[5];
      const link = autoLinkForName(inner);
      out += link ? `<a ${link.attrs}>${escapeHtml(inner)}</a>` : escapeHtml(inner);
    }
    last = m.index + m[0].length;
  }
  out += escapeHtml(rawText.slice(last));
  return out;
}


function autoLinkForName(rawText) {
  const key = String(rawText).toLowerCase().trim();
  if (!key) return null;
  const place = namesIndex.places.get(key);
  if (place) {
    return { attrs: `href="#/lieu/${encodeURIComponent(place.id)}" class="mention mention-place" title="${escapeAttr(place.primaryName)}"` };
  }
  const person = namesIndex.people.get(key);
  if (person) {
    return { attrs: `href="#/personne/${encodeURIComponent(person.id)}" class="mention mention-person" title="${escapeAttr(person.primaryName)}"` };
  }
  return null;
}

function inlineMention(type, id, span, opts = {}) {
  const label = type === 'person'
    ? (state.people.get(id)?.primaryName || id)
    : (state.places.get(id)?.primaryName || id);
  const typeSlug = type === 'person' ? 'personne' : 'lieu';
  const cls = `mention mention-${type}`;
  const inner = opts.bold
    ? `<strong>${escapeHtml(span)}</strong>`
    : escapeHtml(span);
  return `<a href="#/${typeSlug}/${encodeURIComponent(id)}" class="${cls}" title="${escapeAttr(label)}">${inner}</a>`;
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
// Mode déplacement de marker (admin) : pattern mire au centre de la
// carte + bouton Valider, comme la calibration cadastre. Le marker
// d'origine reste affiché en fondu pour repère ; on pane/zoome la
// carte sous la mire jusqu'à la nouvelle position, puis on valide.
// Tant qu'on n'a pas validé, libre de re-paner et re-zoomer autant
// qu'on veut : pas de drag-and-drop qui se valide à chaque relâché.

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
    <button type="button" class="btn-primary" id="move-banner-validate">✓ Placer ici</button>
    <button type="button" class="btn-ghost" id="move-banner-cancel">Annuler (ESC)</button>
  `;
  document.body.appendChild(_moveBanner);
  _moveBanner.querySelector('#move-banner-cancel')
    .addEventListener('click', exitMovePlaceMode);
  _moveBanner.querySelector('#move-banner-validate')
    .addEventListener('click', _validateMove);
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

  // On referme le panneau du lieu : sur PC c'est une fenêtre centrée avec un
  // fond grisé qui couvre toute la carte, sur mobile un bottom-sheet par-dessus
  // la carte. Tant qu'il est ouvert, impossible de paner sous la mire. Le
  // déplacement se fait justement en panant la carte, donc on libère la carte.
  // (validate rouvre la fiche via navigateTo ; sinon on reste sur la carte.)
  closePanel();

  // Centre la carte sur la position d'origine pour que la mire parte
  // pile sur le marker ; zoom au moins à 18 pour la précision.
  map.setView(_moveOriginalLatLng, Math.max(map.getZoom(), 18));
  marker.setOpacity(0.4);
  document.body.classList.add('move-mode');

  const banner = ensureMoveBanner();
  banner.querySelector('.move-banner-text').innerHTML =
    `🔧 <strong>Déplacement de</strong> <em>${escapeHtml(place.primaryName)}</em> : ` +
    `pane la carte pour amener la mire centrale sur la nouvelle position, puis tape ✓.`;
  banner.classList.add('active');

  _moveEscHandler = (e) => { if (e.key === 'Escape') exitMovePlaceMode(); };
  window.addEventListener('keydown', _moveEscHandler);
}

function exitMovePlaceMode() {
  if (!state.movePlaceId) return;
  const marker = state.markers.get(state.movePlaceId);
  if (marker) marker.setOpacity(1);
  state.movePlaceId = null;
  _moveOriginalLatLng = null;
  document.body.classList.remove('move-mode');
  if (_moveBanner) _moveBanner.classList.remove('active');
  if (_moveEscHandler) {
    window.removeEventListener('keydown', _moveEscHandler);
    _moveEscHandler = null;
  }
}

async function _validateMove() {
  const placeId = state.movePlaceId;
  if (!placeId) return;
  const newPos = map.getCenter();
  const place = state.places.get(placeId);
  const ok = confirm(
    `Déplacer « ${place ? place.primaryName : placeId} » ?\n\n` +
    `Avant : ${_moveOriginalLatLng.lat.toFixed(5)}, ${_moveOriginalLatLng.lng.toFixed(5)}\n` +
    `Après : ${newPos.lat.toFixed(5)}, ${newPos.lng.toFixed(5)}`,
  );
  if (!ok) return; // reste en mode déplacement, peut re-paner / re-zoomer
  try {
    const res = await fetch(`/api/admin/places/${encodeURIComponent(placeId)}/move`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: newPos.lat, lng: newPos.lng }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `${res.status}`);
    exitMovePlaceMode();
    await reload();
    if (location.hash !== `#/lieu/${placeId}`) navigateTo('lieu', placeId);
  } catch (err) {
    alert('Erreur lors du déplacement : ' + err.message);
  }
}

// ─── Bootstrap ──────────────────────────────────────────────────────────
reload().catch(err => {
  console.error(err);
  openPanel(`<p class="desc">Erreur au chargement : ${escapeHtml(err.message)}</p>`);
});
