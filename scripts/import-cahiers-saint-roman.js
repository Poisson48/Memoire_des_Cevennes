#!/usr/bin/env node
// Import granulaire du dossier "Saint-Roman-de-Codières" — N°17 (Janv. 2004)
// des Cahiers du Haut-Vidourle. Chaque hameau / lieu identifié devient son
// propre Lieu, et les anecdotes sont attachées au Lieu le plus pertinent.
//
// Coordonnées : récupérées via OSM (Overpass API) — sources vérifiables.
//
// Usage :
//   ADMIN_TOKEN=dev BASE=http://localhost:18542 node scripts/import-cahiers-saint-roman.js

const BASE = process.env.BASE || 'http://localhost:18542';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'dev';
const MEMBER = {
  name: 'Cahiers du Haut-Vidourle',
  email: 'cahiers@haut-vidourle.local',
  password: 'cahiersHV-2026!placeholder',
};

const SOURCE_NOTE =
  "Source : *Les Cahiers du Haut-Vidourle* n°17, janvier 2004, dossier monographique « Saint-Roman-de-Codières, des origines à nos jours ».";

async function adminPost(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': ADMIN_TOKEN },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

async function login(email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(`login échoué (${r.status}) : ${err.error || ''}`);
  }
  const cookie = r.headers.get('set-cookie');
  if (!cookie) throw new Error('login: cookie non reçu');
  return cookie.split(';')[0];
}

async function memberPost(path, body, cookie) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

// ─── LIEUX ────────────────────────────────────────────────────────────────
// Coordonnées OSM, vérifiées via Overpass API (place=village/hamlet/etc.)

const PLACES = [
  {
    id: 'saint-roman-de-codieres',
    primaryName: 'Saint-Roman-de-Codières',
    lat: 44.003, lng: 3.77861,
    description:
      "Commune des Cévennes méridionales, à la ligne de partage des eaux entre " +
      "le bassin de l'Hérault et celui du Vidourle. Carrefour de trois vallons " +
      "(Récodier, Vidourle, Savel) et haut lieu stratégique depuis l'Antiquité. " +
      "Population 161 habitants en 2021 (INSEE), majoritairement néo-rurale.",
  },
  {
    id: 'tour-de-saint-roman',
    primaryName: 'Tour de Saint-Roman',
    aliases: [{ name: 'Tour-château' }, { name: 'Château de Saint-Roman' }],
    lat: 44.0029865, lng: 3.7787226,
    description:
      "Tour et corps de bâtiments dominant le village, à l'emplacement d'un " +
      "oppidum romain (51 av. J.-C. selon la tradition). Fortifiée par les " +
      "Bermond d'Anduze (900-1217), restaurée par les Aubanel en 1621, puis " +
      "transformée en demeure des Sene puis des Marchand au XXᵉ siècle. " +
      "Aujourd'hui café et chambres d'hôtes (la-tour30.com).",
  },
  {
    id: 'eglise-saint-roman',
    primaryName: 'Église Saint-Roman',
    lat: 44.002333, lng: 3.7777636,
    description:
      "Église paroissiale catholique, recensée au chapitre de Nîmes dès 1156. " +
      "Détruite et reconstruite plus de trois fois (guerres de religion, " +
      "incursions camisardes). Bâtiment actuel : XVIIIᵉ siècle ; dernière " +
      "restauration 1960-1982. Wikidata Q41754873.",
  },
  {
    id: 'hameau-de-bourras',
    primaryName: 'Hameau de Bourras',
    aliases: [{ name: 'Bouras' }, { name: 'Auberge de Bourras' }],
    lat: 44.00918, lng: 3.79003,
    description:
      "Hameau de la commune. Orthographié « Bouras » à l'origine, devenu " +
      "« Bourras ». Abrite le temple protestant de 1855 et une auberge encore " +
      "en activité aujourd'hui.",
  },
  {
    id: 'hameau-de-driolle',
    primaryName: 'Hameau de Driolle',
    aliases: [{ name: 'Drilholles' }],
    lat: 44.00427, lng: 3.80183,
    description:
      "Hameau de la commune, voisin du mas de la Bastide. Tristement célèbre " +
      "pour le massacre commis par les Waffen-SS le 29 février 1944. La maison " +
      "des Ordinez n'a jamais été reconstruite.",
  },
  {
    id: 'la-fage',
    primaryName: 'La Fage',
    aliases: [{ name: 'Montagne de la Fage' }],
    lat: 43.9907, lng: 3.8088,
    description:
      "Locality boisée à l'écart du village, propice aux assemblées clandestines. " +
      "Lieu privilégié des prêches protestants après la Révocation de l'Édit " +
      "de Nantes (1685).",
  },
  {
    id: 'mas-de-la-nible',
    primaryName: 'Mas de La Nible',
    lat: 44.00694, lng: 3.78461,
    description:
      "Mas isolé de la commune, propriété des Delpuech sous l'Ancien Régime " +
      "puis vendu aux Camplan pendant le Premier Empire (toujours dans la même " +
      "famille aujourd'hui).",
  },
  {
    id: 'mas-de-conduzorgues',
    primaryName: 'Mas de Conduzorgues',
    lat: 44.00963, lng: 3.79428,
    description:
      "Hameau de la commune, foyer attesté de la peste de 1588.",
  },
];

// ─── RÉCITS ───────────────────────────────────────────────────────────────

const STORIES = [
  // — Saint-Roman-de-Codières (centre, faits communaux) —
  {
    placeId: 'saint-roman-de-codieres',
    title: 'Géographie et origines antiques',
    body:
`Saint-Roman-de-Codières (en latin *Sanctus Romanus de Codeyra*) est juché sur la ligne de partage des eaux entre Hérault et Vidourle, au carrefour de trois vallons (Récodier, Vidourle, Savel). La tradition place ici, en 51 av. J.-C., un oppidum romain à l'emplacement même du château actuel.

Au haut Moyen Âge, le pays d'Aristum voit défiler les dominations wisigothique, franque, puis arabe (VIᵉ-VIIIᵉ s.), qui ont peut-être exploité la mine de plomb argentifère locale. Aristum sera ensuite rattaché au pays d'Hierle, dans la partie nord-occidentale du diocèse de Nîmes.

${SOURCE_NOTE}`,
  },
  {
    placeId: 'saint-roman-de-codieres',
    title: 'Les Bermond et la croisade des Albigeois (900-1293)',
    body:
`De 900 à 1217, Saint-Roman appartient aux Bermond d'Anduze et de Sauve. En 1209, au concile de Saint-Gilles, Pierre Bermond de Sauve fait, parmi seize vassaux, serment de fidélité au pape Innocent III contre l'hérésie cathare.

En 1215, Innocent III donne à Simon de Montfort les moyens de combattre Raymond VI de Toulouse : Saint-Roman tombe, sur le papier, dans les terres de Montfort, qui meurt au siège de Toulouse en 1218. Raymond VII reprend tout en 1222, avant que Louis VIII ne ramène la région au domaine royal.

En 1293, Philippe le Bel échange Montpellier contre Sauve et Saint-Roman avec l'évêque Bérenger de Frédol : les évêques de Maguelone (puis de Montpellier) deviennent seigneurs, prieurs, curés et notaires du lieu.

${SOURCE_NOTE}`,
  },
  {
    placeId: 'saint-roman-de-codieres',
    title: 'Vie quotidienne au village (XVIᵉ siècle)',
    body:
`En 1550, le village compte 130 bâtiments (maisons, jasses, clèdes, four) et un moulin blatier au mas de Fromental.

L'économie repose sur le **châtaignier** (fruits, tonnellerie expédiée jusqu'à Marseille, piquets de vigne), complété par froment, seigle, méteil et petit élevage. Chaque mas a son jardin, sa vigne, ses ruchers, sa cannebière (chanvre).

La société mêle paysans (laboureurs, métayers, bergers, brassiers) et artisans (fustiers, cardeurs, tisserands, cordonniers, maçons), un chapelier, un huissier ; aux XVIIᵉ-XVIIIᵉ s'ajoutent tonneliers, banastiers, facturiers de laine, régents d'école.

Chaque 1ᵉʳ janvier, la « partie la plus saine de la population » se réunit en *maison commune et consulaire* pour élire deux consuls et quatre conseillers, selon « la coustume antienne de toul temps observée ».

${SOURCE_NOTE}`,
  },
  {
    placeId: 'saint-roman-de-codieres',
    title: 'La Réforme et les guerres de religion (1568-1629)',
    body:
`Église réformée « dressée » en 1568. L'église catholique est détruite en 1570. La majorité du village bascule au protestantisme. L'édit de Nantes (1598) ramène un service catholique : en 1602, le prêtre Jean Bompar, du Malzieu en Gévaudan, est rémunéré 750 livres pour assurer une année d'office.

Les Cévennes fournissent en hommes les armées du duc de Rohan : Jean Aubanel, seigneur de Saint-Roman, lève des troupes en 1620 et 1625 aux frais des habitants. Une garnison de 10 soldats est installée au château en 1625, coût 300 livres pour trois mois.

En 1628, sur ordre de Rohan, les maisons proches du château sont rasées et l'église à nouveau ruinée. La paix revient en 1629, mais avec elle la peste.

${SOURCE_NOTE}`,
  },
  {
    placeId: 'saint-roman-de-codieres',
    title: 'La seigneurie : des Aubanel aux Serre (1620-1789)',
    body:
`En 1620, le prince de Valois, criblé de dettes, vend la seigneurie de Saint-Roman pour 3 600 livres à Jean Aubanel, ancien capitaine protestant de Saint-Hippolyte.

Procès interminables ensuite avec l'évêché de Montpellier (1654-1692) : le château est pris d'assaut, Pierre Bouzanquet de Saint-Hippolyte est tué, l'affaire remonte au conseil du Roi, à Castres, à Grenoble, à Paris. L'évêque rachète la baronnie de Sauve, l'échange contre La Vérune (1692), puis la seigneurie passe à Étienne Serre, baron de Meyrueis (1741).

Les Serre la garderont jusqu'à la Révolution. En 1789, Marie-Françoise de Sarret, dame de Saint-Roman, représente la noblesse aux états généraux ; Servières et Euzières le tiers état.

${SOURCE_NOTE}`,
  },
  {
    placeId: 'saint-roman-de-codieres',
    title: 'Révocation de 1685 et conversions forcées',
    body:
`À l'automne 1685, la peur déferle sur les Cévennes : conversions massives. Saint-Roman compte alors 278 catholiques et 319 à 347 protestants.

Le pasteur du village, condamné à être pendu, s'enfuit en Suisse. Le curé de Saint-Roman dresse en 1687 un rapport sur ses « nouveaux fidèles » : ceux qui font bien, ceux qui sont opiniâtres, celui qui a mangé de la viande un vendredi. Il conclut : *« Les femmes sont plus coupables que les hommes. »*

${SOURCE_NOTE}`,
  },
  {
    placeId: 'saint-roman-de-codieres',
    title: 'Du XIXᵉ siècle aux néo-ruraux',
    body:
`Après le Concordat (1805), Saint-Roman devient succursale du doyenné de Sumène. Le XIXᵉ siècle est paisible et prospère sous les comtes de Saint-Roman, descendants des Serre, pairs de France à partir de 1815 (érection de la terre en majorat).

Après la Seconde Guerre mondiale, les bouleversements démographiques voient les « soixante-huitards » former des communautés et fonder une association pour la vente de produits du terroir en région parisienne (sériciculture, apiculture, tissage).

Le tourisme prend depuis les années 1970, à l'initiative d'Aimé Valéry. Pour 184 habitants, la part des néo-ruraux dépasserait 80 %, avec une implantation européenne (Néerlandais, Anglais, Allemands).

${SOURCE_NOTE}`,
  },

  // — Tour de Saint-Roman —
  {
    placeId: 'tour-de-saint-roman',
    title: "L'oppidum romain et le château des Bermond",
    body:
`Une place forte romaine occupait, dit-on dès 51 av. J.-C., l'éperon où se dresse aujourd'hui le château. De 900 à 1217, les Bermond d'Anduze et de Sauve y érigent un château fort à la place de l'oppidum.

En 1200, le bourg n'est qu'un petit groupe de maisons autour de la tour, habité par les serviteurs de la chapelle et deux ou trois familles. La citerne et la fontaine voisine sont, à l'origine, l'unique point d'eau du site.

En 1621, Jean Aubanel y fait exécuter d'importants travaux : 20 toises de murailles à chaux et sable, trois guérites à la tour, un escalier à repos entre les deux tours, hausse de la petite tour à la hauteur de la grande, et trois portes, le tout pour 160 livres et douze pans de drap cadis.

${SOURCE_NOTE}`,
  },
  {
    placeId: 'tour-de-saint-roman',
    title: 'Le commandant Marchand et la Tour carrée',
    body:
`Vers 1900, le commandant **Jean-Baptiste Marchand**, héros de Fachoda, épouse **Raymonde Sene de Saint-Roman**. Le couple s'installe dans la Tour carrée.

Marchand est élu conseiller général du canton de Sumène en 1913, mandat qu'il conservera jusqu'en 1925. Il devient général de division pendant la Grande Guerre.

La tour, rénovée en 1838 avec un nouveau bâtiment remplaçant l'ancienne citerne, sert aujourd'hui de café et chambres d'hôtes ouverts l'été (juin à novembre).

${SOURCE_NOTE}`,
  },

  // — Église Saint-Roman —
  {
    placeId: 'eglise-saint-roman',
    title: 'Une église ravagée et reconstruite',
    body:
`Recensée au chapitre de Nîmes dès 1156, l'église de Saint-Roman a été incendiée et détruite plus de trois fois (pendant les guerres de religion, puis lors des incursions camisardes après la défaite du duc de Rohan), reconstruite à chaque fois.

Sa dernière restauration s'étend de 1960 à 1982. Elle abrite une reproduction très fidèle du tableau du Titien *Les pèlerins d'Emmaüs* (Louvre), offerte aux comtes de Saint-Roman par **l'impératrice Eugénie de Montijo**, épouse de Napoléon III, en remerciement d'un séjour qu'elle effectua dans la commune.

${SOURCE_NOTE}`,
  },
  {
    placeId: 'eglise-saint-roman',
    title: 'La cloche Jeanne-Romaine-Raymonde (1922)',
    body:
`En 1922, lors de l'angélus du soir, la cloche de l'église, déjà éprouvée par bien des vicissitudes, se fêle. Elle est refondue pour préserver sa note, et inaugurée et baptisée le 20 août 1922.

Elle reçoit le nom de **« Jeanne, Romaine, Raymonde »**, d'après ses parrain et marraine : Madame Raymonde de Serre de Saint-Roman et le général de division Jean-Baptiste Marchand.

${SOURCE_NOTE}`,
  },

  // — Hameau de Bourras —
  {
    placeId: 'hameau-de-bourras',
    title: 'Le temple de 1855',
    body:
`En 1855, le hameau de Bourras se dote d'un **temple protestant** pour les quelque 250 protestants de la commune.

Pendant longtemps, c'est l'un des seuls lieux de culte protestant accessible aux habitants des mas dispersés autour de Saint-Roman.

${SOURCE_NOTE}`,
  },
  {
    placeId: 'hameau-de-bourras',
    title: "L'Auberge de Bourras (XXᵉ-XXIᵉ siècles)",
    body:
`Le hameau de **Bouras** (orthographié à l'origine avec un seul « r », devenu **Bourras** avec deux) abritait jadis une auberge sur le chemin.

Aujourd'hui, dans le mouvement d'aménagement touristique des années 1970-1990 (initié à Saint-Roman par Aimé Valéry), le hameau accueille toujours des visiteurs sous le nom d'**Auberge de Bourras**.

${SOURCE_NOTE}`,
  },

  // — Hameau de Driolle —
  {
    placeId: 'hameau-de-driolle',
    title: 'Massacre du 29 février 1944',
    body:
`À 5 heures du matin, une colonne de **Waffen-SS** encercle le hameau de Driolle (ou Drilholles), voisin du mas de la Bastide.

Trois familles (Soulier, Perrier, Ordinez) paient le lourd tribut de la délation. **Sept personnes** sont emmenées en otages à Nîmes et pendues. Le jeune **Fernand Soulier** est exécuté d'une balle dans la tête ; son corps repose à l'entrée du hameau.

**Julien Perrier**, prévenu par une voisine, se cache dans une bergerie au-dessus du hameau, descend à Malignos avertir un réfractaire, qu'il sauve. Le hameau est arrosé d'essence, incendié, puis mitraillé par un avion volant à basse altitude.

La maison des Ordinez n'a jamais été reconstruite. Ce massacre, « sorte de répétition en miniature d'Oradour », est attesté par le témoignage de Julien Perrier, dernier témoin oculaire à l'époque de la rédaction de l'article.

${SOURCE_NOTE}`,
  },

  // — La Fage —
  {
    placeId: 'la-fage',
    title: 'Prêches clandestins et arrestation de Jean Samson dit Rouan (1686)',
    body:
`Après la Révocation de l'Édit de Nantes (octobre 1685), les prêches protestants se multiplient en pleine montagne. La Fage, par son isolement, devient un lieu privilégié d'**assemblées clandestines** dès novembre 1685.

Le prédicant **Isaac Vidal de Colognac**, décrit par Jurieu comme *« jeune homme de 22 ou 23 ans, boiteux, sans études, sans apparence, ayant fait le métier de cardeur à Colognac »*, y prêche deux fois en février 1686.

La répression est féroce. Le 25 février 1686, **Jean Samson dit « Rouan »**, cardeur de Saint-Roman âgé de 40 ans, est interrogé pour avoir assisté à une assemblée la nuit du samedi 23 dans une bergerie.

${SOURCE_NOTE}`,
  },

  // — Mas de La Nible —
  {
    placeId: 'mas-de-la-nible',
    title: 'Des Delpuech aux Camplan',
    body:
`Le mas de La Nible, propriété des **Delpuech** sous l'Ancien Régime, est cédé aux **Camplan** pendant le Premier Empire (toujours dans la même famille aujourd'hui).

Un drame y a marqué le XVIIIᵉ siècle : **Jean-Paul Delpuech de la Nible**, tout puissant à Saint-Roman et à Saint-Hippolyte, voit son fils **Paul François** dans l'armée du Nord en 1793 ; un acte de mariage du fils est retrouvé à Nîmes en frimaire de l'an II. Sa fille **Jeanne** et un autre **Paul** ont été assassinés sans que l'enquête du parlement ne parvienne à identifier les coupables, affaire restée non élucidée. La famille Delpuech disparaît ensuite des registres.

${SOURCE_NOTE}`,
  },

  // — Mas de Conduzorgues —
  {
    placeId: 'mas-de-conduzorgues',
    title: 'La peste de 1588 et le testament de Jean Capieu',
    body:
`En 1588, la peste sévit à Saint-Roman. Au mas de Conduzorgues, deux ou trois personnes sont déjà mortes lorsque **Jean Capieu**, *« fustier du lieu de Saint-Roman-de-Codières »*, se sait atteint à son tour.

Son testament, dicté sur place sur le chemin du mas vers Saint-Roman, prévoit qu'**Arnaud Barrafod de Monoblet**, sachant le danger, accepte de servir le père du mourant (un autre Jean Capieu) et les autres membres de la famille *« que Dieu voudra affliger de ce fléau, faire et tener les morts et après nettoyer les maisons »*.

${SOURCE_NOTE}`,
  },
];

// Sanity check : aucun em-dash autorisé dans les textes (biais d'écriture IA).
const FORBIDDEN = /—/;
for (const p of PLACES) {
  if (FORBIDDEN.test(p.description) || FORBIDDEN.test(p.primaryName)) {
    throw new Error(`em-dash interdit dans le lieu "${p.id}"`);
  }
}
for (const s of STORIES) {
  if (FORBIDDEN.test(s.body) || FORBIDDEN.test(s.title)) {
    throw new Error(`em-dash interdit dans le récit "${s.title}"`);
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('1. Membre Cahiers du Haut-Vidourle…');
  const m = await adminPost('/api/admin/members', {
    name: MEMBER.name,
    email: MEMBER.email,
    password: MEMBER.password,
    role: 'contributor',
  });
  if (m.status !== 201 && m.status !== 409) {
    throw new Error(`createMember échoué (${m.status}) : ${JSON.stringify(m.data)}`);
  }
  console.log(`   ${m.status === 201 ? 'créé' : 'déjà existant'}`);

  console.log('2. Login…');
  const cookie = await login(MEMBER.email, MEMBER.password);
  console.log('   ok');

  console.log(`3. Création de ${PLACES.length} Lieux pending…`);
  const placeIds = {};
  for (const p of PLACES) {
    const r = await memberPost('/api/places', {
      ...p,
      visibility: 'public',
      consentGiven: true,
      submittedBy: { name: MEMBER.name },
    }, cookie);
    if (r.status !== 201) {
      throw new Error(`place "${p.id}" échec (${r.status}) : ${JSON.stringify(r.data)}`);
    }
    placeIds[p.id] = r.data.place.id;
    console.log(`   ✓ ${r.data.place.id} (${p.lat}, ${p.lng})`);
  }

  console.log(`4. Création de ${STORIES.length} Récits pending…`);
  for (const s of STORIES) {
    const placeId = placeIds[s.placeId];
    if (!placeId) throw new Error(`placeId inconnu : ${s.placeId}`);
    const r = await memberPost('/api/stories', {
      type: 'text',
      title: s.title,
      body: s.body,
      placeId,
      visibility: 'public',
      consentGiven: true,
      submittedBy: { name: MEMBER.name },
    }, cookie);
    if (r.status !== 201) {
      throw new Error(`story "${s.title}" échec (${r.status}) : ${JSON.stringify(r.data)}`);
    }
    console.log(`   ✓ [${s.placeId}] ${s.title}`);
  }

  console.log(`\nFait. ${PLACES.length} lieux + ${STORIES.length} récits en file d'attente.`);
  console.log('→ Valide depuis /admin.html');
}

main().catch((e) => { console.error('ERREUR :', e.message); process.exit(1); });
