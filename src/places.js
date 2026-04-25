const storage = require('./storage');
const { makePlace } = require('./schema');

function list({ status } = {}) {
  const all = storage.list('places');
  if (!status) return all;
  if (status === 'all') return all;
  return all.filter(p => p.status === status);
}

function get(id) {
  return storage.list('places').find(p => p.id === id) || null;
}

async function create(input) {
  return storage.mutate('places', (places) => {
    const ids = new Set(places.map(p => p.id));
    const place = makePlace(input, ids);
    places.push(place);
    return place;
  });
}

async function patch(id, patchFn) {
  return storage.mutate('places', (places) => {
    const place = places.find(p => p.id === id);
    if (!place) return null;
    Object.assign(place, patchFn(place));
    return place;
  });
}

async function remove(id) {
  return storage.mutate('places', (places) => {
    const i = places.findIndex(p => p.id === id);
    if (i < 0) return null;
    return places.splice(i, 1)[0];
  });
}

module.exports = { list, get, create, patch, remove };
