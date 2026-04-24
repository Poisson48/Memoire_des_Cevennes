#!/usr/bin/env node
// Suppression RGPD d'un membre + anonymisation de ses contributions.
// Usage : node scripts/rgpd-delete.js <email>
//
// Comportement :
//   1. Charge data/members.json, retrouve le membre par email.
//   2. Remplace toutes ses contributions submittedBy / contributorId par
//      un pseudo "__anonyme-<short-id>__" pour garder l'intégrité du graphe.
//   3. Supprime l'entrée du membre (hash, email, nom).
//   4. Log l'action dans data/activity_log.json.
//
// À exécuter après avoir confirmé la demande par écrit (email de la personne).
// Documente chaque exécution dans le registre interne de l'association.

'use strict';

const fs   = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const FILES = {
  members:  path.join(DATA, 'members.json'),
  places:   path.join(DATA, 'places.json'),
  people:   path.join(DATA, 'people.json'),
  stories:  path.join(DATA, 'stories.json'),
  edits:    path.join(DATA, 'edits.json'),
  log:      path.join(DATA, 'activity_log.json'),
};

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function saveJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

const email = (process.argv[2] || '').toLowerCase().trim();
if (!email) {
  console.error('Usage : node scripts/rgpd-delete.js <email>');
  process.exit(1);
}

const members = loadJson(FILES.members, []);
const member = members.find(m => m.email === email);
if (!member) {
  console.error(`✖ aucun membre avec l'email "${email}".`);
  process.exit(1);
}

const pseudo = `__anonyme-${member.id.slice(0, 8)}__`;
console.log(`→ suppression demandée pour ${email} (id=${member.id})`);
console.log(`→ pseudonyme de substitution : ${pseudo}`);

// 1. Anonymise les entités dans places/people/stories
function scrub(db, entityKey) {
  const items = db[entityKey];
  if (!Array.isArray(items)) return 0;
  let touched = 0;
  for (const item of items) {
    if (item.submittedBy && (
      item.submittedBy.email === email ||
      item.submittedBy.memberId === member.id
    )) {
      item.submittedBy = { name: pseudo };
      touched++;
    }
    if (item.contributorId === member.id) {
      item.contributorId = undefined;
      touched++;
    }
  }
  return touched;
}

const pl = loadJson(FILES.places,  { places:  [] });
const pe = loadJson(FILES.people,  { people:  [] });
const st = loadJson(FILES.stories, { stories: [] });

const counts = {
  places:  scrub(pl, 'places'),
  people:  scrub(pe, 'people'),
  stories: scrub(st, 'stories'),
};
saveJson(FILES.places,  pl);
saveJson(FILES.people,  pe);
saveJson(FILES.stories, st);
console.log(`✎ anonymisé : ${counts.places} lieux, ${counts.people} personnes, ${counts.stories} récits`);

// 2. Supprime le membre
const filtered = members.filter(m => m.id !== member.id);
saveJson(FILES.members, filtered);
console.log(`✎ membre supprimé de data/members.json`);

// 3. Log
const log = loadJson(FILES.log, []);
log.push({
  memberId:   member.id,
  action:     'rgpd-delete',
  entityType: 'member',
  entityId:   member.id,
  timestamp:  new Date().toISOString(),
  ip:         null,
  details:    { email, pseudo, counts },
});
saveJson(FILES.log, log);
console.log(`✎ action journalisée dans activity_log.json`);

console.log(`\n✓ suppression RGPD complète pour ${email}.`);
console.log(`  Pense à archiver la demande écrite de la personne dans le registre de l'association.`);
