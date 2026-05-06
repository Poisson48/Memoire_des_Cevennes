// File d'attente et décisions de modération.
// Les admins partagent le même compte (ADMIN_TOKEN) : voir server.js pour la garde.
const places = require('./places');
const people = require('./people');
const stories = require('./stories');
const edits = require('./edits');

const ENTITIES = { places, people, stories };

// Construit un index id → primaryName (et titre pour stories) pour résoudre
// les références croisées affichées dans la file de modération : placeId
// d'un récit, target d'une mention, etc. On ratisse en `status: 'all'` car
// un récit pending peut être ancré sur un lieu pending.
function _entityIndex() {
  const idx = { places: {}, people: {}, stories: {} };
  for (const p of places.list({ status: 'all' })) idx.places[p.id] = p.primaryName;
  for (const p of people.list({ status: 'all' })) idx.people[p.id] = p.primaryName;
  for (const s of stories.list({ status: 'all' })) idx.stories[s.id] = s.title || s.id;
  return idx;
}

// Pour un récit (item ou completion), résout placeId et chaque mention.
function _resolveStoryRefs(item, idx) {
  const refs = {};
  if (item.placeId && idx.places[item.placeId]) {
    refs.placeName = idx.places[item.placeId];
  }
  if (Array.isArray(item.mentions) && item.mentions.length) {
    refs.mentions = item.mentions.map(m => ({
      ...m,
      _name: m.type === 'place' ? idx.places[m.entityId]
           : m.type === 'person' ? idx.people[m.entityId]
           : idx.stories[m.entityId] || null,
    }));
  }
  return refs;
}

function queue({ type } = {}) {
  const out = [];
  const idx = _entityIndex();
  for (const [name, repo] of Object.entries(ENTITIES)) {
    if (type && type !== name) continue;
    for (const item of repo.list({ status: 'pending' })) {
      const entry = { kind: 'create', entityType: name, item };
      if (name === 'stories') entry.refs = _resolveStoryRefs(item, idx);
      out.push(entry);
    }
  }
  if (!type || type === 'edits') {
    for (const edit of edits.list({ status: 'pending' })) {
      out.push({ kind: 'edit', entityType: edit.targetType, item: edit, diff: edits.diff(edit) });
    }
  }
  if (!type || type === 'completions') {
    for (const { story, completion } of stories.pendingCompletions()) {
      out.push({
        kind: 'completion',
        entityType: 'stories',
        storyId: story.id,
        storyTitle: story.title || story.id,
        item: completion,
        refs: _resolveStoryRefs(completion, idx),
      });
    }
  }
  out.sort((a, b) => {
    const ta = a.item.submittedAt || '';
    const tb = b.item.submittedAt || '';
    return ta.localeCompare(tb);
  });
  return out;
}

async function approve(entityType, id, { reviewer = 'admin' } = {}) {
  const repo = ENTITIES[entityType];
  if (!repo) throw new Error(`type inconnu : ${entityType}`);
  return repo.patch(id, () => ({
    status: 'approved',
    reviewedAt: new Date().toISOString(),
    reviewedBy: reviewer,
    rejectionReason: undefined,
  }));
}

async function reject(entityType, id, { reviewer = 'admin', reason = '' } = {}) {
  const repo = ENTITIES[entityType];
  if (!repo) throw new Error(`type inconnu : ${entityType}`);
  return repo.patch(id, () => ({
    status: 'rejected',
    reviewedAt: new Date().toISOString(),
    reviewedBy: reviewer,
    rejectionReason: String(reason || '').slice(0, 2000),
  }));
}

function counts() {
  const out = {};
  for (const [name, repo] of Object.entries(ENTITIES)) {
    const all = repo.list({ status: 'all' });
    out[name] = {
      total: all.length,
      pending: all.filter(x => x.status === 'pending').length,
      approved: all.filter(x => x.status === 'approved').length,
      rejected: all.filter(x => x.status === 'rejected').length,
    };
  }
  const allEdits = edits.list({ status: 'all' });
  out.edits = {
    total: allEdits.length,
    pending: allEdits.filter(x => x.status === 'pending').length,
    approved: allEdits.filter(x => x.status === 'approved').length,
    rejected: allEdits.filter(x => x.status === 'rejected').length,
  };
  // Complétions (sous-records attachés aux stories)
  const comps = { total: 0, pending: 0, approved: 0, rejected: 0 };
  for (const story of stories.list({ status: 'all' })) {
    for (const c of story.completions || []) {
      comps.total++;
      if (c.status === 'pending') comps.pending++;
      else if (c.status === 'approved') comps.approved++;
      else if (c.status === 'rejected') comps.rejected++;
    }
  }
  out.completions = comps;
  return out;
}

module.exports = { queue, approve, reject, counts };
