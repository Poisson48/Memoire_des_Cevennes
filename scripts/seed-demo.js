#!/usr/bin/env node
// Seed de données démo pour étoffer la carte avant un rendez-vous de levée
// de fonds. Ajoute des lieux, personnes et récits fictifs autour de
// Saint-Roman-de-Codières. Idempotent : ne réinjecte pas un id déjà présent.
//
// Usage : node scripts/seed-demo.js
//
// Toutes les entrées sont status: "approved" pour s'afficher immédiatement.
// Mix de visibility "public" (visible aux non-connectés) et "members".

'use strict';

const fs   = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const STAMP = '2026-04-25T00:00:00.000Z';

function load(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8'));
}
function save(file, db) {
  db.updatedAt = new Date().toISOString();
  const target = path.join(DATA, file);
  const tmp    = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n');
  fs.renameSync(tmp, target);
}

function moderation(by = 'bootstrap-demo') {
  return {
    status: 'approved',
    submittedAt: STAMP,
    reviewedAt:  STAMP,
    reviewedBy:  by,
  };
}

// ─── Lieux supplémentaires ────────────────────────────────────────────
// Autour de Saint-Roman-de-Codières (44.0027, 3.7786). Coords approximatives
// sur la commune et les hameaux voisins, mix public/members.
const newPlaces = [
  {
    id: 'pont-de-l-hopital',
    primaryName: "Pont de l'Hôpital",
    lat: 44.0058, lng: 3.7842,
    description: "Vieux pont de pierre enjambant la Crenze, sur l'ancien chemin muletier reliant Saint-Roman aux hameaux de l'aval. La rambarde en pierre sèche est un travail attribué aux maçons italiens des années 1890.",
    aliases: [{ name: 'Pont vieux' }],
    visibility: 'public',
    createdAt: STAMP,
    ...moderation(),
  },
  {
    id: 'chapelle-notre-dame-codieres',
    primaryName: 'Chapelle Notre-Dame',
    lat: 44.0011, lng: 3.7778,
    description: "Petite chapelle romane à l'écart du village, sur un mamelon dominant la vallée. Toit en lauzes restauré dans les années 1990 par l'association des amis du patrimoine.",
    aliases: [],
    visibility: 'public',
    createdAt: STAMP,
    ...moderation(),
  },
  {
    id: 'moulin-de-la-crenze',
    primaryName: 'Moulin de la Crenze',
    lat: 43.9981, lng: 3.7805,
    description: "Ancien moulin à blé puis à châtaignes, en aval du village. La meule est encore visible. Famille Pellet exploitante de 1840 à 1922.",
    aliases: [{ name: 'Moulin Pellet' }],
    visibility: 'members',
    createdAt: STAMP,
    ...moderation(),
  },
  {
    id: 'les-castagniers',
    primaryName: 'Les Castagniers',
    lat: 44.0118, lng: 3.7705,
    description: "Hameau perché au-dessus de la vallée, entouré d'une châtaigneraie centenaire. Tradition du séchage des châtaignes encore pratiquée par deux familles.",
    aliases: [],
    visibility: 'public',
    createdAt: STAMP,
    ...moderation(),
  },
  {
    id: 'source-de-la-crenze',
    primaryName: 'Source de la Crenze',
    lat: 44.0185, lng: 3.7822,
    description: "Source de la Crenze, affluent du Vidourle. Captée pour l'alimentation du village au début du XXe siècle, le bassin de captage est encore en place.",
    aliases: [],
    visibility: 'public',
    createdAt: STAMP,
    ...moderation(),
  },
  {
    id: 'mas-du-roumieu',
    primaryName: 'Mas du Roumieu',
    lat: 44.0050, lng: 3.7945,
    description: "Mas familial habité depuis le XVIIIe siècle. Récits de la famille Roumieux conservés.",
    aliases: [],
    visibility: 'members',
    createdAt: STAMP,
    ...moderation(),
  },
  {
    id: 'ancienne-ecole-saint-roman',
    primaryName: 'Ancienne école communale',
    lat: 44.0029, lng: 3.7790,
    description: "École de la IIIe République ouverte en 1884, fermée en 1971 quand les enfants ont rejoint le regroupement scolaire de Sumène. Le bâtiment est devenu salle communale en 1985.",
    aliases: [],
    visibility: 'public',
    createdAt: STAMP,
    ...moderation(),
  },
  {
    id: 'roc-des-vautours',
    primaryName: 'Roc des Vautours',
    lat: 44.0245, lng: 3.7615,
    description: "Falaise calcaire au nord de la commune, point d'observation des vautours fauves réintroduits dans les années 2000 dans le Causse Méjean voisin. Vue panoramique sur la vallée de la Crenze.",
    aliases: [{ name: 'Roc Blanc' }],
    visibility: 'public',
    createdAt: STAMP,
    ...moderation(),
  },
  {
    id: 'aire-de-battage-combes',
    primaryName: 'Aire de battage des Combes',
    lat: 44.0042, lng: 3.7760,
    description: "Plateforme de pierre où l'on battait le grain à l'ancienne, encore visible derrière la place de la mairie. Tradition perdue au lendemain de la Seconde Guerre.",
    aliases: [],
    visibility: 'public',
    createdAt: STAMP,
    ...moderation(),
  },
];

// ─── Personnes supplémentaires ────────────────────────────────────────
const newPeople = [
  {
    id: 'lucie-combes',
    primaryName: 'Lucie Combes',
    gender: 'F',
    aliases: [{ name: "L'institutrice", context: 'fonction' }],
    birth: { year: 1898 },
    death: { year: 1972 },
    bio: "Institutrice de Saint-Roman-de-Codières de 1925 à 1958. Connue pour avoir tenu un journal des événements du village pendant l'Occupation, conservé aux archives départementales du Gard.",
    parents: [],
    spouses: [],
    visibility: 'public',
    createdAt: STAMP,
    ...moderation(),
  },
  {
    id: 'pierre-pellet',
    primaryName: 'Pierre Pellet',
    gender: 'M',
    aliases: [{ name: 'Le meunier' }],
    birth: { year: 1845 },
    death: { year: 1923 },
    bio: "Meunier au Moulin de la Crenze de 1872 à 1908. A passé l'exploitation à son fils Antoine Pellet, qui a fermé le moulin en 1922 faute de blé local.",
    parents: [],
    spouses: [],
    visibility: 'public',
    createdAt: STAMP,
    ...moderation(),
  },
  {
    id: 'marius-pelatan',
    primaryName: 'Marius Pelatan',
    gender: 'M',
    aliases: [],
    birth: { year: 1948 },
    bio: "Habitant actuel du Mas du Roumieu, gardien d'une mémoire orale précieuse sur la vie du village des années 1950-1970. Témoignages enregistrés en 2025.",
    parents: [],
    spouses: [],
    visibility: 'members',
    isLiving: true,
    createdAt: STAMP,
    ...moderation(),
  },
  {
    id: 'elise-roumieux-vve',
    primaryName: 'Élise Roumieux',
    maidenName: 'Pelatan',
    gender: 'F',
    aliases: [],
    birth: { year: 1972 },
    bio: "Fille de Marius Pelatan. Tient à jour le journal familial du Mas du Roumieu.",
    parents: [{ id: 'marius-pelatan', kind: 'bio' }],
    spouses: [],
    visibility: 'members',
    isLiving: true,
    createdAt: STAMP,
    ...moderation(),
  },
  {
    id: 'antoine-pellet',
    primaryName: 'Antoine Pellet',
    gender: 'M',
    aliases: [],
    birth: { year: 1875 },
    death: { year: 1949 },
    bio: "Fils de Pierre Pellet. Dernier meunier en activité au Moulin de la Crenze (1908-1922).",
    parents: [{ id: 'pierre-pellet', kind: 'bio' }],
    spouses: [],
    visibility: 'public',
    createdAt: STAMP,
    ...moderation(),
  },
];

// ─── Récits supplémentaires ───────────────────────────────────────────
const newStories = [
  {
    id: 'chataignes-automne-castagniers',
    placeId: 'les-castagniers',
    type: 'text',
    title: "Le séchage des châtaignes à l'automne",
    body: "Aux Castagniers, les clèdes — petites cabanes en pierre où l'on séchait les châtaignes au feu de bois pendant trois semaines — étaient encore en activité dans les années 1960. Deux familles du hameau perpétuent la tradition à titre privé. L'odeur du feu de châtaignier embaume tout le versant en novembre.",
    memoryDate: 'XXe siècle',
    mentions: [
      { start: 4, end: 17, type: 'place', entityId: 'les-castagniers' },
    ],
    mediaFiles: [],
    visibility: 'public',
    createdAt: STAMP,
    ...moderation(),
  },
  {
    id: 'pellet-moulin-grain',
    placeId: 'moulin-de-la-crenze',
    type: 'text',
    title: 'Le grain et la châtaigne',
    body: "Pierre Pellet ouvre son moulin en 1872. Au début, on y bat surtout du seigle et un peu de froment apporté par les Cévenols du plateau. La châtaigne prend ensuite la place quand les épidémies du XIXe siècle décourageaient la culture des céréales. Antoine Pellet, le fils, ferme le moulin en 1922 : plus assez de grain dans la vallée.",
    memoryDate: '1872-1922',
    mentions: [
      { start: 0, end: 13, type: 'person', entityId: 'pierre-pellet' },
      { start: 195, end: 209, type: 'person', entityId: 'antoine-pellet' },
    ],
    mediaFiles: [],
    visibility: 'members',
    createdAt: STAMP,
    ...moderation(),
  },
  {
    id: 'lucie-classe-vallee',
    placeId: 'ancienne-ecole-saint-roman',
    type: 'text',
    title: 'La classe unique de Lucie',
    body: "Lucie Combes a tenu la classe unique de l'école de Saint-Roman pendant 33 ans. Vingt-deux élèves de tous niveaux, du CP au certificat d'études. Le journal qu'elle a tenu pendant la guerre raconte les enfants venus se réfugier des villes du sud, et la solidarité des familles cévenoles.",
    memoryDate: '1925-1958',
    mentions: [
      { start: 0, end: 12, type: 'person', entityId: 'lucie-combes' },
    ],
    mediaFiles: [],
    visibility: 'public',
    createdAt: STAMP,
    ...moderation(),
  },
  {
    id: 'transhumance-saint-roman',
    placeId: 'saint-roman-de-codieres',
    type: 'text',
    title: 'La fête de la transhumance',
    body: "Chaque printemps, les troupeaux montaient vers les estives de l'Aigoual. Le passage par Saint-Roman était l'occasion d'une fête qui durait toute la journée : repas commun sur la place de la mairie, musique, danses. Tradition relancée depuis 2010 par l'association des bergers du piémont cévenol.",
    memoryDate: 'tradition annuelle',
    mentions: [],
    mediaFiles: [],
    visibility: 'public',
    createdAt: STAMP,
    ...moderation(),
  },
  {
    id: 'vautours-retour-roc',
    placeId: 'roc-des-vautours',
    type: 'text',
    title: 'Le retour des vautours',
    body: "Disparus du massif depuis les années 1940, les vautours fauves ont été réintroduits dans les Causses voisins à partir de 1981. Les premiers individus ont commencé à survoler le Roc à la fin des années 2000. Aujourd'hui, on en compte une trentaine en vol nuptial à la belle saison.",
    memoryDate: '2000-aujourd\'hui',
    mentions: [],
    mediaFiles: [],
    visibility: 'public',
    createdAt: STAMP,
    ...moderation(),
  },
  {
    id: 'roumieu-cuisinier-mas',
    placeId: 'mas-du-roumieu',
    type: 'text',
    title: 'La cuisinière du Mas',
    body: "Marius Pelatan raconte la cuisinière en fonte du Mas du Roumieu, héritée de sa grand-mère, sur laquelle on faisait simultanément le café du matin, le pot-au-feu de midi, et la confiture de châtaignes en novembre. Élise Roumieux, sa fille, conserve encore l'habitude de l'allumer le dimanche en famille.",
    memoryDate: 'XXe-XXIe siècle',
    mentions: [
      { start: 0, end: 14, type: 'person', entityId: 'marius-pelatan' },
      { start: 215, end: 229, type: 'person', entityId: 'elise-roumieux-vve' },
    ],
    mediaFiles: [],
    visibility: 'members',
    createdAt: STAMP,
    ...moderation(),
  },
  {
    id: 'pont-rambarde-italiens',
    placeId: 'pont-de-l-hopital',
    type: 'text',
    title: 'Les maçons italiens du pont',
    body: "Les rambardes en pierre sèche du pont de l'Hôpital ont été refaites en 1893 par une équipe de maçons piémontais venus travailler à la voie ferrée du Vigan. Quelques-uns ont fait souche au village et leur descendance vit encore dans la vallée.",
    memoryDate: '1893',
    mentions: [
      { start: 36, end: 53, type: 'place', entityId: 'pont-de-l-hopital' },
    ],
    mediaFiles: [],
    visibility: 'public',
    createdAt: STAMP,
    ...moderation(),
  },
];

// ─── Application ──────────────────────────────────────────────────────
function injectInto(file, key, items) {
  const db = load(file);
  const existingIds = new Set(db[key].map(i => i.id));
  let added = 0;
  for (const item of items) {
    if (existingIds.has(item.id)) continue;
    db[key].push(item);
    added++;
  }
  if (added > 0) save(file, db);
  return added;
}

// Nettoyage : retire les éventuels résidus de smoke test (id "test-lieu")
function cleanupTestData(file, key) {
  const db = load(file);
  const before = db[key].length;
  db[key] = db[key].filter(i => !/^test-/.test(i.id));
  const removed = before - db[key].length;
  if (removed > 0) { save(file, db); console.log(`  ✂ retiré ${removed} entrée(s) de test dans ${file}`); }
}

cleanupTestData('places.json',  'places');
cleanupTestData('people.json',  'people');
cleanupTestData('stories.json', 'stories');

const addedP = injectInto('places.json',  'places',  newPlaces);
const addedH = injectInto('people.json',  'people',  newPeople);
const addedS = injectInto('stories.json', 'stories', newStories);

console.log(`✓ démo : +${addedP} lieux, +${addedH} personnes, +${addedS} récits.`);
console.log('  (entrées idempotentes — relancer ne duplique pas).');
