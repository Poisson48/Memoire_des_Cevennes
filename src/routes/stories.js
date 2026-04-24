// Routes /api/stories/* + upload de média attaché à un récit.
const express = require('express');
const stories = require('../stories');
const { upload } = require('../upload');

const router = express.Router();

router.get('/', (req, res) => {
  const status = req.query.status === 'all' ? 'all' : 'approved';
  res.json({
    stories: stories.list({
      status,
      placeId: req.query.placeId,
      personId: req.query.personId,
    }),
  });
});

router.get('/:id', (req, res) => {
  const story = stories.get(req.params.id);
  if (!story) return res.status(404).json({ error: 'Récit introuvable' });
  if (story.status !== 'approved' && req.query.preview !== '1') {
    return res.status(404).json({ error: 'Récit introuvable (en attente)' });
  }
  res.json({ story });
});

router.post('/', async (req, res, next) => {
  try {
    if (!req.body || !req.body.placeId) {
      return res.status(400).json({ error: 'placeId requis' });
    }
    const story = await stories.create(req.body);
    res.status(201).json({ story, message: 'Ajout reçu — en attente de validation.' });
  } catch (err) { next(err); }
});

// Compléter une histoire existante : n'importe qui peut ajouter un
// chapitre qui vient s'attacher au récit. La complétion tombe en
// pending, l'admin valide.
router.post('/:id/completions', async (req, res, next) => {
  try {
    const body = (req.body && req.body.body) || '';
    if (!String(body).trim()) {
      return res.status(400).json({ error: 'Le champ body est requis.' });
    }
    const completion = await stories.addCompletion(req.params.id, {
      body,
      submittedBy: req.body && req.body.submittedBy,
    });
    if (!completion) return res.status(404).json({ error: 'Récit introuvable' });
    res.status(201).json({
      completion,
      message: 'Complétion reçue — en attente de validation admin.',
    });
  } catch (err) { next(err); }
});

// Upload d'un ou plusieurs médias rattachés à un récit existant.
router.post('/:id/media', (req, res, next) => {
  upload.array('media', 10)(req, res, async (err) => {
    if (err) return next(err);
    try {
      const story = stories.get(req.params.id);
      if (!story) return res.status(404).json({ error: 'Récit introuvable' });
      const files = (req.files || []).map(f => ({
        url: `/uploads/${req.params.id}/${f.filename}`,
        mime: f.mimetype,
      }));
      const updated = await stories.patch(req.params.id, (s) => ({
        mediaFiles: [...(s.mediaFiles || []), ...files],
      }));
      res.json({ story: updated, added: files });
    } catch (e) { next(e); }
  });
});

module.exports = router;
