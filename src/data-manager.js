const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DATA_FILE = path.join(__dirname, '..', 'data', 'places.json');

function load() {
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  return JSON.parse(raw);
}

function save(db) {
  db.updatedAt = new Date().toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2) + '\n');
}

const COMBINING_MARKS = /[̀-ͯ]/g;

function slugify(str) {
  return String(str || 'lieu')
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'lieu';
}

function uniqueId(base, existing) {
  let id = base || randomUUID().slice(0, 8);
  let i = 2;
  while (existing.has(id)) {
    id = `${base}-${i++}`;
  }
  return id;
}

function getPlaces() {
  return load().places;
}

function getPlace(id) {
  return load().places.find(p => p.id === id) || null;
}

function addPlace({ title, description, lat, lng }) {
  const db = load();
  const ids = new Set(db.places.map(p => p.id));
  const id = uniqueId(slugify(title), ids);
  const place = {
    id,
    title: String(title || '').trim() || 'Lieu sans nom',
    description: String(description || '').trim(),
    lat: Number(lat),
    lng: Number(lng),
    createdAt: new Date().toISOString(),
    stories: [],
  };
  db.places.push(place);
  save(db);
  return place;
}

function addStory(placeId, story) {
  const db = load();
  const place = db.places.find(p => p.id === placeId);
  if (!place) return null;
  const entry = {
    id: randomUUID().slice(0, 8),
    type: story.type,
    title: String(story.title || '').trim(),
    author: String(story.author || '').trim(),
    body: String(story.body || ''),
    mediaUrl: story.mediaUrl || null,
    mediaMime: story.mediaMime || null,
    createdAt: new Date().toISOString(),
  };
  place.stories.push(entry);
  save(db);
  return entry;
}

module.exports = {
  getPlaces,
  getPlace,
  addPlace,
  addStory,
};
