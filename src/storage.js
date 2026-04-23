// Lecture/écriture des 3 fichiers de données.
// Un verrou mémoire basique sérialise les écritures sur un même fichier
// pour éviter les collisions si deux requêtes arrivent en même temps.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILES = {
  places:  path.join(DATA_DIR, 'places.json'),
  people:  path.join(DATA_DIR, 'people.json'),
  stories: path.join(DATA_DIR, 'stories.json'),
  edits:   path.join(DATA_DIR, 'edits.json'),
};
const KEY = { places: 'places', people: 'people', stories: 'stories', edits: 'edits' };

function load(name) {
  const raw = fs.readFileSync(FILES[name], 'utf8');
  return JSON.parse(raw);
}

function save(name, db) {
  db.updatedAt = new Date().toISOString();
  const tmp = FILES[name] + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n');
  fs.renameSync(tmp, FILES[name]);
}

const locks = new Map();
async function withLock(name, fn) {
  const prev = locks.get(name) || Promise.resolve();
  let release;
  const next = new Promise(res => { release = res; });
  locks.set(name, prev.then(() => next));
  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (locks.get(name) === next) locks.delete(name);
  }
}

function list(name) {
  return load(name)[KEY[name]];
}

async function mutate(name, mutator) {
  return withLock(name, async () => {
    const db = load(name);
    const result = await mutator(db[KEY[name]], db);
    save(name, db);
    return result;
  });
}

module.exports = { list, mutate, KEY, FILES };
