const storage = require('./storage');
const { makeStory } = require('./schema');

function list({ status, placeId, personId } = {}) {
  let all = storage.list('stories');
  if (status && status !== 'all') all = all.filter(s => s.status === status);
  if (placeId) {
    all = all.filter(s =>
      s.placeId === placeId ||
      (s.mentions || []).some(m => m.type === 'place' && m.entityId === placeId)
    );
  }
  if (personId) {
    all = all.filter(s =>
      s.contributorId === personId ||
      (s.mentions || []).some(m => m.type === 'person' && m.entityId === personId)
    );
  }
  return all;
}

function get(id) {
  return storage.list('stories').find(s => s.id === id) || null;
}

async function create(input) {
  return storage.mutate('stories', (stories) => {
    const ids = new Set(stories.map(s => s.id));
    const story = makeStory(input, ids);
    stories.push(story);
    return story;
  });
}

async function patch(id, patchFn) {
  return storage.mutate('stories', (stories) => {
    const story = stories.find(s => s.id === id);
    if (!story) return null;
    Object.assign(story, patchFn(story));
    return story;
  });
}

// Ventile un récit en ses rôles pour une personne ou un lieu donné.
// Utilisé par les pages entités pour regrouper par rôle.
function rolesForEntity(story, { personId, placeId }) {
  const roles = [];
  if (placeId && story.placeId === placeId) roles.push('anchor');
  if (personId && story.contributorId === personId) roles.push('contributor');
  for (const m of story.mentions || []) {
    if (personId && m.type === 'person' && m.entityId === personId) roles.push('person-mention');
    if (placeId && m.type === 'place' && m.entityId === placeId) roles.push('place-mention');
  }
  return roles;
}

module.exports = { list, get, create, patch, rolesForEntity };
