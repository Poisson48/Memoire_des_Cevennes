// Normalisation et validation des 3 entités : Personne, Lieu, Récit.
// Chaque fonction `make*` prend une entrée brute (issue d'un POST, éventuellement
// sale) et renvoie un objet conforme au schéma, ou lance une erreur explicite.
//
// Note sur les offsets de mentions :
// `start` et `end` référencent des **code units UTF-16** dans `body` (comme
// String.prototype.length en JS). Cohérent côté serveur et navigateur.

const { randomUUID } = require('crypto');

function str(v, maxLen = 10000) {
  return String(v ?? '').slice(0, maxLen).trim();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function uniqueId(base, existingIds) {
  const fallback = randomUUID().slice(0, 8);
  let id = base || fallback;
  let i = 2;
  while (existingIds.has(id)) {
    id = `${base || fallback}-${i++}`;
  }
  return id;
}

function normAlias(a) {
  if (!a || !a.name) return null;
  const out = { name: str(a.name, 160) };
  if (a.usedBy) out.usedBy = str(a.usedBy, 80);
  if (a.context) out.context = str(a.context, 80);
  if (num(a.startYear) !== null) out.startYear = num(a.startYear);
  if (num(a.endYear) !== null) out.endYear = num(a.endYear);
  return out;
}

function normAliases(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normAlias).filter(Boolean);
}

// --- moderation ----------------------------------------------------------
// Par défaut, toute nouvelle entrée tombe en "pending".
// Le champ `submittedBy` est libre (pseudo + email optionnel, non vérifiés —
// la vérification se fait manuellement par les admins au moment de la
// validation).
function normSubmittedBy(sb) {
  if (!sb) return null;
  const out = {};
  if (sb.pseudo) out.pseudo = str(sb.pseudo, 80);
  if (sb.email)  out.email  = str(sb.email, 120);
  return Object.keys(out).length ? out : null;
}

function freshModerationFields(input) {
  const out = {
    status: 'pending',
    submittedAt: new Date().toISOString(),
  };
  const sb = normSubmittedBy(input.submittedBy);
  if (sb) out.submittedBy = sb;
  if (input.revisionOf) out.revisionOf = str(input.revisionOf, 80);
  return out;
}

// --- Place ---------------------------------------------------------------
function makePlace(input, existingIds) {
  const lat = num(input.lat);
  const lng = num(input.lng);
  if (lat === null || lng === null) {
    throw new Error('lat et lng requis et numériques');
  }
  const primaryName = str(input.primaryName || input.title || 'Lieu sans nom', 160);
  const id = input.id ? str(input.id, 80) : uniqueId(slugify(primaryName), existingIds);
  if (existingIds.has(id) && !input.id) {
    throw new Error(`id déjà pris : ${id}`);
  }
  return {
    id,
    primaryName,
    lat,
    lng,
    description: str(input.description, 5000),
    aliases: normAliases(input.aliases),
    createdAt: new Date().toISOString(),
    ...freshModerationFields(input),
  };
}

// --- Person --------------------------------------------------------------
function normParents(list) {
  if (!Array.isArray(list)) return [];
  return list.map(p => {
    if (!p || !p.id) return null;
    return {
      id: str(p.id, 80),
      kind: p.kind === 'adoptive' ? 'adoptive' : 'bio',
    };
  }).filter(Boolean);
}

function normSpouses(list) {
  if (!Array.isArray(list)) return [];
  return list.map(s => {
    if (!s || !s.id) return null;
    const out = {
      id: str(s.id, 80),
      kind: s.kind === 'partenariat' ? 'partenariat' : 'mariage',
    };
    if (num(s.start) !== null) out.start = num(s.start);
    if (num(s.end) !== null) out.end = num(s.end);
    return out;
  }).filter(Boolean);
}

function normEvent(e) {
  if (!e) return null;
  const out = {};
  if (num(e.year) !== null) out.year = num(e.year);
  if (num(e.month) !== null) out.month = num(e.month);
  if (num(e.day) !== null) out.day = num(e.day);
  if (e.placeId) out.placeId = str(e.placeId, 80);
  return Object.keys(out).length ? out : null;
}

function makePerson(input, existingIds) {
  const primaryName = str(input.primaryName || input.name || 'Inconnu·e', 160);
  const id = input.id ? str(input.id, 80) : uniqueId(slugify(primaryName), existingIds);
  if (existingIds.has(id) && !input.id) {
    throw new Error(`id déjà pris : ${id}`);
  }
  const gender = ['M', 'F', 'X'].includes(input.gender) ? input.gender : undefined;
  return {
    id,
    primaryName,
    ...(input.maidenName ? { maidenName: str(input.maidenName, 160) } : {}),
    ...(gender ? { gender } : {}),
    aliases: normAliases(input.aliases),
    ...(normEvent(input.birth) ? { birth: normEvent(input.birth) } : {}),
    ...(normEvent(input.death) ? { death: normEvent(input.death) } : {}),
    ...(input.bio ? { bio: str(input.bio, 5000) } : {}),
    parents: normParents(input.parents),
    spouses: normSpouses(input.spouses),
    createdAt: new Date().toISOString(),
    ...freshModerationFields(input),
  };
}

// --- Story ---------------------------------------------------------------
const STORY_TYPES = new Set(['text', 'photo', 'audio', 'video', 'drawing', 'note']);

function normMentions(list, bodyLength) {
  if (!Array.isArray(list)) return [];
  return list.map(m => {
    if (!m) return null;
    const start = Math.max(0, Math.floor(num(m.start)));
    const end = Math.max(start, Math.floor(num(m.end)));
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (end > bodyLength) return null;
    const type = m.type === 'place' ? 'place' : (m.type === 'person' ? 'person' : null);
    if (!type) return null;
    const entityId = str(m.entityId, 80);
    if (!entityId) return null;
    return { start, end, type, entityId };
  }).filter(Boolean);
}

function normMediaFile(f) {
  if (!f || !f.url) return null;
  return {
    url: str(f.url, 500),
    mime: str(f.mime, 120),
    ...(f.caption ? { caption: str(f.caption, 500) } : {}),
  };
}

function makeStory(input, existingIds) {
  const type = STORY_TYPES.has(input.type) ? input.type : 'text';
  const placeId = str(input.placeId, 80);
  if (!placeId) throw new Error('placeId requis pour ancrer le récit');
  const body = str(input.body, 30000);
  const id = input.id ? str(input.id, 80) : uniqueId(
    slugify(input.title || `recit-${type}`),
    existingIds,
  );
  return {
    id,
    placeId,
    type,
    ...(input.title ? { title: str(input.title, 200) } : {}),
    body,
    ...(input.memoryDate ? { memoryDate: str(input.memoryDate, 80) } : {}),
    ...(input.contributorId ? { contributorId: str(input.contributorId, 80) } : {}),
    mentions: normMentions(input.mentions, body.length),
    mediaFiles: (Array.isArray(input.mediaFiles) ? input.mediaFiles : [])
      .map(normMediaFile).filter(Boolean),
    createdAt: new Date().toISOString(),
    ...freshModerationFields(input),
  };
}

module.exports = {
  makePlace,
  makePerson,
  makeStory,
  slugify,
  STORY_TYPES,
};
