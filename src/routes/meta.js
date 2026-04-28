// Routes utilitaires : version, changelog, résolution d'alias, page d'accueil.
const express = require('express');
const { execFile } = require('child_process');
const path = require('path');
const { resolve } = require('../resolve');
const welcome = require('../welcome');
const siteConfig = require('../siteConfig');

const router = express.Router();
const REPO_ROOT = path.join(__dirname, '..', '..');

router.get('/version', (_req, res) => {
  const pkg = require('../../package.json');
  res.json({ name: pkg.name, version: pkg.version });
});

// Liste des "vrais" bumps de version, lus depuis git log. On considère qu'un
// commit dont le sujet commence par "vX.Y" ou "Bump X.Y" est un bump qui
// justifie un numéro supérieur. Le body du commit est rendu tel quel pour que
// le mainteneur garde la main sur ce qui s'affiche aux contributeurs.
let changelogCache = null;
let changelogCacheAt = 0;
const CHANGELOG_TTL_MS = 60_000;

router.get('/changelog', (_req, res) => {
  const now = Date.now();
  if (changelogCache && now - changelogCacheAt < CHANGELOG_TTL_MS) {
    return res.json(changelogCache);
  }
  // Format : <hash><iso-date><subject><body>
  // Séparateurs ASCII unitaires pour ne pas collisionner avec le contenu.
  execFile('git', [
    '-C', REPO_ROOT,
    'log',
    '--all',
    '--extended-regexp',
    '--grep=^(v[0-9]+\\.[0-9]+|Bump [0-9]+\\.[0-9]+)',
    '--pretty=format:%H%x1f%aI%x1f%s%x1f%b%x1e',
  ], { maxBuffer: 2_000_000 }, (err, stdout) => {
    if (err) {
      return res.json({ entries: [], error: 'git log indisponible' });
    }
    const entries = stdout.split('\x1e')
      .map(chunk => chunk.replace(/^\n+/, ''))
      .filter(Boolean)
      .map(chunk => {
        const [hash, date, subject, body] = chunk.split('\x1f');
        const m = subject.match(/^(?:v|Bump\s+)([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i);
        return {
          version: m ? m[1] : null,
          date: date ? date.slice(0, 10) : '',
          subject: subject || '',
          body: (body || '').trim(),
          hash: hash || '',
        };
      })
      .filter(e => e.version);
    changelogCache = { entries };
    changelogCacheAt = now;
    res.json(changelogCache);
  });
});

router.get('/resolve', (req, res) => {
  const q = String(req.query.q || '');
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
  res.json({ results: resolve(q, { limit }) });
});

// Page d'accueil personnalisable (contenu markdown). Lecture publique
// utilisée par le modal d'accueil. L'écriture passe par /api/admin/welcome.
router.get('/welcome', (_req, res) => {
  res.json(welcome.load());
});

// Réglages du site (titre, tagline) — lecture publique, lue par le script
// public/js/site-config.js sur chaque page pour remplacer les valeurs par
// défaut codées dans le HTML.
router.get('/site-config', (_req, res) => {
  res.json(siteConfig.load());
});

module.exports = router;
