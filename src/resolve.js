// Résolution d'alias : cherche un texte (ex. "Suzette", "Ferme Vieille")
// et retourne les entités candidates (Personnes + Lieux), triées par score.
//
// Règles de score (plus haut = meilleur) :
//   100 — primaryName exact (insensible à la casse / aux accents)
//    90 — alias exact
//    70 — primaryName contient la requête
//    60 — alias contient la requête
// Tie-breaker : `status === 'approved'` d'abord, puis alphabétique.

const people = require('./people');
const places = require('./places');

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function scoreText(haystack, needle) {
  const H = normalize(haystack);
  const N = normalize(needle);
  if (!H || !N) return 0;
  if (H === N) return 100;
  if (H.startsWith(N) || H.endsWith(N)) return 80;
  if (H.includes(N)) return 70;
  return 0;
}

function entityCandidates(entity, { primaryField, needle, includeStatus }) {
  if (!includeStatus && entity.status && entity.status !== 'approved') return null;
  const cands = [];
  const primScore = scoreText(entity[primaryField], needle);
  if (primScore) {
    cands.push({
      score: primScore,
      matched: entity[primaryField],
      source: 'primary',
    });
  }
  for (const a of entity.aliases || []) {
    const s = scoreText(a.name, needle);
    if (s) {
      const alias = { ...a };
      cands.push({
        score: s === 100 ? 90 : (s === 80 ? 75 : 60),
        matched: a.name,
        source: 'alias',
        alias,
      });
    }
  }
  if (cands.length === 0) return null;
  cands.sort((x, y) => y.score - x.score);
  return cands[0];
}

function resolve(query, { limit = 10, includeStatus = false } = {}) {
  const needle = String(query || '').trim();
  if (!needle) return [];

  const results = [];

  for (const p of people.list(includeStatus ? { status: 'all' } : {})) {
    const hit = entityCandidates(p, { primaryField: 'primaryName', needle, includeStatus });
    if (hit) {
      results.push({ type: 'person', id: p.id, name: p.primaryName, ...hit });
    }
  }

  for (const pl of places.list(includeStatus ? { status: 'all' } : {})) {
    const hit = entityCandidates(pl, { primaryField: 'primaryName', needle, includeStatus });
    if (hit) {
      results.push({ type: 'place', id: pl.id, name: pl.primaryName, ...hit });
    }
  }

  results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'fr'));
  return results.slice(0, limit);
}

module.exports = { resolve, normalize };
