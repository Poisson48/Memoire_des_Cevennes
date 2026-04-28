'use strict';

// Page d'accueil personnalisable — contenu markdown stocké dans
// data/welcome.json. Accessible publiquement en lecture (le modal
// d'accueil le récupère au boot du frontend), modifiable uniquement par
// l'admin.
//
// Volontairement séparé de storage.js : pas une "entité" du graphe avec
// modération, juste un singleton de configuration. Verrou + écriture
// atomique néanmoins (tmp + rename) pour éviter les races.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'welcome.json');

const DEFAULT_CONTENT = `# Bienvenue sur Mémoire des Cévennes

Cette carte vivante rassemble les **lieux**, les **personnes** et les **histoires** de Saint-Roman-de-Codières et de ses alentours.

## Comment ça marche

- 📍 **Explore la carte** : clique sur les pastilles pour découvrir lieux et récits.
- 📖 **Lis les fiches** : chaque lieu peut contenir des photos, des audios, des témoignages.
- ✍️ **Contribue** : crée un compte pour ajouter tes propres souvenirs (modérés par l'association).

## Rejoindre l'aventure

Pour aller plus loin, [crée un compte membre](register.html) ou [consulte le tutoriel](aide.html).

*Bonne visite !*
`;

let _writeLock = Promise.resolve();

function load() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const obj = JSON.parse(raw);
    if (typeof obj.content !== 'string') {
      return { content: DEFAULT_CONTENT, updatedAt: null, updatedBy: null };
    }
    return obj;
  } catch (e) {
    if (e.code === 'ENOENT') {
      return { content: DEFAULT_CONTENT, updatedAt: null, updatedBy: null };
    }
    throw e;
  }
}

async function save({ content, updatedBy }) {
  // Verrou simple pour sérialiser les écritures concurrentes.
  const prev = _writeLock;
  let release;
  _writeLock = new Promise(res => { release = res; });
  try {
    await prev;
    const next = {
      content: String(content || '').slice(0, 50_000),
      updatedAt: new Date().toISOString(),
      updatedBy: updatedBy ? String(updatedBy).slice(0, 120) : 'admin',
    };
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
    fs.renameSync(tmp, FILE);
    return next;
  } finally {
    release();
  }
}

module.exports = { load, save, DEFAULT_CONTENT };
