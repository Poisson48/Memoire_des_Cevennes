#!/usr/bin/env node
// Fusionne les fiches Personne en doublon (même primaryName insensible à la
// casse). Garde la fiche la plus ancienne (createdAt) ou celle sans suffixe
// numérique (ex. "mehdi" plutôt que "mehdi-3"). Met à jour les références
// dans places, stories, edits.
//
// Usage :
//   node scripts/dedup-people.js              # mode dry-run, montre quoi faire
//   node scripts/dedup-people.js --apply      # applique la fusion

'use strict';

const fs   = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const APPLY = process.argv.includes('--apply');

const FILES = ['places.json', 'people.json', 'stories.json', 'edits.json'];

function loadAll() {
  const out = {};
  for (const f of FILES) {
    const p = path.join(DATA, f);
    if (!fs.existsSync(p)) continue;
    out[f] = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return out;
}

function saveAll(dbs) {
  for (const [f, db] of Object.entries(dbs)) {
    db.updatedAt = new Date().toISOString();
    const p = path.join(DATA, f);
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n');
    fs.renameSync(tmp, p);
  }
}

function chooseCanonical(group) {
  // Ordre de priorité : id sans suffixe -N, puis createdAt le plus ancien.
  return group.slice().sort((a, b) => {
    const aSuf = /-\d+$/.test(a.id) ? 1 : 0;
    const bSuf = /-\d+$/.test(b.id) ? 1 : 0;
    if (aSuf !== bSuf) return aSuf - bSuf;
    const ta = a.createdAt || a.submittedAt || '';
    const tb = b.createdAt || b.submittedAt || '';
    return ta.localeCompare(tb);
  })[0];
}

const dbs = loadAll();
const people = dbs['people.json'].people;

// Groupe par nom normalisé.
const byName = {};
for (const p of people) {
  const k = String(p.primaryName || '').toLowerCase().trim();
  (byName[k] = byName[k] || []).push(p);
}
const groups = Object.entries(byName)
  .filter(([_, ps]) => ps.length > 1)
  .map(([name, ps]) => ({ name, ps }));

if (!groups.length) {
  console.log('✓ aucun doublon détecté.');
  process.exit(0);
}

// Construit le mapping ancien_id → id_canonique.
const remap = {};
const toRemove = new Set();
for (const g of groups) {
  const canonical = chooseCanonical(g.ps);
  for (const p of g.ps) {
    if (p.id !== canonical.id) {
      remap[p.id] = canonical.id;
      toRemove.add(p.id);
    }
  }
  console.log(`• ${g.name} → garde "${canonical.id}", fusionne ${g.ps.length - 1} doublon(s)`);
}

// Met à jour les références.
function rewrite(idOrNull) {
  if (!idOrNull) return idOrNull;
  return remap[idOrNull] || idOrNull;
}
function rewriteRefs(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach(rewriteRefs);
    return;
  }
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (k === 'id' && typeof v === 'string' && remap[v]) {
      // ne change PAS l'id propre du parent
    }
    if (k === 'entityId' && typeof v === 'string' && remap[v]) obj[k] = remap[v];
    if (k === 'personId' && typeof v === 'string' && remap[v]) obj[k] = remap[v];
    if (k === 'contributorId' && typeof v === 'string' && remap[v]) obj[k] = remap[v];
    if ((k === 'parents' || k === 'spouses') && Array.isArray(v)) {
      v.forEach(item => { if (item && remap[item.id]) item.id = remap[item.id]; });
    }
    if (typeof v === 'object') rewriteRefs(v);
  }
}

let touched = 0;
function rewriteIn(name) {
  const db = dbs[name];
  if (!db) return;
  const before = JSON.stringify(db);
  rewriteRefs(db);
  if (JSON.stringify(db) !== before) { touched++; console.log(`  ↳ refs réécrites dans ${name}`); }
}
rewriteIn('places.json');
rewriteIn('people.json');     // pour les parents/spouses entre fiches
rewriteIn('stories.json');
rewriteIn('edits.json');

// Supprime les doublons.
dbs['people.json'].people = people.filter(p => !toRemove.has(p.id));
console.log(`\nrésumé : ${groups.length} groupes, ${toRemove.size} fiches à supprimer.`);

if (APPLY) {
  saveAll(dbs);
  console.log('✓ fusion appliquée.');
} else {
  console.log('(dry-run — relance avec --apply pour écrire)');
}
