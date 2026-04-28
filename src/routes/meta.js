// Routes utilitaires : version, résolution d'alias, page d'accueil.
const express = require('express');
const { resolve } = require('../resolve');
const welcome = require('../welcome');

const router = express.Router();

router.get('/version', (_req, res) => {
  const pkg = require('../../package.json');
  res.json({ name: pkg.name, version: pkg.version });
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

module.exports = router;
