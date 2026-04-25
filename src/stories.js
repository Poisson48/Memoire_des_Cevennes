const storage = require('./storage');
const { makeStory, normSubmittedBy } = require('./schema');
const { randomUUID } = require('crypto');

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

// ── Complétions (commentaires/ajouts attribués) ──────────────────
// Chaque complétion est une sous-ressource du Récit : un bout de texte
// ajouté après coup par un contributeur ou un membre de la famille pour
// enrichir un récit existant. Elle passe par la même modération : une
// complétion tombe en status=pending à la création, l'admin valide.
function str(v, maxLen) { return String(v ?? '').slice(0, maxLen).trim(); }

async function addCompletion(storyId, { body, submittedBy } = {}) {
  return storage.mutate('stories', (stories) => {
    const story = stories.find(s => s.id === storyId);
    if (!story) return null;
    const completion = {
      id: randomUUID().slice(0, 10),
      body: str(body, 20000),
      createdAt: new Date().toISOString(),
      status: 'pending',
      submittedAt: new Date().toISOString(),
    };
    const nb = normSubmittedBy(submittedBy);
    if (nb) completion.submittedBy = nb;
    if (!story.completions) story.completions = [];
    story.completions.push(completion);
    return completion;
  });
}

async function patchCompletion(storyId, completionId, patchFn) {
  return storage.mutate('stories', (stories) => {
    const story = stories.find(s => s.id === storyId);
    if (!story) return null;
    const comp = (story.completions || []).find(c => c.id === completionId);
    if (!comp) return null;
    Object.assign(comp, patchFn(comp));
    return comp;
  });
}

// Renvoie toutes les complétions pending, annotées du parent story.
function pendingCompletions() {
  const out = [];
  for (const story of storage.list('stories')) {
    for (const comp of story.completions || []) {
      if (comp.status === 'pending') out.push({ story, completion: comp });
    }
  }
  return out;
}

async function remove(id) {
  return storage.mutate('stories', (stories) => {
    const i = stories.findIndex(s => s.id === id);
    if (i < 0) return null;
    return stories.splice(i, 1)[0];
  });
}

async function removeCompletion(storyId, completionId) {
  return storage.mutate('stories', (stories) => {
    const story = stories.find(s => s.id === storyId);
    if (!story || !Array.isArray(story.completions)) return null;
    const i = story.completions.findIndex(c => c.id === completionId);
    if (i < 0) return null;
    return story.completions.splice(i, 1)[0];
  });
}

module.exports = {
  list, get, create, patch, remove, rolesForEntity,
  addCompletion, patchCompletion, removeCompletion, pendingCompletions,
};
