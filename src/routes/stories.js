// Routes /api/stories/* + upload de média attaché à un récit.
const express = require('express');
const stories = require('../stories');
const { upload } = require('../upload');
const { resolveContributor } = require('../contributor');
const { requireAuth } = require('../middleware');
const { logActivity } = require('../activityLog');

const router = express.Router();

router.get('/', (req, res) => {
  const status = req.query.status === 'all' ? 'all' : 'approved';
  let list = stories.list({
    status,
    placeId: req.query.placeId,
    personId: req.query.personId,
  });
  // Filtre visibilité : visiteurs non connectés → entrées "public" uniquement.
  if (!req.member) {
    list = list.filter(s => s.visibility === 'public');
  }
  res.json({ stories: list });
});

router.get('/:id', (req, res) => {
  const story = stories.get(req.params.id);
  if (!story) return res.status(404).json({ error: 'Récit introuvable' });
  if (story.status !== 'approved' && req.query.preview !== '1') {
    return res.status(404).json({ error: 'Récit introuvable (en attente)' });
  }
  // Filtre visibilité : masquer les entrées "members" aux visiteurs non connectés.
  if (!req.member && story.visibility !== 'public') {
    return res.status(404).json({ error: 'Récit introuvable' });
  }
  res.json({ story });
});

router.post('/', requireAuth('contributor'), async (req, res, next) => {
  try {
    if (req.body.consentGiven !== true) {
      return res.status(400).json({ error: 'consentement requis' });
    }
    if (!req.body || !req.body.placeId) {
      return res.status(400).json({ error: 'placeId requis' });
    }
    const payload = { ...req.body };
    payload.submittedBy = await resolveContributor({
      submittedBy: req.body.submittedBy,
      newPerson: req.body.newPerson,
    });
    // contributorId pointe vers la Personne du contributeur (si lié).
    if (payload.submittedBy?.personId && !payload.contributorId) {
      payload.contributorId = payload.submittedBy.personId;
    }
    const story = await stories.create(payload);
    logActivity({
      memberId: req.member.id,
      action: 'create',
      entityType: 'story',
      entityId: story.id,
      ip: req.ip,
    });
    res.status(201).json({ story, message: 'Ajout reçu — en attente de validation.' });
  } catch (err) { next(err); }
});

// Compléter une histoire existante : n'importe qui peut ajouter un
// chapitre qui vient s'attacher au récit. La complétion tombe en
// pending, l'admin valide.
router.post('/:id/completions', requireAuth('contributor'), async (req, res, next) => {
  try {
    if (req.body.consentGiven !== true) {
      return res.status(400).json({ error: 'consentement requis' });
    }
    const body = (req.body && req.body.body) || '';
    if (!String(body).trim()) {
      return res.status(400).json({ error: 'Le champ body est requis.' });
    }
    const submittedBy = await resolveContributor({
      submittedBy: req.body && req.body.submittedBy,
      newPerson: req.body && req.body.newPerson,
    });
    const completion = await stories.addCompletion(req.params.id, { body, submittedBy });
    if (!completion) return res.status(404).json({ error: 'Récit introuvable' });
    logActivity({
      memberId: req.member.id,
      action: 'create',
      entityType: 'completion',
      entityId: req.params.id,
      ip: req.ip,
    });
    res.status(201).json({
      completion,
      message: 'Complétion reçue — en attente de validation admin.',
    });
  } catch (err) { next(err); }
});

// Upload d'un ou plusieurs médias rattachés à un récit existant.
router.post('/:id/media', requireAuth('contributor'), (req, res, next) => {
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
      logActivity({
        memberId: req.member.id,
        action: 'create',
        entityType: 'media',
        entityId: req.params.id,
        ip: req.ip,
      });
      res.json({ story: updated, added: files });
    } catch (e) { next(e); }
  });
});

module.exports = router;
