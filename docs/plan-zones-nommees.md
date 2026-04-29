# Plan — Zones nommées (vallons, hameaux étendus, micro-régions)

Statut : **prêt à coder** — implémentation prévue ce week-end (2-3 mai 2026).

À ne pas confondre avec [`plan-zone-osm.md`](plan-zone-osm.md), qui décrit
la **zone-racine d'une instance** (1 commune ou département choisi via
OpenStreetMap au déploiement). Le présent document décrit des **sous-zones
nommées** dessinées par l'admin à l'intérieur de la zone couverte —
vallons, hameaux étendus, parcelles historiques, micro-toponymes — qui
servent de repère contextuel sur la carte.

## Objectif

1. Permettre à l'admin de tracer des polygones nommés sur la carte
   (« Vallon du Vidourle », « Vallon du Récodier », « Vallon du Savel »…).
2. Afficher un **overlay « tu es ici »** qui suit le centre de la carte
   et indique : la coordonnée brute + la liste des zones qui contiennent
   ce point + la commune de rattachement.
3. À terme, brancher les Lieux et Récits aux zones via `zoneId` (filtrable
   par zone, statistiques par zone).

## Modèle de données

### `data/zones.json` — nouveau fichier

```json
{
  "zones": [
    {
      "id": "vallon-du-vidourle-saint-roman",
      "primaryName": "Vallon du Vidourle",
      "description": "Vallon du cours supérieur du Vidourle, traversant Saint-Roman-de-Codières d'est en ouest. Point de partage des eaux avec l'Hérault.",
      "color": "#3b82d6",
      "polygon": {
        "type": "Polygon",
        "coordinates": [[[3.77, 44.00], [3.79, 44.01], [3.80, 43.99], [3.77, 44.00]]]
      },
      "aliases": [{ "name": "Vallée du Vidourle" }],
      "visibility": "public",
      "createdAt": "...",
      "status": "approved",
      "submittedAt": "...",
      "submittedBy": { "name": "..." },
      "reviewedAt": "...",
      "reviewedBy": "..."
    }
  ],
  "updatedAt": "..."
}
```

Mêmes conventions que `places.json` / `people.json` :
- Modération via `status` (`pending`/`approved`/`rejected`).
- `visibility` (`public`/`members`).
- `submittedBy` / `reviewedBy`.
- `aliases[]` au format `normAliases()` existant.

### Schéma — ajout dans `src/schema.js`

```js
function makeZone(input, existingIds) {
  const primaryName = str(input.primaryName || 'Zone sans nom', 160);
  const id = input.id ? str(input.id, 80) : uniqueId(slugify(primaryName), existingIds);
  const polygon = normPolygon(input.polygon); // valide GeoJSON Polygon ou MultiPolygon
  if (!polygon) throw new Error('polygon GeoJSON requis');
  return {
    id,
    primaryName,
    description: str(input.description, 5000),
    color: normColor(input.color) || '#3b82d6',
    polygon,
    aliases: normAliases(input.aliases),
    visibility: normVisibility(input.visibility),
    createdAt: new Date().toISOString(),
    ...freshModerationFields(input),
  };
}
```

`normPolygon` : accepte uniquement `type: "Polygon"` ou `type:
"MultiPolygon"`, vérifie que les coordonnées sont des `[lng, lat]` valides,
borne le nombre de points (≤ 5000 pour éviter les abus).

`normColor` : regex hex `#[0-9a-f]{6}` ou nom CSS court (`red`, `blue`…).

## Module — `src/zones.js`

Calque sur `src/people.js` / `src/places.js` :
```js
function list({ status }) { … }
function get(id) { … }
async function create(input) { … }
async function patch(id, fn) { … }
async function remove(id) { … }
```

Plus une fonction utilitaire **server-side** :
```js
// Renvoie la liste des zones (approuvées + visibles) qui contiennent
// le point [lng, lat]. Utilisée par les hooks de modération hors-zone.
function zonesContaining(lng, lat, { visibility = 'all' } = {}) { … }
```

Implémentation point-in-polygon : ray-casting maison (≤ 30 lignes,
voir « Pitfalls » plus bas pour les bords du polygone). Pas besoin de
`@turf/boolean-point-in-polygon` (~30 ko) pour ce volume (≤ 50 zones).

## API

### Public

```
GET  /api/zones                  → { zones: [...] }   // approved + filtre visibility
GET  /api/zones/:id              → { zone: {...} }
POST /api/zones                  → création (membre contributor+, status=pending)
```

Mêmes conventions que `/api/places` (filtre visibility, status par défaut
= approved, requireAuth pour POST).

### Admin

```
POST   /api/admin/zones/:id/approve
POST   /api/admin/zones/:id/reject
DELETE /api/admin/zones/:id
PATCH  /api/admin/zones/:id              → édition directe (polygone, couleur, etc.)
PATCH  /api/admin/zones/:id/aliases      → édition alias direct (suit le pattern v0.14.8)
```

L'édition directe (`PATCH /:id`) est utile parce que retracer un polygone
via la file de modération serait pénible.

## Frontend

### Carte — `public/js/app.js`

Au boot, `fetch('/api/zones')` puis pour chaque zone :

```js
const layer = L.geoJSON(zone.polygon, {
  style: {
    color: zone.color,
    weight: 1.5,
    fillColor: zone.color,
    fillOpacity: 0.07,
    interactive: false, // ne pas voler les clics aux markers de Lieux
  },
});
zonesLayerGroup.addLayer(layer);
```

Toggle dans le sélecteur de fonds (« Voir les zones / masquer »). Les
zones doivent rester en arrière-plan visuel, pas en avant — `bringToBack()`.

### Overlay « tu es ici » — nouveau composant

Petite boîte fixée en bas-gauche de la carte (sur mobile : bas-centre,
condensée) :

```
┌─────────────────────────────────────────┐
│ 📍 44.0027, 3.7786                      │
│   Vallon du Vidourle ·                  │
│   Saint-Roman-de-Codières               │
└─────────────────────────────────────────┘
```

Mise à jour sur `map.on('move', …)` avec un debounce 100 ms (le centre
change ~30 fois/s pendant le drag, inutile de recompter à cette
fréquence).

Logique :
1. Récupérer `map.getCenter()` → `{ lat, lng }`.
2. Filtrer `state.zones` avec `pointInPolygon([lng, lat], zone.polygon)`.
3. Bonus : afficher la commune de rattachement si une **zone-racine OSM**
   est définie (cf. `plan-zone-osm.md`). Sinon, afficher le Lieu le plus
   proche (distance plane).
4. Format : `nom de zone · nom de zone · commune`. Tronquer à 3 zones
   max si overlap.

### Module nouveau — `public/js/zones-overlay.js`

```js
window.ZonesOverlay = (function () {
  function pointInPolygon([x, y], polygon) {
    // ray-casting sur Polygon ou MultiPolygon (gère les "trous")
  }
  function zonesContaining(lng, lat, zones) {
    return zones.filter(z => pointInPolygon([lng, lat], z.polygon));
  }
  function init(map, getZones) {
    const box = document.createElement('div');
    box.className = 'zones-overlay';
    box.setAttribute('aria-live', 'polite');
    map.getContainer().appendChild(box);
    const update = debounce(() => {
      const c = map.getCenter();
      const inside = zonesContaining(c.lng, c.lat, getZones());
      box.innerHTML = renderHTML(c, inside);
    }, 100);
    map.on('move', update);
    update();
  }
  return { init, pointInPolygon, zonesContaining };
})();
```

### CSS — `public/css/style.css`

```css
.zones-overlay {
  position: absolute;
  left: 12px;
  bottom: 12px;
  background: rgba(255, 250, 242, 0.92);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 0.85rem;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  pointer-events: none;
  max-width: 60vw;
  z-index: 500;
}
.zones-overlay .coords { color: var(--muted); }
.zones-overlay .zone-name { font-weight: 600; }
@media (max-width: 600px) {
  .zones-overlay {
    left: 50%; transform: translateX(-50%);
    bottom: 8px;
    font-size: 0.78rem;
  }
}
```

## UI admin — onglet « Zones »

Nouvel onglet dans `/admin.html` à côté de « Alias » :

```
┌─ Zones ─────────────────────────────────────────────┐
│ [+ Nouvelle zone]                                   │
│ ────────────────────────────────────────────────    │
│ ▣ Vallon du Vidourle  (couleur #3b82d6)             │
│   Vallon du cours supérieur du Vidourle…            │
│   12 sommets · approved · 3 alias                   │
│   [✏️ Renommer] [🎨 Couleur] [🗺️ Re-tracer] [🗑️]  │
│ ▣ Vallon du Récodier  (couleur #b85a1f)             │
│   …                                                  │
└─────────────────────────────────────────────────────┘
```

Clic sur **+ Nouvelle zone** :
1. Modale plein écran avec carte centrée sur la zone-racine.
2. Plugin `leaflet-draw` (CDN, ~15 ko) chargé à la demande pour le
   tracé polygone uniquement (`L.Draw.Polygon`).
3. Inputs : nom, description, couleur (color picker HTML5 natif).
4. Soumission → `POST /api/zones` (passe en `pending` pour les
   contributeurs ; ou direct via une route admin dédiée
   `POST /api/admin/zones` qui crée déjà `approved`).

Clic sur **🗺️ Re-tracer** : ouvre la même modale, polygone existant
chargé en édition (`L.Edit.Poly`). PATCH au save.

## Modération hors-zone (bonus)

Si `data/zones.json` a au moins une zone et que `site_config.zone.strict`
est `true` : à la création d'un Lieu, vérifier que `[lng, lat]` est dans
au moins une zone publique. Sinon, refuser ou flagger selon le mode.
**Non bloquant par défaut**, juste un badge « hors zones » dans la file.

## Backup & migration

1. `SCHEMA_VERSION` : bump.
2. Ajouter `'zones'` à `DATA_FILES` dans `src/backup.js`.
3. Migration : si l'ancienne archive n'a pas de `zones.json`, on crée le
   fichier vide `{ "zones": [], "updatedAt": null }`.
4. Storage : ajouter `zones` à la liste de `FILES` et `KEY` dans
   `src/storage.js`.

## Étapes d'implémentation (ordre)

1. **Modèle + storage** (`src/schema.js#makeZone`, `src/zones.js`,
   ajout dans `storage.js`). ~1-2 h.
2. **API publique + admin** (`src/routes/zones.js` + extension
   `src/routes/admin.js`). ~1-2 h.
3. **Frontend lecture** : fetch des zones, tracé GeoJSON, overlay « tu
   es ici ». ~3-4 h.
4. **Admin UI tracé** : onglet, modale `leaflet-draw`, formulaire, save.
   ~3-4 h.
5. **Édition** : re-tracer, renommer, supprimer, alias (réutilise le
   pattern de v0.14.8). ~1-2 h.
6. **Backup + migration** : bump schema, ajout au tar.gz, test restore.
   ~1 h.
7. **Tests Playwright** : create zone via admin → vérifier overlay
   au drag de carte. ~1-2 h.
8. **Données initiales pour Saint-Roman** : tracer les vallons listés
   sur la fiche Wikipédia
   <https://fr.wikipedia.org/wiki/Saint-Roman-de-Codi%C3%A8res>
   (section Géographie / Hydrographie — c'est la source de référence,
   plus complète que les Cahiers du Haut-Vidourle qui n'en mentionnent
   que 3 : Récodier, Vidourle, Savel). Vérifier au moment du seed que
   la liste Wikipédia est cohérente avec le terrain ; idéalement faire
   le pointage à la main sur l'orthophoto IGN, pas seulement à partir
   des contours hydro OSM. Plus la commune englobante en zone parente.
   ~45 min de tracé.
9. **Doc** : section dans `aide.html` expliquant les zones côté visiteur.
   ~30 min.

**Total estimé : 1.5 - 2 jours de dev.**

## Pitfalls

- **Ray-casting et points sur les arêtes** : un point exactement sur la
  frontière peut être inclus dans 0 ou 2 polygones selon l'implémentation.
  Adopter la convention « top-left inclusif, bottom-right exclusif »
  (standard Leaflet/Mercator). Pas critique pour notre usage (le centre
  bouge en continu, on ne cliquera jamais pile sur une arête).
- **Polygones non-simples** (qui se croisent eux-mêmes) : `leaflet-draw`
  laisse passer. Soit on valide côté serveur (refuse si self-intersecting,
  via une lib comme `@turf/boolean-valid`), soit on accepte et le
  ray-casting donnera un résultat « pair-impair » bizarre mais déterministe.
  Décision : **on accepte**, on documente.
- **Performance overlay** : 50 zones × ray-casting (~10 vertices chacun)
  = ~500 ops par calcul, 10 fois/s → 5000 ops/s. Trivial. Pas besoin
  d'index spatial (R-tree, etc.).
- **Mobile et overlay** : penser à laisser de la place au-dessus des
  contrôles Leaflet (boutons +/-) et de la barre de statut iOS. Tester
  en portrait.
- **Couches Leaflet** : les zones doivent passer derrière les markers
  de Lieux mais devant le fond de carte. Utiliser `pane: 'overlayPane'`
  (défaut) ou créer un pane dédié `'zonesPane'` avec un z-index entre
  les tuiles et les markers.
- **Couleurs accessibles** : si l'admin choisit du jaune fluo + 7 %
  d'opacité, on ne voit rien. Le color picker HTML5 ne contraint pas.
  Suggérer une palette de 8 couleurs pré-sélectionnées + champ libre
  pour les irréductibles.
- **GeoJSON et ordre lng/lat** : GeoJSON officiel = `[lng, lat]`,
  Leaflet = `[lat, lng]`. Convention du projet : le **stockage** est en
  GeoJSON (`[lng, lat]`) ; les conversions se font à la frontière
  (constructeurs `L.geoJSON()` qui gèrent automatiquement, et
  `L.GeoJSON.coordsToLatLng` pour le manuel).

## Évolutions possibles

- **Imbrication de zones** : `parentId` sur une zone (ex. vallon =
  enfant de commune). L'overlay affiche la chaîne `vallon · commune ·
  pays`.
- **Statistiques par zone** : « 12 récits dans le Vallon du Vidourle ».
- **Filtrage par zone** dans la barre de recherche.
- **Import depuis OSM** : `relation = vallée du Vidourle` quand elle
  existe en OSM, fetch via Overpass au lieu de tracer à la main. Pour
  les vallons cévenols la couverture OSM est lacunaire ; Wikipédia
  reste la meilleure source narrative et l'orthophoto IGN la meilleure
  source géométrique.
- **Lien Lieu→Zone** : champ `zoneIds[]` sur les Lieux, calculé
  automatiquement à la création (point-in-polygon). Affiché dans la
  fiche.
