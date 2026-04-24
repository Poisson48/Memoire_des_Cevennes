// Mémoire des Cévennes — recherche d'adresse + géolocalisation
//
// Deux aides pour poser un lieu sans se battre avec le zoom :
//   1. Recherche d'adresse (Nominatim/OSM) en surimpression sur la carte.
//      L'utilisateur tape une adresse / un village / un lieu-dit et la
//      carte s'y positionne — biaisée sur les Cévennes, mais non bornée.
//   2. Géolocalisation (navigator.geolocation) : deux entrées,
//        - bouton dans l'astuce d'ajout (pose directe + ouvre la modale),
//        - bouton dans la modale (corrige la position après coup).
//
// Chargé APRÈS app.js et forms.js. On s'appuie sur `map`, `state.addMode`,
// et la fonction globale `setPendingLatLng`, exposés en script-scope.
//
// Enveloppé dans une IIFE pour éviter les collisions de noms avec les
// autres modules (tagger.js utilise aussi `searchTimer`/`runSearch`).

(() => {

// ── Config Nominatim ──────────────────────────────────────────────────
// Viewbox large autour des Cévennes pour biaiser les suggestions sans
// les limiter — si la personne cherche Montpellier ou Paris, ça marche
// quand même.
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const CEVENNES_VIEWBOX = '3.3,44.5,4.3,43.7';   // lon1,lat1,lon2,lat2
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MIN_CHARS = 3;
const SEARCH_ZOOM = 16;

// ── DOM refs ──────────────────────────────────────────────────────────
const searchInput = document.getElementById('map-search-input');
const searchClear = document.getElementById('map-search-clear');
const searchResults = document.getElementById('map-search-results');
const locateBtnHint = document.getElementById('btn-locate-me');
const locateBtnDialog = document.getElementById('btn-locate-me-dialog');

// ─── Recherche d'adresse ──────────────────────────────────────────────
let searchTimer = null;
let searchAbort = null;
let searchMarker = null;

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  searchClear.hidden = q.length === 0;
  clearTimeout(searchTimer);
  if (q.length < SEARCH_MIN_CHARS) {
    hideResults();
    return;
  }
  searchTimer = setTimeout(() => runSearch(q), SEARCH_DEBOUNCE_MS);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(searchTimer);
    const first = searchResults.querySelector('li[data-lat]');
    if (first) selectResult(first);
    else runSearch(searchInput.value.trim(), { pickFirst: true });
  } else if (e.key === 'Escape') {
    hideResults();
  }
});

searchInput.addEventListener('focus', () => {
  if (searchResults.children.length) searchResults.hidden = false;
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#map-search')) hideResults();
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.hidden = true;
  hideResults();
  if (searchMarker) { map.removeLayer(searchMarker); searchMarker = null; }
  searchInput.focus();
});

async function runSearch(q, { pickFirst = false } = {}) {
  if (!q) return;
  if (searchAbort) searchAbort.abort();
  searchAbort = new AbortController();
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('format', 'json');
  url.searchParams.set('q', q);
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '6');
  url.searchParams.set('countrycodes', 'fr');
  url.searchParams.set('viewbox', CEVENNES_VIEWBOX);
  url.searchParams.set('bounded', '0');
  url.searchParams.set('accept-language', 'fr');
  try {
    const res = await fetch(url.toString(), { signal: searchAbort.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const items = await res.json();
    renderResults(items);
    if (pickFirst && items.length) {
      selectResult(searchResults.querySelector('li[data-lat]'));
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    renderResults([], 'Recherche indisponible (réessaye dans un instant).');
  }
}

function renderResults(items, errorMsg) {
  searchResults.innerHTML = '';
  if (errorMsg) {
    const li = document.createElement('li');
    li.className = 'map-search-error';
    li.textContent = errorMsg;
    searchResults.appendChild(li);
    searchResults.hidden = false;
    return;
  }
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'map-search-empty';
    li.textContent = 'Aucun résultat.';
    searchResults.appendChild(li);
    searchResults.hidden = false;
    return;
  }
  for (const it of items) {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.dataset.lat = it.lat;
    li.dataset.lng = it.lon;
    li.dataset.label = it.display_name;
    const primary = document.createElement('strong');
    primary.textContent = shortLabel(it);
    const secondary = document.createElement('span');
    secondary.className = 'map-search-ctx';
    secondary.textContent = contextLabel(it);
    li.appendChild(primary);
    if (secondary.textContent) li.appendChild(secondary);
    li.addEventListener('click', () => selectResult(li));
    searchResults.appendChild(li);
  }
  searchResults.hidden = false;
}

function shortLabel(it) {
  const a = it.address || {};
  return a.village || a.town || a.city || a.hamlet || a.locality
      || a.road || a.suburb || a.neighbourhood
      || (it.display_name || '').split(',')[0];
}

function contextLabel(it) {
  const a = it.address || {};
  const parts = [];
  if (a.road && shortLabel(it) !== a.road) parts.push(a.road);
  const town = a.village || a.town || a.city || a.hamlet;
  if (town && town !== shortLabel(it)) parts.push(town);
  if (a.county && !parts.includes(a.county)) parts.push(a.county);
  return parts.slice(0, 3).join(' · ');
}

function selectResult(li) {
  if (!li || !li.dataset.lat) return;
  const lat = parseFloat(li.dataset.lat);
  const lng = parseFloat(li.dataset.lng);
  map.flyTo([lat, lng], SEARCH_ZOOM, { duration: 0.8 });
  if (searchMarker) map.removeLayer(searchMarker);
  searchMarker = L.circleMarker([lat, lng], {
    radius: 9, color: '#8c5a2b', weight: 2,
    fillColor: '#d9a55a', fillOpacity: 0.6,
  }).addTo(map);
  searchInput.value = li.dataset.label.split(',').slice(0, 2).join(', ');
  searchClear.hidden = false;
  hideResults();
}

function hideResults() {
  searchResults.hidden = true;
}

// ─── Géolocalisation ──────────────────────────────────────────────────
// Réutilisée pour les 2 boutons. On centre la carte, on pose une pin
// (si on est en add mode) ou on ouvre directement le dialogue via
// map.fire('click').
function geolocate({ onSuccess, onError }) {
  if (!('geolocation' in navigator)) {
    onError('La géolocalisation n\'est pas disponible sur cet appareil.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => onSuccess(L.latLng(pos.coords.latitude, pos.coords.longitude), pos.coords.accuracy),
    (err) => {
      const msgs = {
        1: 'Autorisation refusée — active la localisation dans les réglages du navigateur.',
        2: 'Position indisponible — réessaye dans un instant.',
        3: 'La localisation met trop de temps à répondre.',
      };
      onError(msgs[err.code] || ('Erreur : ' + err.message));
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
  );
}

function setLocating(btn, on) {
  if (!btn) return;
  btn.disabled = on;
  btn.dataset.originalLabel = btn.dataset.originalLabel || btn.textContent;
  btn.textContent = on ? '📡 Localisation…' : btn.dataset.originalLabel;
}

// Bouton dans l'astuce d'ajout : pose directe + ouvre la modale.
if (locateBtnHint) {
  locateBtnHint.addEventListener('click', (e) => {
    e.preventDefault();
    if (!state.addMode) return;
    setLocating(locateBtnHint, true);
    geolocate({
      onSuccess: (latlng) => {
        setLocating(locateBtnHint, false);
        map.flyTo(latlng, Math.max(map.getZoom(), SEARCH_ZOOM), { duration: 0.6 });
        // Simule un clic carte en mode add → forms.js prend le relais et
        // ouvre dlgPlace avec cette latlng stockée dans pendingLatLng.
        map.fire('click', { latlng });
      },
      onError: (msg) => {
        setLocating(locateBtnHint, false);
        alert(msg);
      },
    });
  });
}

// Bouton dans la modale : corrige la position sans fermer le dialogue.
if (locateBtnDialog) {
  locateBtnDialog.addEventListener('click', (e) => {
    e.preventDefault();
    setLocating(locateBtnDialog, true);
    geolocate({
      onSuccess: (latlng) => {
        setLocating(locateBtnDialog, false);
        setPendingLatLng(latlng);
        map.flyTo(latlng, Math.max(map.getZoom(), SEARCH_ZOOM), { duration: 0.6 });
      },
      onError: (msg) => {
        setLocating(locateBtnDialog, false);
        alert(msg);
      },
    });
  });
}

})();
