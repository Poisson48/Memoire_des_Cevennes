// POST /api/ocr : extrait le texte d'une image (OCR local Tesseract).
//
// Reserve aux membres connectes (c'est un outil de saisie pour les
// contributeurs). L'image transite en memoire (pas de stockage disque ici) :
// le texte renvoye est relu/corrige cote client avant d'etre eventuellement
// insere dans le recit ou attache au media (champ ocrText).

'use strict';

const express = require('express');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const { requireAuth } = require('../middleware');
const ocr = require('../ocr');

const router = express.Router();

// Upload en memoire, une seule image, 25 Mo max.
const uploadMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype)) return cb(null, true);
    cb(new Error('Seules les images sont acceptees pour l’OCR.'));
  },
});

// L'OCR est couteux en CPU : on borne le rythme par IP.
const ocrLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Trop de demandes d’OCR : patiente quelques minutes.' },
});

// Indique au client si l'OCR est disponible (pour afficher/masquer le bouton).
router.get('/status', (_req, res) => {
  res.json({ available: ocr.available() });
});

router.post('/', requireAuth('member'), ocrLimiter, (req, res, next) => {
  uploadMem.single('media')(req, res, async (err) => {
    if (err) return next(err);
    try {
      if (!req.file) return res.status(400).json({ error: 'Aucune image fournie (champ « media »).' });
      const { text } = await ocr.recognize(req.file.buffer, { mime: req.file.mimetype });
      res.json({ text });
    } catch (e) {
      if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
      next(e);
    }
  });
});

module.exports = router;
