// POST /api/ocr : extrait le texte d'une image (OCR local Tesseract).
//
// Reserve aux membres connectes (c'est un outil de saisie pour les
// contributeurs). L'image transite en memoire (pas de stockage disque ici) :
// le texte renvoye est relu/corrige cote client avant d'etre eventuellement
// insere dans le recit ou attache au media (champ ocrText).

'use strict';

const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware');
const { opLog } = require('../oplog');
const ocr = require('../ocr');

const router = express.Router();

// Upload en memoire, une seule image, 25 Mo max. Reserve aux membres
// (comptes sur invitation) : pas de rate-limit, mais chaque appel est
// journalise (voir opLog) pour reperer un eventuel abus.
const uploadMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype)) return cb(null, true);
    cb(new Error('Seules les images sont acceptees pour l’OCR.'));
  },
});

// Indique au client si l'OCR est disponible (pour afficher/masquer le bouton).
router.get('/status', (_req, res) => {
  res.json({ available: ocr.available() });
});

router.post('/', requireAuth('member'), (req, res, next) => {
  uploadMem.single('media')(req, res, async (err) => {
    if (err) return next(err);
    const t0 = Date.now();
    try {
      if (!req.file) return res.status(400).json({ error: 'Aucune image fournie (champ « media »).' });
      const { text } = await ocr.recognize(req.file.buffer, { mime: req.file.mimetype });
      opLog(req, 'ocr', { bytes: req.file.size, chars: text.length, ms: Date.now() - t0 });
      res.json({ text });
    } catch (e) {
      opLog(req, 'ocr.fail', { bytes: req.file && req.file.size, ms: Date.now() - t0, err: e.message });
      if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
      next(e);
    }
  });
});

module.exports = router;
