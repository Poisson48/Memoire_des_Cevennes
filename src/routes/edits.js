// Routes publiques pour proposer et consulter les éditions d'une entité.
// POST /api/:type/:id/edits — proposition de modification (style Wikipédia).
// GET  /api/:type/:id/edits — historique des propositions pour cette cible.
const express = require('express');
const edits = require('../edits');

const router = express.Router({ mergeParams: true });

// Le pattern :type(places|people|stories) verrouille les types autorisés.
router.post('/:type(places|people|stories)/:id/edits', async (req, res, next) => {
  try {
    const edit = await edits.propose({
      targetType: req.params.type,
      targetId: req.params.id,
      changes: (req.body && req.body.changes) || {},
      note: (req.body && req.body.note) || '',
      submittedBy: req.body && req.body.submittedBy,
    });
    res.status(201).json({ edit, message: 'Proposition reçue — en attente de validation admin.' });
  } catch (err) { next(err); }
});

router.get('/:type(places|people|stories)/:id/edits', (req, res) => {
  const { type, id } = req.params;
  res.json({
    edits: edits.list({ targetType: type, targetId: id, status: req.query.status || 'all' }),
  });
});

module.exports = router;
