/* Service worker : cache client des tuiles de carte (OpenStreetMap + IGN).
 *
 * Objectif : ne pas re-télécharger les mêmes tuiles à chaque visite ou à
 * chaque déplacement sur la carte. Gain de vitesse pour l'utilisateur et
 * moins de charge sur les serveurs de tuiles (OSM France, Géoplateforme IGN).
 *
 * Prudence volontaire : on ne met en cache QUE les tuiles. Tout le reste
 * (HTML, /api, JS, CSS, médias…) passe directement au réseau, sans être
 * intercepté, pour ne JAMAIS servir de contenu périmé (le site est mis à
 * jour souvent). Ce worker ne fait donc que du cache-first sur les images
 * de tuiles, et ne touche à rien d'autre.
 *
 * Note : les service workers n'existent qu'en HTTPS (ou localhost). Sur le
 * site HTTPS canonique et sur GitHub Pages, le cache s'active ; sur un accès
 * HTTP direct (port 18542), le navigateur ignore l'enregistrement et se
 * rabat sur son cache HTTP habituel : aucun effet de bord.
 */

'use strict';

const TILE_CACHE = 'mdc-tiles-v1';

// Hôtes servant des tuiles. On matche l'hôte exact ou un sous-domaine
// (ex. a.tile.openstreetmap.fr, b.tile…, c.tile…).
const TILE_HOSTS = [
  'tile.openstreetmap.fr',
  'tile.openstreetmap.org',
  'data.geopf.fr',
  'wxs.ign.fr',
];

// Borne du cache pour ne pas remplir le disque indéfiniment. ~1500 tuiles
// PNG ≈ quelques dizaines de Mo. Au-delà, on purge les plus anciennes (FIFO).
const MAX_TILES = 1500;

self.addEventListener('install', () => {
  // Activation immédiate : pas d'attente d'un rechargement de page.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Purge des anciennes versions du cache de tuiles (si on bumpe TILE_CACHE).
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith('mdc-tiles-') && k !== TILE_CACHE)
          .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

function isTileRequest(url) {
  return TILE_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h));
}

self.addEventListener('fetch', (event) => {
  let url;
  try { url = new URL(event.request.url); } catch { return; }
  // On ne gère que les GET de tuiles. Pour tout le reste : ne pas appeler
  // respondWith → le navigateur fait sa requête normale.
  if (event.request.method !== 'GET' || !isTileRequest(url)) return;
  event.respondWith(cacheFirstTile(event.request));
});

async function cacheFirstTile(request) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const resp = await fetch(request);
    // On met en cache même les réponses opaques (tuiles cross-origin en
    // mode no-cors, cas des <img> de Leaflet) : on ne lit pas leur contenu,
    // on se contente de les restituer telles quelles.
    if (resp && (resp.ok || resp.type === 'opaque')) {
      cache.put(request, resp.clone());
      trimCache(cache); // best-effort, non bloquant
    }
    return resp;
  } catch (err) {
    // Hors-ligne et pas en cache : on laisse Leaflet gérer le trou.
    return hit || Response.error();
  }
}

let trimming = false;
async function trimCache(cache) {
  if (trimming) return; // un seul élagage à la fois
  trimming = true;
  try {
    const keys = await cache.keys();
    if (keys.length > MAX_TILES) {
      // keys() renvoie les entrées dans l'ordre d'insertion : on supprime
      // les plus anciennes (FIFO simple, suffisant ici).
      const excess = keys.slice(0, keys.length - MAX_TILES);
      await Promise.all(excess.map(k => cache.delete(k)));
    }
  } catch { /* pas critique */ } finally {
    trimming = false;
  }
}
