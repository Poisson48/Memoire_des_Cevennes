// Routes utilitaires : version, résolution d'alias.
const express = require('express');
const { resolve } = require('../resolve');

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

module.exports = router;
