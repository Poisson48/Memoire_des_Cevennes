// Routes du livret PDF par tags.
//   POST /api/livret/preview : { count, titles[] } pour la selection courante
//   POST /api/livret         : genere et renvoie le PDF (piece jointe)
// Accessible publiquement, mais le CONTENU est filtre par audience
// (visibilite + anonymisation) via src/audience.js. Rate-limit strict
// (Chromium est lourd).

'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { rateLimit } = require('express-rate-limit');
const audience = require('../audience');
const livret = require('../livret');

const router = express.Router();

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'css', 'livret-print.css');
let cssCache = null;
function printCss() {
  if (cssCache == null) {
    try { cssCache = fs.readFileSync(CSS_PATH, 'utf8'); } catch { cssCache = ''; }
  }
  return cssCache;
}

function parseSelection(body) {
  const arr = (v) => Array.isArray(v) ? v.map(String).slice(0, 200) : [];
  return { placeIds: arr(body && body.placeIds), personIds: arr(body && body.personIds) };
}

const pdfLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Trop de générations de livret : patiente quelques minutes.' },
});

router.post('/preview', (req, res, next) => {
  try {
    const aud = audience.audienceOf(req);
    res.json(livret.preview(parseSelection(req.body), aud));
  } catch (e) { next(e); }
});

router.post('/', pdfLimiter, async (req, res, next) => {
  try {
    const aud = audience.audienceOf(req);
    const selection = parseSelection(req.body);
    if (selection.placeIds.length === 0 && selection.personIds.length === 0) {
      return res.status(400).json({ error: 'Coche au moins un sujet (lieu ou personne).' });
    }
    const title = (req.body && typeof req.body.title === 'string')
      ? req.body.title.slice(0, 120) : 'Mémoire des Cévennes';
    const includeImages = req.body && req.body.includeImages !== false;

    const html = livret.buildHtml({ title, selection, aud, includeImages, css: printCss() });
    const pdf = await livret.renderPdf(html);

    const fname = 'livret-memoire-cevennes.pdf';
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(pdf);
  } catch (e) { next(e); }
});

module.exports = router;
