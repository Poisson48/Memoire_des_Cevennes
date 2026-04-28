'use strict';

// Réglages globaux du site (titre, tagline) éditables depuis l'admin.
// Stocké dans data/site_config.json. Lu publiquement, écrit par l'admin.
//
// Le frontend public/js/site-config.js récupère ces valeurs au boot et
// remplace dynamiquement les <h1 data-site-title>, <p data-site-tagline>
// et le suffixe du <title> de la page.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'site_config.json');

const DEFAULTS = {
  title: 'Mémoire des Cévennes',
  tagline: 'Une carte pour recueillir les récits, les voix et les images de nos vallées.',
};

let _writeLock = Promise.resolve();

function load() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const obj = JSON.parse(raw);
    return {
      title:     typeof obj.title   === 'string' ? obj.title   : DEFAULTS.title,
      tagline:   typeof obj.tagline === 'string' ? obj.tagline : DEFAULTS.tagline,
      updatedAt: obj.updatedAt || null,
      updatedBy: obj.updatedBy || null,
    };
  } catch (e) {
    if (e.code === 'ENOENT') {
      return { ...DEFAULTS, updatedAt: null, updatedBy: null };
    }
    throw e;
  }
}

async function save({ title, tagline, updatedBy }) {
  const prev = _writeLock;
  let release;
  _writeLock = new Promise(res => { release = res; });
  try {
    await prev;
    const next = {
      title:     String(title   || '').trim().slice(0, 200) || DEFAULTS.title,
      tagline:   String(tagline || '').trim().slice(0, 400) || DEFAULTS.tagline,
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

module.exports = { load, save, DEFAULTS };
