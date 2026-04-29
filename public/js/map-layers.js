// Mémoire des Cévennes — sélecteur de fonds de carte et voyage dans le temps.
//
// Tuiles IGN servies par la Géoplateforme (https://data.geopf.fr/wmts) en
// accès libre, sans clé. Tout est ajouté en surimpression de la carte
// Leaflet déclarée dans app.js (variables globales `map` et
// `defaultBaseLayer`).
//
// Couches :
//   - OSM France (défaut, défini par app.js)
//   - IGN moderne, photos aériennes actuelles
//   - Photos aériennes 1950-1965
//   - Carte d'État-Major (1820-1866)
//   - Carte de Cassini (~1750)
//   - Overlay : cadastre actuel (parcelles)
//
// Comparaison passé/présent : un fond + une « couche au-dessus » +
// un slider qui module l'opacité du dessus pour fondre les deux.

(function () {
  if (typeof map === 'undefined' || !map) return;

  const IGN_BASE = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0';
  // La plupart des couches IGN utilisent le TileMatrixSet 'PM' (Pseudo-Mercator,
  // standard web). Quelques couches anciennes (Cassini) sont publiées sur des
  // sous-plages de zoom et utilisent 'PM_6_14' ou 'PM_0_14' — d'où le param.
  const ign = (layer, format = 'image/png', matrixSet = 'PM') =>
    `${IGN_BASE}&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=${matrixSet}` +
    `&FORMAT=${format}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;

  const ATTR_IGN = '© <a href="https://www.ign.fr/">IGN</a> – Géoplateforme';

  // Calibration cadastre — laissée à 0 pour l'instant. Une calibration
  // mono-point fait empirer Saint-Roman quand on cale sur Bourras (et
  // inversement) parce que les relevés napoléoniens ont une erreur
  // géométrique non uniforme. Pour vraiment corriger il faudra du
  // multi-points + transform affine. L'infrastructure (ShiftedTileLayer
  // + onglet « 🎯 Cadastre » de /admin.html) reste prête pour ça.
  const CADASTRE_SHIFT_LAT = 0;
  const CADASTRE_SHIFT_LNG = 0;

  // Sous-classe de TileLayer qui décale le rendu d'un offset lat/lng
  // constant. Le calcul se fait en pixels au zoom de chaque tuile : on
  // projette le centre de la carte avant et après application du shift,
  // et on ajoute la différence à la position de chaque tuile. Le tile
  // range chargé reste celui du viewport standard — pour des shifts
  // sub-tile (notre cas, ~20 px max au zoom max) le keepBuffer Leaflet
  // par défaut suffit, pas de gap visible.
  const ShiftedTileLayer = L.TileLayer.extend({
    options: { shiftLat: 0, shiftLng: 0 },
    _getTilePos: function (coords) {
      const pos = L.TileLayer.prototype._getTilePos.call(this, coords);
      if (!this._map || this._tileZoom == null) return pos;
      const sLat = this.options.shiftLat;
      const sLng = this.options.shiftLng;
      if (!sLat && !sLng) return pos;
      const center = this._map.getCenter();
      const z = this._tileZoom;
      const a = this._map.project(center, z);
      const b = this._map.project(
        L.latLng(center.lat + sLat, center.lng + sLng), z
      );
      return pos.add([b.x - a.x, b.y - a.y]);
    },
  });

  const BASES = {
    osm: {
      label: 'OSM (défaut)',
      layer: defaultBaseLayer,
    },
    ign: {
      label: 'IGN moderne',
      layer: L.tileLayer(ign('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2'), {
        maxNativeZoom: 18, maxZoom: 22, attribution: ATTR_IGN,
      }),
    },
    photo: {
      label: 'Photo aérienne (auj.)',
      layer: L.tileLayer(ign('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'), {
        maxNativeZoom: 19, maxZoom: 22, attribution: ATTR_IGN,
      }),
    },
    photo1950: {
      label: 'Photo aérienne 1950-65',
      layer: L.tileLayer(ign('ORTHOIMAGERY.ORTHOPHOTOS.1950-1965'), {
        maxNativeZoom: 18, maxZoom: 22, attribution: ATTR_IGN,
      }),
    },
    etatmajor: {
      label: "Carte d'État-Major (1820-66)",
      layer: L.tileLayer(ign('GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40', 'image/jpeg'), {
        maxNativeZoom: 15, maxZoom: 22, attribution: ATTR_IGN,
      }),
    },
    cassini: {
      label: 'Carte de Cassini (~1750)',
      // Édition BNF (Bibliothèque Nationale de France) : PNG, plus détaillée
      // visuellement que la version Archives Nationales. Couvre les niveaux
      // de zoom 6 à 14 — d'où le TileMatrixSet 'PM_6_14'.
      layer: L.tileLayer(ign('BNF-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI', 'image/png', 'PM_6_14'), {
        minZoom: 6, maxNativeZoom: 14, maxZoom: 22, attribution: ATTR_IGN,
      }),
    },
  };

  // maxNativeZoom à 19 (et non 20) : IGN ne sert pas toujours les tuiles
  // cadastre au niveau 20 dans les zones rurales cévenoles, ce qui faisait
  // disparaître le calque dès qu'on zoomait à fond. À 19 c'est garanti, et
  // Leaflet upscale proprement jusqu'à maxZoom (22) — flou mais visible.
  const cadastreLayer = new ShiftedTileLayer(ign('CADASTRALPARCELS.PARCELLAIRE_EXPRESS'), {
    maxNativeZoom: 19, maxZoom: 22, opacity: 0.75,
    attribution: ATTR_IGN + ' – Cadastre',
    shiftLat: CADASTRE_SHIFT_LAT,
    shiftLng: CADASTRE_SHIFT_LNG,
  });

  let activeBaseKey = 'osm';
  let cadastreOn = false;
  let overlayKey = null; // null si pas de couche de comparaison

  function bringOverlaysToFront() {
    if (overlayKey && BASES[overlayKey]) BASES[overlayKey].layer.bringToFront();
    if (cadastreOn) cadastreLayer.bringToFront();
  }

  function setBase(key) {
    if (!BASES[key] || activeBaseKey === key) return;
    // Si l'overlay actuel est la nouvelle base, on retire l'overlay
    // (impossible d'avoir la même couche en base ET au-dessus).
    if (overlayKey === key) setOverlay(null);
    map.removeLayer(BASES[activeBaseKey].layer);
    BASES[key].layer.addTo(map);
    BASES[key].layer.setOpacity(1);
    activeBaseKey = key;
    bringOverlaysToFront();

    panel.querySelectorAll('input[name="mdc-base"]').forEach((r) => {
      r.checked = (r.value === key);
    });
    panel.querySelectorAll('.map-layers-timeline button').forEach((b) => {
      b.classList.toggle('active', b.dataset.base === key);
    });
    syncOverlaySelect();
  }

  function setOverlay(key) {
    // Retire l'ancien overlay s'il existe
    if (overlayKey && BASES[overlayKey]) {
      map.removeLayer(BASES[overlayKey].layer);
      BASES[overlayKey].layer.setOpacity(1);
    }
    if (key && key !== activeBaseKey && BASES[key]) {
      overlayKey = key;
      const layer = BASES[key].layer;
      layer.addTo(map);
      layer.setOpacity(opacitySlider.value / 100);
      bringOverlaysToFront();
    } else {
      overlayKey = null;
    }
    opacityRow.classList.toggle('disabled', !overlayKey);
    if (overlaySelect) overlaySelect.value = overlayKey || 'none';
  }

  function setCadastre(on) {
    cadastreOn = on;
    if (on) cadastreLayer.addTo(map);
    else map.removeLayer(cadastreLayer);
    bringOverlaysToFront();
  }

  function syncOverlaySelect() {
    if (!overlaySelect) return;
    Array.from(overlaySelect.options).forEach((opt) => {
      if (opt.value === 'none') return;
      // On masque la base active dans la liste pour éviter de la
      // proposer comme couche au-dessus d'elle-même.
      opt.hidden = (opt.value === activeBaseKey);
    });
    if (overlayKey === activeBaseKey) overlaySelect.value = 'none';
  }

  // ─── UI ──────────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.className = 'map-layers';
  panel.innerHTML = `
    <button type="button" class="map-layers-toggle" aria-expanded="false"
            aria-controls="map-layers-body">
      <span aria-hidden="true">🗺</span> Couches
    </button>
    <div class="map-layers-body" id="map-layers-body" hidden>
      <fieldset class="map-layers-bases">
        <legend>Fond de carte</legend>
        ${Object.entries(BASES).map(([k, b]) => `
          <label>
            <input type="radio" name="mdc-base" value="${k}" ${k === 'osm' ? 'checked' : ''} />
            <span>${b.label}</span>
          </label>
        `).join('')}
      </fieldset>
      <label class="map-layers-overlay-select">
        <span>Comparer avec (au-dessus)</span>
        <select id="mdc-overlay">
          <option value="none">— Aucune —</option>
          ${Object.entries(BASES).map(([k, b]) => `
            <option value="${k}">${b.label}</option>
          `).join('')}
        </select>
      </label>
      <div class="map-layers-opacity disabled" id="map-layers-opacity">
        <label for="mdc-opacity">Opacité de la couche au-dessus</label>
        <input type="range" id="mdc-opacity" min="0" max="100" value="60" step="5" />
      </div>
      <label class="map-layers-overlay">
        <input type="checkbox" id="mdc-cadastre" />
        <span>Cadastre actuel (parcelles)</span>
      </label>
      <div class="map-layers-timeline" role="group" aria-label="Voyager dans le temps">
        <button type="button" data-base="cassini">~1750</button>
        <button type="button" data-base="etatmajor">1830</button>
        <button type="button" data-base="photo1950">1950</button>
        <button type="button" data-base="osm" class="active">Auj.</button>
      </div>
    </div>
  `;

  // Empêche les clics et le scroll dans le panneau de drager/zoomer la carte.
  L.DomEvent.disableClickPropagation(panel);
  L.DomEvent.disableScrollPropagation(panel);

  // Posé dans #map (pas dans <main>) pour que le `bottom: 10px` soit
  // relatif à la zone carte, pas sous le footer du site.
  document.getElementById('map').appendChild(panel);

  const toggle = panel.querySelector('.map-layers-toggle');
  const body = panel.querySelector('.map-layers-body');
  const opacitySlider = panel.querySelector('#mdc-opacity');
  const opacityRow = panel.querySelector('#map-layers-opacity');
  const overlaySelect = panel.querySelector('#mdc-overlay');

  syncOverlaySelect();

  function closePanel() {
    if (body.hasAttribute('hidden')) return;
    body.setAttribute('hidden', '');
    toggle.setAttribute('aria-expanded', 'false');
  }
  function openPanel() {
    if (!body.hasAttribute('hidden')) return;
    body.removeAttribute('hidden');
    toggle.setAttribute('aria-expanded', 'true');
  }

  toggle.addEventListener('click', () => {
    if (body.hasAttribute('hidden')) openPanel();
    else closePanel();
  });

  // Tap n'importe où ailleurs (carte, sidebar, header) → fermeture.
  // pointerdown couvre clic souris + tap tactile et se déclenche avant
  // click, ce qui évite le flash d'ouverture/fermeture sur mobile.
  // disableClickPropagation au-dessus empêche les taps DANS le panneau
  // d'atteindre Leaflet, mais pointerdown remonte quand même au document
  // — d'où le contains() pour ne pas se fermer en cliquant un radio.
  document.addEventListener('pointerdown', (e) => {
    if (body.hasAttribute('hidden')) return;
    if (panel.contains(e.target)) return;
    closePanel();
  });

  panel.querySelectorAll('input[name="mdc-base"]').forEach((r) => {
    r.addEventListener('change', () => setBase(r.value));
  });
  panel.querySelector('#mdc-cadastre').addEventListener('change', (e) => {
    setCadastre(e.target.checked);
  });
  overlaySelect.addEventListener('change', () => {
    setOverlay(overlaySelect.value === 'none' ? null : overlaySelect.value);
  });
  opacitySlider.addEventListener('input', () => {
    if (overlayKey && BASES[overlayKey]) {
      BASES[overlayKey].layer.setOpacity(opacitySlider.value / 100);
    }
  });
  panel.querySelectorAll('.map-layers-timeline button').forEach((b) => {
    b.addEventListener('click', () => setBase(b.dataset.base));
  });
})();
