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
//   - Photos aériennes 1950-1965 (cadastre napoléonien à venir, voir phase 2)
//   - Carte d'État-Major (1820-1866)
//   - Carte de Cassini (~1750)
//   - Overlay : cadastre actuel (parcelles)

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

  const BASES = {
    osm: {
      label: 'OSM (défaut)',
      layer: defaultBaseLayer,
    },
    ign: {
      label: 'IGN moderne',
      layer: L.tileLayer(ign('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2'), {
        maxNativeZoom: 18, maxZoom: 19, attribution: ATTR_IGN,
      }),
    },
    photo: {
      label: 'Photo aérienne (auj.)',
      layer: L.tileLayer(ign('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'), {
        maxNativeZoom: 19, maxZoom: 19, attribution: ATTR_IGN,
      }),
    },
    photo1950: {
      label: 'Photo aérienne 1950-65',
      layer: L.tileLayer(ign('ORTHOIMAGERY.ORTHOPHOTOS.1950-1965'), {
        maxNativeZoom: 18, maxZoom: 19, attribution: ATTR_IGN,
      }),
    },
    etatmajor: {
      label: "Carte d'État-Major (1820-66)",
      layer: L.tileLayer(ign('GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40', 'image/jpeg'), {
        maxNativeZoom: 15, maxZoom: 19, attribution: ATTR_IGN,
      }),
    },
    cassini: {
      label: 'Carte de Cassini (~1750)',
      // Édition BNF (Bibliothèque Nationale de France) : PNG, plus détaillée
      // visuellement que la version Archives Nationales. Couvre les niveaux
      // de zoom 6 à 14 — d'où le TileMatrixSet 'PM_6_14'.
      layer: L.tileLayer(ign('BNF-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI', 'image/png', 'PM_6_14'), {
        minZoom: 6, maxNativeZoom: 14, maxZoom: 19, attribution: ATTR_IGN,
      }),
    },
  };

  const cadastreLayer = L.tileLayer(ign('CADASTRALPARCELS.PARCELLAIRE_EXPRESS'), {
    maxNativeZoom: 20, maxZoom: 20, opacity: 0.75,
    attribution: ATTR_IGN + ' – Cadastre',
  });

  let activeBaseKey = 'osm';
  let cadastreOn = false;

  function setBase(key) {
    if (!BASES[key] || activeBaseKey === key) return;
    map.removeLayer(BASES[activeBaseKey].layer);
    BASES[key].layer.addTo(map);
    BASES[key].layer.setOpacity(opacitySlider.value / 100);
    if (cadastreOn) cadastreLayer.bringToFront();
    activeBaseKey = key;

    panel.querySelectorAll('input[name="mdc-base"]').forEach((r) => {
      r.checked = (r.value === key);
    });
    panel.querySelectorAll('.map-layers-timeline button').forEach((b) => {
      b.classList.toggle('active', b.dataset.base === key);
    });
    // L'opacité est sans intérêt sur OSM (qui devient blanc) — on grise.
    opacityRow.classList.toggle('disabled', key === 'osm');
  }

  function setCadastre(on) {
    cadastreOn = on;
    if (on) cadastreLayer.addTo(map).bringToFront();
    else map.removeLayer(cadastreLayer);
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
      <label class="map-layers-overlay">
        <input type="checkbox" id="mdc-cadastre" />
        <span>Cadastre actuel (parcelles)</span>
      </label>
      <div class="map-layers-opacity disabled" id="map-layers-opacity">
        <label for="mdc-opacity">Opacité du fond</label>
        <input type="range" id="mdc-opacity" min="20" max="100" value="100" step="5" />
      </div>
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

  toggle.addEventListener('click', () => {
    const willOpen = body.hasAttribute('hidden');
    if (willOpen) body.removeAttribute('hidden');
    else body.setAttribute('hidden', '');
    toggle.setAttribute('aria-expanded', String(willOpen));
  });

  panel.querySelectorAll('input[name="mdc-base"]').forEach((r) => {
    r.addEventListener('change', () => setBase(r.value));
  });
  panel.querySelector('#mdc-cadastre').addEventListener('change', (e) => {
    setCadastre(e.target.checked);
  });
  opacitySlider.addEventListener('input', () => {
    BASES[activeBaseKey].layer.setOpacity(opacitySlider.value / 100);
  });
  panel.querySelectorAll('.map-layers-timeline button').forEach((b) => {
    b.addEventListener('click', () => setBase(b.dataset.base));
  });
})();
