#!/usr/bin/env node
// Seed du contenu de référence — à lancer une fois sur un serveur fresh.
// Charge data/seeds/bootstrap.json et l'injecte dans data/places.json,
// data/people.json, data/stories.json (création si absents). Idempotent :
// ne ré-injecte pas un id déjà présent.
//
// Pour redéployer un serveur de zéro :
//   node scripts/seed-bootstrap.js
//   node scripts/seed-demo.js          # contenu démo additionnel
//   node scripts/seed-admin.js         # premier admin

'use strict';

const fs   = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const SEED = path.join(DATA, 'seeds', 'bootstrap.json');

if (!fs.existsSync(SEED)) {
  console.error('✖ data/seeds/bootstrap.json introuvable.');
  process.exit(1);
}
const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));

function ensureFile(name, key) {
  const file = path.join(DATA, name);
  if (!fs.existsSync(file)) {
    const initial = { [key]: [], updatedAt: new Date().toISOString() };
    fs.writeFileSync(file, JSON.stringify(initial, null, 2) + '\n');
    console.log(`  + créé ${name}`);
  }
}

function inject(name, key, items) {
  const file = path.join(DATA, name);
  const db = JSON.parse(fs.readFileSync(file, 'utf8'));
  const existingIds = new Set(db[key].map(i => i.id));
  let added = 0;
  for (const item of items) {
    if (existingIds.has(item.id)) continue;
    db[key].push(item);
    added++;
  }
  if (added > 0) {
    db.updatedAt = new Date().toISOString();
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n');
    fs.renameSync(tmp, file);
  }
  return added;
}

// Crée les fichiers s'ils n'existent pas (premier déploiement).
ensureFile('places.json',  'places');
ensureFile('people.json',  'people');
ensureFile('stories.json', 'stories');
ensureFile('edits.json',   'edits');
// Fichiers utilisateurs gérés par auth.js / activityLog.js / reports.js,
// init en tableau plat — créés à la volée à la première écriture.
for (const f of ['members.json', 'activity_log.json', 'reports.json']) {
  const full = path.join(DATA, f);
  if (!fs.existsSync(full)) {
    fs.writeFileSync(full, '[]\n');
    console.log(`  + créé ${f}`);
  }
}

const a = inject('places.json',  'places',  seed.places  || []);
const b = inject('people.json',  'people',  seed.people  || []);
const c = inject('stories.json', 'stories', seed.stories || []);

console.log(`✓ bootstrap : +${a} lieux, +${b} personnes, +${c} récits.`);
console.log('  (idempotent — relancer ne duplique pas)');
console.log('\nProchaines étapes :');
console.log('  node scripts/seed-demo.js     # contenu démo additionnel');
console.log('  node scripts/seed-admin.js    # premier compte admin');
