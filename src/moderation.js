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

// Index plat de tous les noms et alias connus (Lieux + Personnes), pour
// auto-détecter les mentions dans les textes libres affichés en file de
// modération. On filtre les noms < 3 caractères pour éviter les faux
// positifs sur des particules ('de', 'la', etc.). Inclut pending pour
// que la file détecte les mentions vers des entités elles-mêmes en attente.
function _buildNameIndex() {
  const out = [];
  function push(entity, type) {
    if (entity.primaryName) {
      out.push({ key: entity.primaryName.toLowerCase().trim(), type, id: entity.id, name: entity.primaryName });
    }
    for (const a of entity.aliases || []) {
      const n = typeof a === 'string' ? a : (a && a.name);
      if (n) out.push({ key: String(n).toLowerCase().trim(), type, id: entity.id, name: entity.primaryName });
    }
  }
  for (const p of places.list({ status: 'all' })) push(p, 'place');
  for (const p of people.list({ status: 'all' })) push(p, 'person');
  return out.filter(e => e.key.length >= 3);
}

// Scan un texte contre l'index de noms et renvoie un tableau de mentions
// {start, end, type, entityId, _name}. Tri longest-first pour éviter
// qu'un alias court masque un nom long. Frontières sur \p{L}\d.
// Optionnel : skipId exclut une entité (utile pour la description d'un
// Lieu : on ne s'auto-mentionne pas).
function _scanText(text, names, skipId) {
  if (!text || !names.length) return [];
  const sorted = [...names].sort((a, b) => b.key.length - a.key.length);
  const escaped = sorted.map(n => n.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(?<![\\p{L}\\d])(${escaped.join('|')})(?![\\p{L}\\d])`, 'giu');
  const mentions = [];
  let m;
  // Garde un set des positions déjà couvertes pour éviter les doublons
  // quand un même nom apparaît plusieurs fois (longest-first le gère naturellement).
  while ((m = re.exec(text)) !== null) {
    const found = m[1].toLowerCase();
    const entry = sorted.find(n => n.key === found);
    if (!entry) continue;
    if (skipId && entry.id === skipId) continue;
    mentions.push({
      start: m.index,
      end: m.index + m[1].length,
      type: entry.type,
      entityId: entry.id,
      _name: entry.name,
      _auto: true,
    });
  }
  return mentions;
}

// Fusionne mentions manuelles (taggées par le contributeur) et auto-détectées,
// en évitant les chevauchements (les manuelles gagnent).
function _mergeMentions(manual, auto) {
  const out = [...(manual || [])];
  const overlaps = (a, b) => !(a.end <= b.start || b.end <= a.start);
  for (const am of auto) {
    if (out.some(mm => overlaps(am, mm))) continue;
    out.push(am);
  }
  return out.sort((a, b) => a.start - b.start);
}

// Pour un récit (item ou completion), résout placeId et chaque mention,
// puis ajoute des mentions auto-détectées dans le corps.
function _resolveStoryRefs(item, idx, names) {
  const refs = {};
  if (item.placeId && idx.places[item.placeId]) {
    refs.placeName = idx.places[item.placeId];
  }
  const manualMentions = (item.mentions || []).map(m => ({
    ...m,
    _name: m.type === 'place' ? idx.places[m.entityId]
         : m.type === 'person' ? idx.people[m.entityId]
         : idx.stories[m.entityId] || null,
  }));
  const autoMentions = names ? _scanText(item.body, names) : [];
  refs.mentions = _mergeMentions(manualMentions, autoMentions);
  return refs;
}

function queue({ type } = {}) {
  const out = [];
  const idx = _entityIndex();
  const names = _buildNameIndex();
  for (const [name, repo] of Object.entries(ENTITIES)) {
    if (type && type !== name) continue;
    for (const item of repo.list({ status: 'pending' })) {
      const entry = { kind: 'create', entityType: name, item };
      if (name === 'stories') {
        entry.refs = _resolveStoryRefs(item, idx, names);
      } else if (name === 'places') {
        entry.refs = { descriptionMentions: _scanText(item.description, names, item.id) };
      } else if (name === 'people') {
        entry.refs = { bioMentions: _scanText(item.bio, names, item.id) };
      }
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
        refs: _resolveStoryRefs(completion, idx, names),
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
