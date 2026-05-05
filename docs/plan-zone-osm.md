# Plan — Déploiement multi-zone via OSM

Statut : **en attente** (idée validée, à implémenter plus tard).

Objectif : permettre à n'importe qui de cloner le repo et déployer une
instance « Mémoire de [zone] » centrée sur une vraie entité
OpenStreetMap (commune, vallée, parc, département, vallée du Vidourle,
etc.), sans toucher au code. Le titre, la carte, le géocodage et la
modération géographique s'adaptent automatiquement.

## Principe

La **zone couverte** est l'élément racine du déploiement. On la choisit
une fois depuis l'admin, et tout le reste en découle :

- centre + zoom de la carte (depuis le bbox)
- polygone tracé en liseré sur la carte
- biais du géocodage Nominatim (viewbox = bbox de la zone)
- titre par défaut (« Mémoire de [nom OSM] »)
- filtre / alerte « hors zone » sur les nouvelles contributions

## Modèle de données

### `data/site_config.json` — étendu

```json
{
  "title": "Mémoire de Saint-Roman-de-Codières",
  "tagline": "…",
  "zone": {
    "osmType": "relation",
    "osmId": 8295914,
    "name": "Saint-Roman-de-Codières",
    "displayName": "Saint-Roman-de-Codières, Le Vigan, Gard, Occitanie, France",
    "bbox": [3.7456, 43.9712, 3.8089, 44.0285],
    "center": [44.0027, 3.7786],
    "zoom": 13,
    "fetchedAt": "2026-04-28T16:00:00Z"
  },
  "updatedAt": "…",
  "updatedBy": "…"
}
```

### `data/zone.geojson` — sidecar (cache du polygone)

GeoJSON Feature complet de la zone (Polygon ou MultiPolygon). Téléchargé
une fois lors du choix de la zone, puis servi en statique. Re-téléchargeable
depuis l'admin (« Rafraîchir la géométrie »). Mis dans le backup tar.gz.

## API

### `GET /api/admin/zone/search?q=saint-roman`

Proxy vers Nominatim avec `format=json&polygon_geojson=0&limit=8&accept-language=fr`.
Retourne la liste des candidats (relations admin uniquement, pas les POI).
**User-Agent** dédié et **rate-limit** côté serveur (1 req/s) pour respecter
la politique d'usage de Nominatim.

### `POST /api/admin/zone/set`

Body : `{ osmType, osmId }`.
- Télécharge la géométrie via Nominatim `details.php?osmtype=R&osmid=…&polygon_geojson=1`
  (ou Overpass en fallback : `(relation(8295914);); out geom;`).
- Calcule bbox + centre + zoom-par-défaut depuis bbox (formule Mercator).
- Écrit `data/zone.geojson` + met à jour `site_config.json`.
- Si `title` est encore au défaut, propose `Mémoire de [name]`.
- Journalise dans `activity_log.json`.

### `GET /api/zone` (public)

Renvoie `{ name, bbox, center, zoom }`. La GeoJSON elle-même est servie
en statique sur `/zone.geojson` (mise en cache HTTP).

## Frontend

### `public/js/app.js`

Au boot, fetch `/api/zone` :
- `setView(zone.center, zone.zoom)` au lieu du `DEFAULT_CENTER` codé en dur.
- Charge `/zone.geojson` et l'ajoute en `L.geoJSON` avec un style discret
  (liseré 2px, fillOpacity 0). Désactivable via une option dans le sélecteur
  de fonds.

### `public/js/geo.js`

Remplace la viewbox Cévennes en dur par `zone.bbox`. Garde le fallback
mondial si `zone` absente.

### `public/js/site-config.js`

Inchangé — déjà gère le titre dynamique.

### Pages statiques

Purger les « Cévennes » / « Saint-Roman » en dur :
- `public/aide.html` : utiliser des placeholders ou phrases neutres
- `public/js/admin.js:1128` (welcome par défaut) : phrase générique
- `public/index.html:40` : `aria-label="Carte de la zone"` au lieu de
  « Carte des Cévennes »
- `src/siteConfig.js:15-18` : defaults plus neutres (`'Mémoire collective'`)

## UI admin

Nouvel onglet ou section **« Zone couverte »** dans `/admin.html` :

```
┌─ Zone couverte ────────────────────────────────────┐
│ Zone actuelle : Saint-Roman-de-Codières (relation │
│   OSM #8295914) — bbox 3.74,43.97 → 3.81,44.03    │
│ [ Voir sur la carte ]  [ Rafraîchir la géométrie ] │
│                                                    │
│ Changer de zone :                                  │
│   [ Recherche OSM…                              ]  │
│   ↓ résultats                                      │
│   ○ Saint-Roman-de-Codières (commune, FR)         │
│   ○ Le Vigan (commune, FR)                        │
│   ○ Cévennes (parc national)                      │
│   [ Choisir cette zone ]                           │
└────────────────────────────────────────────────────┘
```

## Modération hors-zone

Pour chaque nouveau lieu / récit avec coordonnées :
- Si `data/zone.geojson` existe, point-in-polygon côté serveur (lib
  `@turf/boolean-point-in-polygon` — ~30 ko, raisonnable).
- Si hors zone, **pas de blocage dur** : flag `outOfZone: true` sur
  l'entité + badge dans la file de modération admin (« hors zone »).
- L'admin peut toujours valider (cas légitime : ancien habitant qui
  raconte un voyage).

Configurable via `site_config.zone.strict` (true = rejet automatique,
défaut false).

## Migration

`SCHEMA_VERSION` à bumper dans `src/backup.js`. Migration depuis l'ancien
schéma : si `site_config.json` n'a pas de `zone`, on n'en met pas — le
frontend tombe sur le fallback hardcodé (Saint-Roman) jusqu'à ce que
l'admin choisisse une zone.

Backup : ajouter `data/zone.geojson` à la liste des fichiers du tar.gz
(dans `src/backup.js`, à côté des `data/*.json`).

## Bonus / évolutions possibles

- **Multi-zones** : une instance peut couvrir plusieurs zones (vallée +
  parc qui se chevauchent). `zone` devient un tableau, on union les bbox.
- **Sous-zones** : afficher les communes incluses dans un département,
  filtrer les contributions par sous-zone.
- **Carte de chaleur** : densité de contributions par sous-zone.
- **Présélection** : packs « zones populaires » (parcs nationaux, grandes
  vallées) pré-cachés dans `data/seeds/zones/`, choisissables sans appel
  réseau.

## Pièges connus

- **Tailles extrêmes** : un hameau (2 km²) vs un département (6000 km²)
  vs un pays. Le zoom par défaut doit être calculé du bbox, pas fixé.
  Formule : `zoom = floor(log2(360 / max(bbox_width, bbox_height_corr)))`
  avec `bbox_height_corr = bbox_height / cos(lat_center)`.
- **MultiPolygon** : certaines communes ont des enclaves. `L.geoJSON`
  gère, mais le bbox doit être l'union de toutes les parties.
- **Nominatim down** : prévoir un input manuel `osmType, osmId` + upload
  d'une GeoJSON locale en fallback.
- **Ré-écriture de l'identité** : ne pas changer `data/zone.geojson` sans
  prévenir — les contributions « hors zone » d'avant resteraient flaggées.
  Snapshot pre-restore obligatoire avant changement.
- **Politique Nominatim** : User-Agent identifiant + 1 req/s + cache
  agressif. Documenter dans le code.

## Étapes d'implémentation (ordre suggéré)

1. **Backend zone** : `src/zone.js` (load/save/fetch via Nominatim+Overpass),
   tests unitaires sur le calcul bbox/centre/zoom.
2. **API admin** : `/api/admin/zone/search` + `/zone/set` + journalisation.
3. **API publique** : `/api/zone` + service statique `/zone.geojson`.
4. **Frontend carte** : `app.js` fetch `/api/zone` + tracé GeoJSON.
5. **Frontend géocodage** : `geo.js` viewbox dynamique.
6. **UI admin** : nouvel onglet « Zone couverte ».
7. **Purge « Cévennes » en dur** dans HTML statiques.
8. **Modération hors-zone** : point-in-polygon + flag.
9. **Backup** : ajouter `zone.geojson` au tar.gz, bump SCHEMA_VERSION.
10. **Tests** : Playwright — création d'une instance vide, choix d'une
    zone, vérification que la carte se centre, qu'un point hors zone est
    flaggé.

## Effort estimé

~2-3 jours de dev pour la version minimale (étapes 1-7), +1 jour pour
modération hors-zone et backup, +0.5 jour pour les tests. Soit 4-5 jours
au total pour une feature solide.
