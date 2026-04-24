// Routes /api/people/* (lecture publique, création → pending).
const express = require('express');
const people = require('../people');
const { resolveContributor } = require('../contributor');
const { requireAuth } = require('../middleware');
const { logActivity } = require('../activityLog');

const router = express.Router();

/**
 * Masque les champs sensibles d'une personne pour les visiteurs non-membres.
 * Spec Option C : name, bio, aliases retirés de la réponse.
 */
function maskPerson(person) {
  // eslint-disable-next-line no-unused-vars
  const { name, bio, aliases, ...rest } = person;
  return { ...rest, name: '[Identité masquée]', bio: null, aliases: [] };
}

router.get('/', (req, res) => {
  const status = req.query.status === 'all' ? 'all' : 'approved';
  let list = people.list({ status });
  // Filtre visibilité : visiteurs non connectés → entrées "public" uniquement,
  // avec masquage des champs sensibles (name, bio, aliases).
  if (!req.member) {
    list = list
      .filter(p => p.visibility === 'public')
      .map(maskPerson);
  }
  res.json({ people: list });
});

router.get('/:id', (req, res) => {
  const person = people.get(req.params.id);
  if (!person) return res.status(404).json({ error: 'Personne introuvable' });
  if (person.status !== 'approved' && req.query.preview !== '1') {
    return res.status(404).json({ error: 'Personne introuvable (en attente)' });
  }
  // Filtre visibilité : masquer les entrées "members" aux visiteurs non connectés.
  if (!req.member && person.visibility !== 'public') {
    return res.status(404).json({ error: 'Personne introuvable' });
  }
  const personData = req.member ? person : maskPerson(person);
  res.json({
    person: personData,
    children: people.childrenOf(person.id),
    siblings: people.siblingsOf(person.id),
  });
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
    const person = await people.create(payload);
    logActivity({
      memberId: req.member.id,
      action: 'create',
      entityType: 'person',
      entityId: person.id,
      ip: req.ip,
    });
    res.status(201).json({ person, message: 'Ajout reçu — en attente de validation.' });
  } catch (err) { next(err); }
});

module.exports = router;
