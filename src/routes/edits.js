// Routes publiques pour proposer et consulter les éditions d'une entité.
// POST /api/:type/:id/edits : proposition de modification (style Wikipédia).
// GET  /api/:type/:id/edits : historique des propositions pour cette cible.
const express = require('express');
const edits = require('../edits');
const { resolveContributor } = require('../contributor');

const router = express.Router({ mergeParams: true });

// Un admin ne « propose » pas : sa modification s'applique tout de suite.
// On garde la trace dans l'audit en passant par propose() + approve()
// (même mécanisme que la file de modération, mais en un geste).
async function maybeAutoApply(req, edit) {
  if (req.member && req.member.role === 'admin') {
    await edits.approve(edit.id, { reviewer: req.member.name || 'admin' });
    return true;
  }
  return false;
}

// Le pattern :type(places|people|stories) verrouille les types autorisés.
router.post('/:type(places|people|stories)/:id/edits', async (req, res, next) => {
  try {
    const submittedBy = await resolveContributor({
      submittedBy: req.body?.submittedBy,
      newPerson: req.body?.newPerson,
    });
    const edit = await edits.propose({
      targetType: req.params.type,
      targetId: req.params.id,
      changes: (req.body && req.body.changes) || {},
      note: (req.body && req.body.note) || '',
      submittedBy,
    });
    const applied = await maybeAutoApply(req, edit);
    res.status(201).json({
      edit, applied,
      message: applied
        ? 'Modification appliquée.'
        : 'Proposition reçue : en attente de validation admin.',
    });
  } catch (err) { next(err); }
});

router.get('/:type(places|people|stories)/:id/edits', (req, res) => {
  const { type, id } = req.params;
  res.json({
    edits: edits.list({ targetType: type, targetId: id, status: req.query.status || 'all' }),
  });
});

// Proposition d'édition sur une complétion (sous-ressource d'un récit).
// targetId composite storyId:completionId.
router.post('/stories/:sid/completions/:cid/edits', async (req, res, next) => {
  try {
    const submittedBy = await resolveContributor({
      submittedBy: req.body?.submittedBy,
      newPerson: req.body?.newPerson,
    });
    const edit = await edits.propose({
      targetType: 'completion',
      targetId: `${req.params.sid}:${req.params.cid}`,
      changes: (req.body && req.body.changes) || {},
      note: (req.body && req.body.note) || '',
      submittedBy,
    });
    const applied = await maybeAutoApply(req, edit);
    res.status(201).json({
      edit, applied,
      message: applied
        ? 'Modification appliquée.'
        : 'Proposition reçue : en attente de validation admin.',
    });
  } catch (err) { next(err); }
});

module.exports = router;
