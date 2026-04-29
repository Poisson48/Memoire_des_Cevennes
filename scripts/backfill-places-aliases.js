#!/usr/bin/env node
// One-shot : remplit les alias des Lieux à partir des formes alternatives
// repérées dans les Cahiers du Haut-Vidourle et l'usage courant. Fusion
// avec les alias déjà présents (dédoublonné par nom, casse incluse).

const fs = require('fs');
const path = require('path');

const PLACES_PATH = path.join(__dirname, '..', 'data', 'places.json');

const ALIASES = {
  'saint-roman-de-codieres': [
    { name: 'Saint-Roman' },
    // Formes latines / médiévales
    { name: 'Sanctus Romanus de Codeyra', context: 'forme latine médiévale' },
    { name: 'Saint-Roman-de-Codeyra',     context: 'orthographe ancienne' },
    { name: 'Codeyra',                    context: 'forme courte ancienne' },
    // Région englobante au haut Moyen Âge — Saint-Roman en faisait partie
    { name: 'Aristum',                    context: 'pays d\'Aristum, VIᵉ-VIIIᵉ siècle' },
    { name: 'pays d\'Aristum',            context: 'haut Moyen Âge' },
    { name: 'Hierle',                     context: 'pays d\'Hierle, diocèse de Nîmes' },
    { name: 'pays d\'Hierle',             context: 'rattachement médiéval' },
    // Désignations administratives d'Ancien Régime
    { name: 'lieu de Saint-Roman-de-Codières', context: 'périphrase administrative (ex. testament Capieu, 1588)' },
    { name: 'seigneurie de Saint-Roman',  context: 'Ancien Régime, 1620-1789' },
    { name: 'terre de Saint-Roman',       context: 'féodal, Ancien Régime' },
    { name: 'majorat de Saint-Roman',     context: 'érection en majorat, 1815' },
  ],
  'tour-de-saint-roman': [
    { name: 'Tour-château' },
    { name: 'Château de Saint-Roman' },
    { name: 'Tour carrée',          context: 'appellation XXᵉ siècle' },
    { name: 'Tour des Bermond',     context: 'dénomination médiévale, 900-1217' },
    { name: 'Oppidum de Saint-Roman', context: 'place forte antique, 51 av. J.-C.' },
    { name: 'place forte romaine',  context: 'antiquité' },
  ],
  'eglise-saint-roman': [
    { name: 'Église de Saint-Roman' },
    { name: 'Église paroissiale de Saint-Roman' },
    { name: 'Église Saint-Roman-de-Codières' },
  ],
  'hameau-de-bourras': [
    { name: 'Bouras' },          // orthographe d'origine, un seul « r »
    { name: 'Bourras' },          // forme courte, sans « hameau de »
    { name: 'Auberge de Bourras' },
    { name: 'Temple de Bourras' }, // bâti emblématique du hameau (1855)
  ],
  'hameau-de-driolle': [
    { name: 'Driolle' },
    { name: 'Drilholles' }, // graphie ancienne attestée dans les cahiers
    { name: 'Mas de Drilholles' },
  ],
  'la-fage': [
    { name: 'Montagne de la Fage' },
    { name: 'La Fage de Saint-Roman' },
  ],
  'mas-de-la-nible': [
    { name: 'La Nible' },
    { name: 'Mas de la Nible' }, // variante de casse (l minuscule)
  ],
  'mas-de-conduzorgues': [
    { name: 'Conduzorgues' },
  ],
};

function mergeAliases(existing, incoming) {
  const seen = new Map();
  const push = (a) => {
    if (!a || !a.name) return;
    const key = a.name.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.set(key, { ...a, name: a.name.trim() });
  };
  (existing || []).forEach(push);
  (incoming || []).forEach(push);
  return [...seen.values()];
}

function main() {
  const data = JSON.parse(fs.readFileSync(PLACES_PATH, 'utf8'));
  let touched = 0;
  for (const place of data.places) {
    const incoming = ALIASES[place.id];
    if (!incoming) continue;
    const before = JSON.stringify(place.aliases || []);
    place.aliases = mergeAliases(place.aliases, incoming);
    const after = JSON.stringify(place.aliases);
    if (before !== after) {
      touched += 1;
      console.log(`  [${place.id}] alias: ${place.aliases.map(a => a.name).join(' · ')}`);
    }
  }
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(PLACES_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`✔ ${touched} lieu(x) mis à jour dans data/places.json`);
}

main();
