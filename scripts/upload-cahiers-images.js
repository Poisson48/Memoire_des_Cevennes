#!/usr/bin/env node
// Upload des doubles-pages scannées du dossier N°17 (Saint-Roman) sur les
// récits déjà créés. Chaque page PDF devient un mediaFile rattaché au récit
// le plus pertinent (texte / illustration dominante).
//
// Pré-requis : pdfimages aura déjà été lancé pour produire les .jpg dans
//   /tmp/cahiers-images/n17-XXX-NNN.jpg
//
// Usage :
//   ADMIN_TOKEN=dev BASE=http://localhost:18542 \
//     node scripts/upload-cahiers-images.js

const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:18542';
const IMG_DIR = '/tmp/cahiers-images';
const MEMBER = {
  email: 'cahiers@haut-vidourle.local',
  password: 'cahiersHV-2026!placeholder',
};

// Mapping page PDF → { récit, légende }.
// Pages PDF du dossier N°17 (Janv. 2004) couvrant la monographie complète.
// Numérotation interne au numéro affichée entre parenthèses.
const PAGE_MAP = [
  { pdfPage: 553, story: 'geographie-et-origines-antiques',
    caption: 'N°17, p. 30-31 : tour de Saint-Roman (versant Vidourle), fontaine d\'origine, Simon de Montfort.' },
  { pdfPage: 554, story: 'les-bermond-et-la-croisade-des-albigeois-900-1293',
    caption: 'N°17, p. 32-33 : la tour des Bermond, dessin de Guy Piplard d\'après documents du XIVᵉ siècle.' },
  { pdfPage: 555, story: 'l-oppidum-romain-et-le-chateau-des-bermond',
    caption: 'N°17, p. 34-35 : le château de Saint-Roman-de-Codières et les vallons (Récodier, Vidourle, Savel).' },
  { pdfPage: 556, story: 'la-reforme-et-les-guerres-de-religion-1568-1629',
    caption: 'N°17, p. 36-37 : couverture Partie 2 — hameaux de Bouras et Drioles, maréchal de Montrevel.' },
  { pdfPage: 557, story: 'des-delpuech-aux-camplan',
    caption: 'N°17, p. 38-39 : mas de la Nible vu de la tour, et mas de Fromental dans le vallon du Récodier.' },
  { pdfPage: 558, story: 'la-seigneurie-des-aubanel-aux-serre-1620-1789',
    caption: 'N°17, p. 40-41 : hameau de Montredon dans le vallon du Savel.' },
  { pdfPage: 559, story: 'l-auberge-de-bourras-xx-xxi-siecles',
    caption: 'N°17, p. 42-43 : Bouras abrite aujourd\'hui une auberge.' },
  { pdfPage: 560, story: 'preches-clandestins-et-arrestation-de-jean-samson-dit-rouan-',
    caption: 'N°17, p. 44-45 : le mas de la Salle, dans le vallon du Récodier.' },
  { pdfPage: 561, story: 'preches-clandestins-et-arrestation-de-jean-samson-dit-rouan-',
    caption: 'N°17, p. 46-47 : maréchal de Montrevel ; Salomon Sabatier dit Salomonet, faiseur de bas du mas de Drilholles, prédicant camisard.' },
  { pdfPage: 562, story: 'vie-quotidienne-au-village-xvi-siecle',
    caption: 'N°17, p. 48-49 : Saint-Roman au début du XVIIIᵉ siècle (109 familles en 1714, 608 habitants en 1768).' },
  { pdfPage: 563, story: 'revocation-de-1685-et-conversions-forcees',
    caption: 'N°17, p. 50-51 : appels de notes ; cahier de doléances de 1789.' },
  { pdfPage: 564, story: 'une-eglise-ravagee-et-reconstruite',
    caption: 'N°17, p. 52-53 : couverture Partie 3 — l\'église plusieurs fois remaniée (1960-1982), le temple de Bourras (1855), la tour rénovée en 1838.' },
  { pdfPage: 565, story: 'massacre-du-29-fevrier-1944',
    caption: 'N°17, p. 54-55 : la maison qu\'occupait la famille Ordinez au hameau de Driolle, incendiée par les SS en 1944 et jamais reconstruite. Mas de La Coste.' },
];

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
  return r.headers.get('set-cookie').split(';')[0];
}

async function uploadOne({ pdfPage, story, caption }, cookie) {
  // Trouve le fichier image correspondant à la page (n17-PAGE-IDX.jpg)
  const files = fs.readdirSync(IMG_DIR);
  const match = files.find((f) => new RegExp(`n17-${pdfPage}-\\d+\\.jpg$`).test(f));
  if (!match) throw new Error(`image manquante pour page ${pdfPage}`);
  const filePath = path.join(IMG_DIR, match);
  const buf = fs.readFileSync(filePath);

  const fd = new FormData();
  // Le nom de fichier inclut la page pour rester traçable côté serveur.
  const blob = new Blob([buf], { type: 'image/jpeg' });
  fd.append('media', blob, `cahiers-n17-page-${pdfPage}.jpg`);
  fd.append('captions', caption);

  const r = await fetch(`${BASE}/api/stories/${story}/media`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: fd,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`upload page ${pdfPage} → ${story} : HTTP ${r.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function main() {
  console.log('Login…');
  const cookie = await login(MEMBER.email, MEMBER.password);
  console.log('  ok\n');

  let ok = 0, ko = 0;
  for (const entry of PAGE_MAP) {
    process.stdout.write(`p.${entry.pdfPage} → ${entry.story} … `);
    try {
      await uploadOne(entry, cookie);
      console.log('✓');
      ok++;
    } catch (e) {
      console.log('✗ ' + e.message);
      ko++;
    }
  }
  console.log(`\n${ok} uploads OK, ${ko} échecs.`);
}

main().catch((e) => { console.error('ERREUR :', e.message); process.exit(1); });
