// Routes /api/people/* (lecture publique, création → pending).
const express = require('express');
const people = require('../people');
const { resolveContributor } = require('../contributor');

const router = express.Router();

router.get('/', (req, res) => {
  const status = req.query.status === 'all' ? 'all' : 'approved';
  res.json({ people: people.list({ status }) });
});

router.get('/:id', (req, res) => {
  const person = people.get(req.params.id);
  if (!person) return res.status(404).json({ error: 'Personne introuvable' });
  if (person.status !== 'approved' && req.query.preview !== '1') {
    return res.status(404).json({ error: 'Personne introuvable (en attente)' });
  }
  res.json({
    person,
    children: people.childrenOf(person.id),
    siblings: people.siblingsOf(person.id),
  });
});

router.post('/', async (req, res, next) => {
  try {
    const payload = { ...(req.body || {}) };
    payload.submittedBy = await resolveContributor({
      submittedBy: req.body?.submittedBy,
      newPerson: req.body?.newPerson,
    });
    const person = await people.create(payload);
    res.status(201).json({ person, message: 'Ajout reçu — en attente de validation.' });
  } catch (err) { next(err); }
});

module.exports = router;
