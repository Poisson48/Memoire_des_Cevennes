#!/usr/bin/env node
// One-shot : remplit data/people.json à partir des personnes nommées
// dans les récits importés (Cahiers du Haut-Vidourle n°17), et tague les
// occurrences correspondantes dans stories.json (mentions / titleMentions).
//
// Idempotent : régénère les fichiers à partir de la spec ci-dessous —
// ré-exécuter écrase. Si un humain a déjà ajouté des mentions à la main,
// elles seront perdues, donc à utiliser sur jeu de données vierge.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PEOPLE_PATH = path.join(ROOT, 'data', 'people.json');
const STORIES_PATH = path.join(ROOT, 'data', 'stories.json');

const NOW = new Date().toISOString();
const SUBMITTED_BY = { name: 'Cahiers du Haut-Vidourle' };
const REVIEWED_BY = 'Administrateur démo';

// ── Fiches Personne ────────────────────────────────────────────────────
const PERSONS = [
  // Locales — Saint-Roman / haut Vidourle
  {
    id: 'pierre-bermond-de-sauve',
    primaryName: 'Pierre Bermond de Sauve',
    bio: "Vassal au concile de Saint-Gilles (1209) qui prêta serment de fidélité au pape Innocent III contre l'hérésie cathare. Famille des Bermond d'Anduze et de Sauve, seigneurs de Saint-Roman de 900 à 1217.",
  },
  {
    id: 'jean-aubanel',
    primaryName: 'Jean Aubanel',
    aliases: [{ name: 'Jean Aubanel, seigneur de Saint-Roman' }],
    bio: "Ancien capitaine protestant de Saint-Hippolyte. En 1620, achète la seigneurie de Saint-Roman au prince de Valois pour 3 600 livres. Lève des troupes pour le duc de Rohan en 1620 et 1625 ; fait exécuter d'importants travaux à la tour de Saint-Roman en 1621.",
  },
  {
    id: 'pierre-bouzanquet',
    primaryName: 'Pierre Bouzanquet de Saint-Hippolyte',
    aliases: [{ name: 'Pierre Bouzanquet' }],
    bio: "Tué lors de la prise d'assaut du château de Saint-Roman pendant les procès opposant les Aubanel à l'évêché de Montpellier (1654-1692).",
  },
  {
    id: 'etienne-serre',
    primaryName: 'Étienne Serre',
    aliases: [{ name: 'Étienne Serre, baron de Meyrueis' }, { name: 'baron de Meyrueis' }],
    bio: "Baron de Meyrueis. Acquéreur de la seigneurie de Saint-Roman en 1741 ; sa famille la garde jusqu'à la Révolution. Ses descendants, érigés comtes de Saint-Roman, deviennent pairs de France à partir de 1815.",
  },
  {
    id: 'marie-francoise-de-sarret',
    primaryName: 'Marie-Françoise de Sarret',
    aliases: [{ name: 'dame de Saint-Roman' }],
    bio: "Dame de Saint-Roman en 1789. Représente la noblesse aux états généraux pour la communauté.",
  },
  {
    id: 'jean-bompar',
    primaryName: 'Jean Bompar',
    bio: "Prêtre originaire du Malzieu en Gévaudan. En 1602, après l'édit de Nantes, il est rémunéré 750 livres par an pour assurer le service catholique à Saint-Roman.",
  },
  {
    id: 'aime-valery',
    primaryName: 'Aimé Valéry',
    bio: "Initiateur de l'aménagement touristique de Saint-Roman-de-Codières et de ses hameaux à partir des années 1970.",
  },
  {
    id: 'jean-baptiste-marchand',
    primaryName: 'Jean-Baptiste Marchand',
    aliases: [
      { name: 'commandant Marchand' },
      { name: 'général de division Jean-Baptiste Marchand' },
      { name: 'Marchand' },
    ],
    bio: "Commandant puis général de division ; héros de Fachoda. Vers 1900, il épouse Raymonde Sene de Saint-Roman et s'installe avec elle à la Tour carrée. Conseiller général du canton de Sumène de 1913 à 1925.",
  },
  {
    id: 'raymonde-sene-de-saint-roman',
    primaryName: 'Raymonde Sene de Saint-Roman',
    aliases: [
      { name: 'Raymonde de Serre de Saint-Roman' },
      { name: 'Madame Raymonde de Serre de Saint-Roman' },
    ],
    bio: "Épouse du commandant Jean-Baptiste Marchand vers 1900 ; le couple s'installe à la Tour carrée. Marraine, avec son mari, de la cloche « Jeanne, Romaine, Raymonde » baptisée le 20 août 1922.",
    spouses: [{ id: 'jean-baptiste-marchand', kind: 'mariage', start: 1900 }],
  },
  {
    id: 'fernand-soulier',
    primaryName: 'Fernand Soulier',
    bio: "Habitant du hameau de Driolle. Exécuté d'une balle dans la tête le 29 février 1944 lors de l'encerclement du hameau par une colonne de Waffen-SS. Son corps repose à l'entrée du hameau.",
    death: { year: 1944, month: 2, day: 29 },
  },
  {
    id: 'julien-perrier',
    primaryName: 'Julien Perrier',
    bio: "Habitant du hameau de Driolle. Prévenu par une voisine du raid Waffen-SS du 29 février 1944, il se cache dans une bergerie au-dessus du hameau, descend à Malignos avertir un réfractaire qu'il sauve. Dernier témoin oculaire à l'époque de la rédaction de l'article (Cahiers du Haut-Vidourle n°17, 2004).",
  },
  {
    id: 'isaac-vidal-de-colognac',
    primaryName: 'Isaac Vidal de Colognac',
    bio: "Prédicant protestant, décrit par Pierre Jurieu comme « jeune homme de 22 ou 23 ans, boiteux, sans études, sans apparence, ayant fait le métier de cardeur à Colognac ». A prêché deux fois à La Fage en février 1686.",
  },
  {
    id: 'jean-samson-dit-rouan',
    primaryName: 'Jean Samson dit Rouan',
    aliases: [{ name: 'Rouan' }, { name: 'Jean Samson dit « Rouan »' }],
    bio: "Cardeur de Saint-Roman, âgé de 40 ans en 1686. Interrogé le 25 février 1686 pour avoir assisté à une assemblée protestante clandestine la nuit du samedi 23 février dans une bergerie.",
  },
  {
    id: 'jean-paul-delpuech-de-la-nible',
    primaryName: 'Jean-Paul Delpuech de la Nible',
    bio: "Maître du mas de La Nible ; tout puissant à Saint-Roman et à Saint-Hippolyte au XVIIIᵉ siècle. Sa fille Jeanne et un autre Paul ont été assassinés sans que l'enquête du parlement n'identifie les coupables. Son fils Paul François a servi dans l'armée du Nord en 1793.",
  },
  {
    id: 'paul-francois-delpuech',
    primaryName: 'Paul François Delpuech',
    aliases: [{ name: 'Paul François' }],
    bio: "Fils de Jean-Paul Delpuech de la Nible. Servait dans l'armée du Nord en 1793 ; un acte de mariage le concernant est retrouvé à Nîmes en frimaire de l'an II.",
    parents: [{ id: 'jean-paul-delpuech-de-la-nible', kind: 'bio' }],
  },
  {
    id: 'jeanne-delpuech',
    primaryName: 'Jeanne Delpuech',
    aliases: [{ name: 'Jeanne' }],
    bio: "Fille de Jean-Paul Delpuech de la Nible. Assassinée au XVIIIᵉ siècle ; l'enquête du parlement n'a jamais identifié les coupables.",
    parents: [{ id: 'jean-paul-delpuech-de-la-nible', kind: 'bio' }],
  },
  {
    id: 'jean-capieu',
    primaryName: 'Jean Capieu',
    bio: "Fustier au mas de Conduzorgues, atteint de la peste en 1588. Son testament est dicté en chemin vers Saint-Roman ; il y prévoit qu'Arnaud Barrafod de Monoblet vienne servir son père (un autre Jean Capieu) et soigner la famille « que Dieu voudra affliger de ce fléau ».",
    death: { year: 1588 },
  },
  {
    id: 'arnaud-barrafod-de-monoblet',
    primaryName: 'Arnaud Barrafod de Monoblet',
    bio: "Mentionné dans le testament de Jean Capieu (1588), où il accepte, en pleine peste, de venir servir le père du mourant et soigner la famille du mas de Conduzorgues.",
  },

  // Figures historiques nationales / internationales
  {
    id: 'innocent-iii',
    primaryName: 'Innocent III',
    aliases: [{ name: 'pape Innocent III' }],
    bio: "Pape de 1198 à 1216. Au concile de Saint-Gilles (1209), il reçoit le serment de seize vassaux du Languedoc — dont Pierre Bermond de Sauve — contre l'hérésie cathare. En 1215, il donne à Simon de Montfort les moyens de combattre Raymond VI de Toulouse.",
    death: { year: 1216 },
  },
  {
    id: 'simon-de-montfort',
    primaryName: 'Simon de Montfort',
    bio: "Chef de la croisade des Albigeois. En 1215, le pape Innocent III lui donne les moyens de combattre Raymond VI de Toulouse ; Saint-Roman tombe sur le papier dans ses terres. Mort au siège de Toulouse en 1218.",
    death: { year: 1218 },
  },
  {
    id: 'raymond-vi-de-toulouse',
    primaryName: 'Raymond VI de Toulouse',
    bio: "Comte de Toulouse, combattu par Simon de Montfort lors de la croisade des Albigeois.",
  },
  {
    id: 'raymond-vii-de-toulouse',
    primaryName: 'Raymond VII de Toulouse',
    aliases: [{ name: 'Raymond VII' }],
    bio: "Comte de Toulouse, fils de Raymond VI. Reprend la région de Saint-Roman en 1222.",
  },
  {
    id: 'louis-viii-de-france',
    primaryName: 'Louis VIII',
    aliases: [{ name: 'Louis VIII de France' }],
    bio: "Roi de France de 1223 à 1226. Ramène la région de Saint-Roman au domaine royal.",
    death: { year: 1226 },
  },
  {
    id: 'philippe-le-bel',
    primaryName: 'Philippe le Bel',
    aliases: [{ name: 'Philippe IV le Bel' }],
    bio: "Roi de France. En 1293, il échange Montpellier contre Sauve et Saint-Roman avec l'évêque Bérenger de Frédol.",
  },
  {
    id: 'berenger-de-fredol',
    primaryName: 'Bérenger de Frédol',
    aliases: [{ name: "l'évêque Bérenger de Frédol" }],
    bio: "Évêque de Maguelone à la fin du XIIIᵉ siècle. En 1293, il échange Montpellier contre Sauve et Saint-Roman avec Philippe le Bel ; ses successeurs deviennent seigneurs, prieurs, curés et notaires du lieu.",
  },
  {
    id: 'eugenie-de-montijo',
    primaryName: 'Eugénie de Montijo',
    aliases: [
      { name: "l'impératrice Eugénie de Montijo" },
      { name: "impératrice Eugénie" },
    ],
    bio: "Épouse de Napoléon III, impératrice des Français. Offre aux comtes de Saint-Roman une reproduction du tableau du Titien « Les pèlerins d'Emmaüs » en remerciement d'un séjour effectué dans la commune.",
    spouses: [{ id: 'napoleon-iii', kind: 'mariage' }],
  },
  {
    id: 'napoleon-iii',
    primaryName: 'Napoléon III',
    bio: "Empereur des Français, époux d'Eugénie de Montijo.",
    spouses: [{ id: 'eugenie-de-montijo', kind: 'mariage' }],
  },
  {
    id: 'henri-de-rohan',
    primaryName: 'Henri II de Rohan',
    aliases: [{ name: 'duc de Rohan' }, { name: 'Rohan' }],
    bio: "Chef militaire huguenot (1579-1638). Lève des troupes en Cévennes lors des guerres de religion ; en 1628, sur son ordre, les maisons proches du château de Saint-Roman sont rasées.",
    birth: { year: 1579 },
    death: { year: 1638 },
  },
  {
    id: 'pierre-jurieu',
    primaryName: 'Pierre Jurieu',
    aliases: [{ name: 'Jurieu' }],
    bio: "Théologien protestant français (1637-1713). Décrit le prédicant Isaac Vidal de Colognac dans ses écrits.",
    birth: { year: 1637 },
    death: { year: 1713 },
  },
  {
    id: 'titien',
    primaryName: 'Titien',
    bio: "Peintre italien de la Renaissance vénitienne. Auteur du tableau « Les pèlerins d'Emmaüs » conservé au Louvre, dont une reproduction est accrochée à l'église de Saint-Roman.",
  },
];

// ── Patterns à taguer dans chaque récit ────────────────────────────────
// Pour chaque récit : liste de [aiguille, personId] essayés du plus long
// au plus court (la fonction trie), pour éviter qu'un alias court avale
// un nom complet. Pas de tag si chevauchement avec une mention déjà posée.
const STORY_PATTERNS = {
  'les-bermond-et-la-croisade-des-albigeois-900-1293': {
    body: [
      ['Pierre Bermond de Sauve', 'pierre-bermond-de-sauve'],
      ['pape Innocent III', 'innocent-iii'],
      ['Innocent III', 'innocent-iii'],
      ['Simon de Montfort', 'simon-de-montfort'],
      ['Raymond VI de Toulouse', 'raymond-vi-de-toulouse'],
      ['Raymond VII', 'raymond-vii-de-toulouse'],
      ['Louis VIII', 'louis-viii-de-france'],
      ['Philippe le Bel', 'philippe-le-bel'],
      ['Bérenger de Frédol', 'berenger-de-fredol'],
    ],
    title: [],
  },
  'la-reforme-et-les-guerres-de-religion-1568-1629': {
    body: [
      ['Jean Bompar', 'jean-bompar'],
      ['duc de Rohan', 'henri-de-rohan'],
      ['Jean Aubanel', 'jean-aubanel'],
      ['Rohan', 'henri-de-rohan'],
    ],
    title: [],
  },
  'la-seigneurie-des-aubanel-aux-serre-1620-1789': {
    body: [
      ['Jean Aubanel', 'jean-aubanel'],
      ['Pierre Bouzanquet de Saint-Hippolyte', 'pierre-bouzanquet'],
      ['Étienne Serre', 'etienne-serre'],
      ['Marie-Françoise de Sarret', 'marie-francoise-de-sarret'],
    ],
    title: [],
  },
  'du-xix-siecle-aux-neo-ruraux': {
    body: [
      ['Aimé Valéry', 'aime-valery'],
    ],
    title: [],
  },
  'l-oppidum-romain-et-le-chateau-des-bermond': {
    body: [
      ['Jean Aubanel', 'jean-aubanel'],
    ],
    title: [],
  },
  'le-commandant-marchand-et-la-tour-carree': {
    body: [
      ['Jean-Baptiste Marchand', 'jean-baptiste-marchand'],
      ['Raymonde Sene de Saint-Roman', 'raymonde-sene-de-saint-roman'],
      ['Marchand', 'jean-baptiste-marchand'],
    ],
    title: [
      ['commandant Marchand', 'jean-baptiste-marchand'],
    ],
  },
  'une-eglise-ravagee-et-reconstruite': {
    body: [
      ['duc de Rohan', 'henri-de-rohan'],
      ["l'impératrice Eugénie de Montijo", 'eugenie-de-montijo'],
      ['Napoléon III', 'napoleon-iii'],
      ['Titien', 'titien'],
    ],
    title: [],
  },
  'la-cloche-jeanne-romaine-raymonde-1922': {
    body: [
      ['Madame Raymonde de Serre de Saint-Roman', 'raymonde-sene-de-saint-roman'],
      ['général de division Jean-Baptiste Marchand', 'jean-baptiste-marchand'],
    ],
    title: [],
  },
  'l-auberge-de-bourras-xx-xxi-siecles': {
    body: [
      ['Aimé Valéry', 'aime-valery'],
    ],
    title: [],
  },
  'massacre-du-29-fevrier-1944': {
    body: [
      ['Fernand Soulier', 'fernand-soulier'],
      ['Julien Perrier', 'julien-perrier'],
    ],
    title: [],
  },
  'preches-clandestins-et-arrestation-de-jean-samson-dit-rouan-': {
    body: [
      ['Isaac Vidal de Colognac', 'isaac-vidal-de-colognac'],
      ['Jean Samson dit « Rouan »', 'jean-samson-dit-rouan'],
      ['Jurieu', 'pierre-jurieu'],
    ],
    title: [
      ['Jean Samson dit Rouan', 'jean-samson-dit-rouan'],
    ],
  },
  'des-delpuech-aux-camplan': {
    body: [
      ['Jean-Paul Delpuech de la Nible', 'jean-paul-delpuech-de-la-nible'],
      ['Paul François', 'paul-francois-delpuech'],
      ['Jeanne', 'jeanne-delpuech'],
    ],
    title: [],
  },
  'la-peste-de-1588-et-le-testament-de-jean-capieu': {
    body: [
      ['Jean Capieu', 'jean-capieu'],
      ['Arnaud Barrafod de Monoblet', 'arnaud-barrafod-de-monoblet'],
    ],
    title: [
      ['Jean Capieu', 'jean-capieu'],
    ],
  },
};

// ── Utilitaires ────────────────────────────────────────────────────────
function findAllNonOverlapping(patterns, text) {
  // Trie par longueur d'aiguille décroissante : un nom complet l'emporte
  // sur ses alias plus courts.
  const sorted = [...patterns].sort((a, b) => b[0].length - a[0].length);
  const taken = []; // intervalles [start, end] déjà tagués
  const out = [];
  for (const [needle, entityId] of sorted) {
    let from = 0;
    while (from <= text.length) {
      const idx = text.indexOf(needle, from);
      if (idx < 0) break;
      const end = idx + needle.length;
      const overlaps = taken.some(([s, e]) => !(end <= s || idx >= e));
      if (!overlaps) {
        out.push({ start: idx, end, type: 'person', entityId });
        taken.push([idx, end]);
      }
      from = idx + needle.length;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function makePerson(spec) {
  return {
    id: spec.id,
    primaryName: spec.primaryName,
    ...(spec.maidenName ? { maidenName: spec.maidenName } : {}),
    ...(spec.gender ? { gender: spec.gender } : {}),
    aliases: spec.aliases || [],
    ...(spec.birth ? { birth: spec.birth } : {}),
    ...(spec.death ? { death: spec.death } : {}),
    ...(spec.bio ? { bio: spec.bio } : {}),
    parents: spec.parents || [],
    spouses: spec.spouses || [],
    visibility: spec.visibility || 'public',
    createdAt: NOW,
    status: 'approved',
    submittedAt: NOW,
    submittedBy: SUBMITTED_BY,
    reviewedAt: NOW,
    reviewedBy: REVIEWED_BY,
  };
}

// ── Run ────────────────────────────────────────────────────────────────
function main() {
  // people.json
  const peopleData = {
    people: PERSONS.map(makePerson),
    updatedAt: NOW,
  };
  fs.writeFileSync(PEOPLE_PATH, JSON.stringify(peopleData, null, 2) + '\n');
  console.log(`✔ ${peopleData.people.length} personnes écrites dans data/people.json`);

  // stories.json — patch des mentions
  const storiesData = JSON.parse(fs.readFileSync(STORIES_PATH, 'utf8'));
  let totalMentions = 0;
  for (const story of storiesData.stories) {
    const cfg = STORY_PATTERNS[story.id];
    if (!cfg) continue;
    const bodyMentions = findAllNonOverlapping(cfg.body || [], story.body || '');
    const titleMentions = findAllNonOverlapping(cfg.title || [], story.title || '');
    story.mentions = bodyMentions;
    story.titleMentions = titleMentions;
    totalMentions += bodyMentions.length + titleMentions.length;

    for (const m of bodyMentions) {
      const slice = (story.body || '').slice(m.start, m.end);
      console.log(`  [${story.id}] body ${m.start}-${m.end} "${slice}" → ${m.entityId}`);
    }
    for (const m of titleMentions) {
      const slice = (story.title || '').slice(m.start, m.end);
      console.log(`  [${story.id}] title ${m.start}-${m.end} "${slice}" → ${m.entityId}`);
    }
  }
  storiesData.updatedAt = NOW;
  fs.writeFileSync(STORIES_PATH, JSON.stringify(storiesData, null, 2) + '\n');
  console.log(`✔ ${totalMentions} mentions tagguées dans data/stories.json`);
}

main();
