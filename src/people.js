const storage = require('./storage');
const { makePerson } = require('./schema');

function list({ status } = {}) {
  const all = storage.list('people');
  if (!status) return all;
  if (status === 'all') return all;
  return all.filter(p => p.status === status);
}

function get(id) {
  return storage.list('people').find(p => p.id === id) || null;
}

async function create(input) {
  return storage.mutate('people', (people) => {
    const ids = new Set(people.map(p => p.id));
    const person = makePerson(input, ids);
    people.push(person);
    return person;
  });
}

async function patch(id, patchFn) {
  return storage.mutate('people', (people) => {
    const person = people.find(p => p.id === id);
    if (!person) return null;
    Object.assign(person, patchFn(person));
    return person;
  });
}

// Enfants d'une personne : calculés (pas stockés).
// On parcourt toutes les Personnes et on garde celles qui ont `id` dans parents[].
function childrenOf(id) {
  return storage.list('people')
    .filter(p => (p.parents || []).some(parent => parent.id === id))
    .map(p => p.id);
}

// Parents d'une personne : retournés depuis le champ parents directement.
function parentsOf(id) {
  const p = get(id);
  return p ? (p.parents || []).map(x => x.id) : [];
}

// Fratrie : tous ceux qui partagent au moins un parent.
// Retourne [{ id, sharedParents: [...] }] avec indicateur demi- (sharedParents.length === 1
// alors qu'il y a 2 parents connus chez le focus et/ou le sibling).
function siblingsOf(id) {
  const me = get(id);
  if (!me) return [];
  const myParents = new Set((me.parents || []).map(p => p.id));
  if (myParents.size === 0) return [];
  const out = [];
  for (const p of storage.list('people')) {
    if (p.id === id) continue;
    const theirParents = new Set((p.parents || []).map(x => x.id));
    const shared = [...myParents].filter(x => theirParents.has(x));
    if (shared.length > 0) {
      const total = new Set([...myParents, ...theirParents]);
      out.push({
        id: p.id,
        sharedParents: shared,
        half: shared.length < Math.min(myParents.size, theirParents.size) || shared.length < 2,
      });
    }
  }
  return out;
}

module.exports = { list, get, create, patch, childrenOf, parentsOf, siblingsOf };
