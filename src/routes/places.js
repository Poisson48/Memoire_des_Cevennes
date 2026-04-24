// Routes /api/places/* (lecture publique, création → pending).
const express = require('express');
const places = require('../places');
const { resolveContributor } = require('../contributor');
const { requireAuth } = require('../middleware');
const { logActivity } = require('../activityLog');

const router = express.Router();

router.get('/', (req, res) => {
  const status = req.query.status === 'all' ? 'all' : 'approved';
  let list = places.list({ status });
  // Filtre visibilité : visiteurs non connectés → entrées "public" uniquement.
  if (!req.member) {
    list = list.filter(p => p.visibility === 'public');
  }
  res.json({ places: list });
});

router.get('/:id', (req, res) => {
  const place = places.get(req.params.id);
  if (!place) return res.status(404).json({ error: 'Lieu introuvable' });
  if (place.status !== 'approved' && req.query.preview !== '1') {
    return res.status(404).json({ error: 'Lieu introuvable (en attente)' });
  }
  // Filtre visibilité : masquer les entrées "members" aux visiteurs non connectés.
  if (!req.member && place.visibility !== 'public') {
    return res.status(404).json({ error: 'Lieu introuvable' });
  }
  res.json({ place });
});

router.post('/', requireAuth('contributor'), async (req, res, next) => {
  try {
    if (req.body.consentGiven !== true) {
      return res.status(400).json({ error: 'consentement requis' });
    }
    const payload = { ...(req.body || {}) };
    payload.submittedBy = await resolveContributor({
      submittedBy: req.body?.submittedBy,
      newPerson: req.body?.newPerson,
    });
    const place = await places.create(payload);
    logActivity({
      memberId: req.member.id,
      action: 'create',
      entityType: 'place',
      entityId: place.id,
      ip: req.ip,
    });
    res.status(201).json({ place, message: 'Ajout reçu — en attente de validation.' });
  } catch (err) { next(err); }
});

module.exports = router;
