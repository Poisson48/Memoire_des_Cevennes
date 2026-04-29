// Onglet « Cadastre (avancé) » — outil de calibration du décalage
// cadastre IGN ↔ orthophoto, calibré visuellement sur Saint-Roman.
//
// UX tactile : pas de drag-and-drop. Une mire fixe au centre de la carte,
// l'utilisateur paname/zoome jusqu'à ce que la mire soit pile sur le
// repère, et tape « Poser ». Étape 1 = vraie position (rouge).
// Étape 2 = position selon le cadastre (bleu). On affiche le décalage.

(function () {
  'use strict';

  const BOURRAS = [44.00918, 3.79003];
  const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  const LEAFLET_JS  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

  let map = null;
  let realPoint = null;
  let cadPoint = null;
  let realMarker = null;
  let cadMarker = null;
  let lineLayer = null;

  function loadLeaflet(cb) {
    if (window.L) return cb();
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = LEAFLET_CSS;
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = LEAFLET_JS;
    s.onload = cb;
    s.onerror = () => alert('Erreur de chargement Leaflet (vérifie le réseau).');
    document.head.appendChild(s);
  }

  function makeIcon(color) {
    return L.divIcon({
      className: '',
      html: '<div style="width:14px;height:14px;border-radius:50%;background:' + color +
            ';border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,0.6);"></div>',
      iconSize: [14, 14], iconAnchor: [7, 7],
    });
  }

  function init() {
    const container = document.getElementById('cadastre-map');
    if (!container || map) return;

    map = L.map(container, { maxZoom: 22 }).setView(BOURRAS, 19);

    const IGN = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0';
    const photoUrl = IGN + '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM' +
                     '&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';
    const cadUrl   = IGN + '&LAYER=CADASTRALPARCELS.PARCELLAIRE_EXPRESS&STYLE=normal&TILEMATRIXSET=PM' +
                     '&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';

    L.tileLayer(photoUrl, {
      maxNativeZoom: 19, maxZoom: 22,
      attribution: '© IGN — Géoplateforme',
    }).addTo(map);

    L.tileLayer(cadUrl, {
      maxNativeZoom: 20, maxZoom: 22, opacity: 0.85,
      attribution: '© IGN — Cadastre',
    }).addTo(map);

    document.getElementById('cadastre-pose').addEventListener('click', poseAtCenter);
    document.getElementById('cadastre-reset').addEventListener('click', reset);

    updateUi();
  }

  function poseAtCenter() {
    const ll = map.getCenter();
    if (!realPoint) {
      realPoint = ll;
      realMarker = L.marker(ll, { icon: makeIcon('#d63b3b') }).addTo(map);
    } else if (!cadPoint) {
      cadPoint = ll;
      cadMarker = L.marker(ll, { icon: makeIcon('#2266cc') }).addTo(map);
      compute();
    }
    updateUi();
  }

  function reset() {
    if (realMarker) map.removeLayer(realMarker);
    if (cadMarker)  map.removeLayer(cadMarker);
    if (lineLayer)  map.removeLayer(lineLayer);
    realPoint = cadPoint = null;
    realMarker = cadMarker = lineLayer = null;
    const r = document.getElementById('cadastre-result');
    r.textContent = '';
    r.hidden = true;
    updateUi();
  }

  function updateUi() {
    const btn = document.getElementById('cadastre-pose');
    if (!btn) return;
    if (!realPoint) {
      btn.textContent = '① Poser le point réalité (rouge)';
      btn.disabled = false;
    } else if (!cadPoint) {
      btn.textContent = '② Poser le point cadastre (bleu)';
      btn.disabled = false;
    } else {
      btn.textContent = '✓ Terminé — réinitialiser pour recommencer';
      btn.disabled = true;
    }
  }

  function compute() {
    const dLat = realPoint.lat - cadPoint.lat;
    const dLng = realPoint.lng - cadPoint.lng;
    const meanLat = (realPoint.lat + cadPoint.lat) / 2;
    const dMetersLat = dLat * 111111;
    const dMetersLng = dLng * 111111 * Math.cos(meanLat * Math.PI / 180);
    const distance = Math.sqrt(dMetersLat * dMetersLat + dMetersLng * dMetersLng);
    const bearing = (Math.atan2(dMetersLng, dMetersLat) * 180 / Math.PI + 360) % 360;

    const text = [
      'Réalité   : ' + realPoint.lat.toFixed(7) + ', ' + realPoint.lng.toFixed(7),
      'Cadastre  : ' + cadPoint.lat.toFixed(7)  + ', ' + cadPoint.lng.toFixed(7),
      '',
      'Δ latitude  : ' + dLat.toFixed(7) + '°  (' + dMetersLat.toFixed(2) + ' m, ' +
        (dMetersLat >= 0 ? 'N' : 'S') + ')',
      'Δ longitude : ' + dLng.toFixed(7) + '°  (' + dMetersLng.toFixed(2) + ' m, ' +
        (dMetersLng >= 0 ? 'E' : 'O') + ')',
      'Distance    : ' + distance.toFixed(2) + ' m',
      'Direction   : ' + bearing.toFixed(0) + '° (cadastre → réalité)',
      '',
      'À appliquer au calque cadastre :',
      '  shiftLat = ' + dLat.toFixed(7),
      '  shiftLng = ' + dLng.toFixed(7),
    ].join('\n');

    const r = document.getElementById('cadastre-result');
    r.textContent = text;
    r.hidden = false;

    lineLayer = L.polyline([realPoint, cadPoint], {
      color: '#000', weight: 1, dashArray: '4,4', interactive: false,
    }).addTo(map);
  }

  // Appelé par admin.js quand on clique sur l'onglet
  window.cadastreCalibrationActivate = function () {
    loadLeaflet(() => {
      init();
      // Le conteneur a peut-être été redimensionné depuis sa création
      // (changement de viewport, ouverture d'onglet pour la première
      // fois). On force Leaflet à recalculer.
      if (map) setTimeout(() => map.invalidateSize(), 80);
    });
  };
})();
