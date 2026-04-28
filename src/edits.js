// Propositions de modification (style Wikipédia) : un contributeur propose un
// changement sur un Lieu, une Personne ou un Récit ; la proposition entre en
// file d'attente ; un admin la valide ou la refuse.
//
// Un edit est un delta — il ne stocke que les champs qui changent, pas
// l'entité entière. L'application d'un edit approuvé fait un Object.assign
// du delta sur l'entité cible.
//
// Note : le champ `note` est analogue au "résumé de modification" de
// Wikipédia — pourquoi ce changement. Fortement recommandé pour que l'admin
// comprenne l'intention.

const storage = require('./storage');
const { randomUUID } = require('crypto');
const places = require('./places');
const people = require('./people');
const stories = require('./stories');

const TARGETS = { places, people, stories };

// Résout une cible d'édition (entité top-level OU complétion) en objet
// manipulable { read, patch } pour mutualiser propose/approve/diff.
function resolveTarget(targetType, targetId) {
  if (TARGETS[targetType]) {
    return {
      read: () => TARGETS[targetType].get(targetId),
      patch: (fn) => TARGETS[targetType].patch(targetId, fn),
    };
  }
  if (targetType === 'completion') {
    const [sid, cid] = String(targetId).split(':');
    if (!sid || !cid) throw new Error(`targetId de complétion invalide : ${targetId}`);
    return {
      read: () => {
        const story = stories.get(sid);
        return story ? (story.completions || []).find(c => c.id === cid) || null : null;
      },
      patch: (fn) => stories.patchCompletion(sid, cid, fn),
    };
  }
  throw new Error(`type de cible inconnu : ${targetType}`);
}

// Champs qu'on autorise à éditer par type. Les autres sont ignorés.
// Exclut volontairement : id, status, submittedBy/At, reviewedBy/At,
// createdAt, parents/spouses (touché via UI dédiée plus tard).
const EDITABLE_FIELDS = {
  places: ['primaryName', 'description', 'lat', 'lng', 'aliases', 'visibility'],
  people: ['primaryName', 'maidenName', 'gender', 'aliases', 'birth', 'death', 'bio'],
  // `mentions` est éditable via le post-tagging : la proposition envoie
  // l'array mentions complet mis à jour. L'admin valide → le tableau est
  // remplacé en bloc sur l'entité cible.
  stories: ['title', 'body', 'memoryDate', 'mentions', 'titleMentions', 'visibility'],
  // Sous-ressource : une complétion attachée à un récit. targetId a la
  // forme composite "storyId:completionId". Seul le corps est éditable
  // (le signataire reste celui qui l'a écrit).
  completion: ['body'],
  // mediaFiles garde son propre flow (/api/stories/:id/media).
};

function str(v, maxLen = 10000) {
  return String(v ?? '').slice(0, maxLen);
}

function normSubmittedBy(sb) {
  if (!sb) return null;
  const out = {};
  if (sb.pseudo) out.pseudo = str(sb.pseudo, 80);
  if (sb.email)  out.email  = str(sb.email, 120);
  return Object.keys(out).length ? out : null;
}

function sanitizeChanges(targetType, changes) {
  const allowed = EDITABLE_FIELDS[targetType];
  if (!allowed) throw new Error(`type de cible inconnu : ${targetType}`);
  const clean = {};
  for (const [k, v] of Object.entries(changes || {})) {
    if (allowed.includes(k)) clean[k] = v;
  }
  if (Object.keys(clean).length === 0) {
    throw new Error('aucun champ modifiable dans les changements');
  }
  return clean;
}

function list({ status, targetType, targetId } = {}) {
  let all = storage.list('edits');
  if (status && status !== 'all') all = all.filter(e => e.status === status);
  if (targetType) all = all.filter(e => e.targetType === targetType);
  if (targetId) all = all.filter(e => e.targetId === targetId);
  return all;
}

function get(id) {
  return storage.list('edits').find(e => e.id === id) || null;
}

async function propose({ targetType, targetId, changes, note, submittedBy }) {
  const handle = resolveTarget(targetType, targetId);
  const target = handle.read();
  if (!target) throw new Error(`cible introuvable : ${targetType}/${targetId}`);
  const clean = sanitizeChanges(targetType, changes);

  return storage.mutate('edits', (edits) => {
    const edit = {
      id: randomUUID().slice(0, 12),
      targetType,
      targetId: String(targetId),
      changes: clean,
      note: str(note, 1000).trim(),
      ...(normSubmittedBy(submittedBy) ? { submittedBy: normSubmittedBy(submittedBy) } : {}),
      submittedAt: new Date().toISOString(),
      status: 'pending',
    };
    edits.push(edit);
    return edit;
  });
}

// Calcule un diff : pour chaque champ des `changes`, donne la valeur actuelle
// et la valeur proposée. Utile pour l'UI admin.
function diff(edit) {
  let handle;
  try { handle = resolveTarget(edit.targetType, edit.targetId); }
  catch { return null; }
  const target = handle.read();
  if (!target) return null;
  const rows = [];
  for (const [field, next] of Object.entries(edit.changes || {})) {
    rows.push({
      field,
      before: target[field] ?? null,
      after: next,
    });
  }
  return { target, rows };
}

async function approve(id, { reviewer = 'admin' } = {}) {
  const edit = get(id);
  if (!edit) throw new Error('édition introuvable');
  if (edit.status !== 'pending') throw new Error(`édition déjà ${edit.status}`);
  const handle = resolveTarget(edit.targetType, edit.targetId);

  // Applique le delta sur la cible
  await handle.patch(() => ({ ...edit.changes }));

  // Marque l'édit comme approuvé
  return storage.mutate('edits', (edits) => {
    const e = edits.find(x => x.id === id);
    if (!e) return null;
    e.status = 'approved';
    e.reviewedAt = new Date().toISOString();
    e.reviewedBy = reviewer;
    delete e.rejectionReason;
    return e;
  });
}

async function reject(id, { reviewer = 'admin', reason = '' } = {}) {
  return storage.mutate('edits', (edits) => {
    const e = edits.find(x => x.id === id);
    if (!e) return null;
    if (e.status !== 'pending') throw new Error(`édition déjà ${e.status}`);
    e.status = 'rejected';
    e.reviewedAt = new Date().toISOString();
    e.reviewedBy = reviewer;
    e.rejectionReason = str(reason, 2000).trim();
    return e;
  });
}

module.exports = {
  list, get, propose, approve, reject, diff,
  EDITABLE_FIELDS,
};
