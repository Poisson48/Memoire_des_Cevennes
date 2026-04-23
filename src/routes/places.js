// Routes /api/places/* (lecture publique, création → pending).
const express = require('express');
const places = require('../places');

const router = express.Router();

router.get('/', (req, res) => {
  const status = req.query.status === 'all' ? 'all' : 'approved';
  res.json({ places: places.list({ status }) });
});

router.get('/:id', (req, res) => {
  const place = places.get(req.params.id);
  if (!place) return res.status(404).json({ error: 'Lieu introuvable' });
  if (place.status !== 'approved' && req.query.preview !== '1') {
    return res.status(404).json({ error: 'Lieu introuvable (en attente)' });
  }
  res.json({ place });
});

router.post('/', async (req, res, next) => {
  try {
    const place = await places.create(req.body || {});
    res.status(201).json({ place, message: 'Ajout reçu — en attente de validation.' });
  } catch (err) { next(err); }
});

module.exports = router;
