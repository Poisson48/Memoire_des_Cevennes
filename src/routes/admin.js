// Routes d'administration : file de modération, approve/reject.
// Toutes sous /api/admin/*, protégées par middleware requireAdmin.
const express = require('express');
const moderation = require('../moderation');
const edits = require('../edits');
const { requireAdmin } = require('../middleware');

const router = express.Router();
router.use(requireAdmin);

router.get('/queue', (req, res) => {
  const type = req.query.type;
  res.json({ queue: moderation.queue({ type }), counts: moderation.counts() });
});

// Modération des créations (Place / Person / Story pending → approved).
router.post('/:type/:id/approve', async (req, res, next) => {
  try {
    const reviewer = req.body && req.body.reviewer ? String(req.body.reviewer) : 'admin';
    const updated = await moderation.approve(req.params.type, req.params.id, { reviewer });
    if (!updated) return res.status(404).json({ error: 'Entité introuvable' });
    res.json({ item: updated });
  } catch (err) { next(err); }
});

router.post('/:type/:id/reject', async (req, res, next) => {
  try {
    const reviewer = req.body && req.body.reviewer ? String(req.body.reviewer) : 'admin';
    const reason = (req.body && req.body.reason) || '';
    const updated = await moderation.reject(req.params.type, req.params.id, { reviewer, reason });
    if (!updated) return res.status(404).json({ error: 'Entité introuvable' });
    res.json({ item: updated });
  } catch (err) { next(err); }
});

// Modération des propositions de modification.
router.get('/edits/:id', (req, res) => {
  const edit = edits.get(req.params.id);
  if (!edit) return res.status(404).json({ error: 'introuvable' });
  res.json({ edit, diff: edits.diff(edit) });
});

router.post('/edits/:id/approve', async (req, res, next) => {
  try {
    const reviewer = req.body && req.body.reviewer ? String(req.body.reviewer) : 'admin';
    const out = await edits.approve(req.params.id, { reviewer });
    res.json({ edit: out });
  } catch (err) { next(err); }
});

router.post('/edits/:id/reject', async (req, res, next) => {
  try {
    const reviewer = req.body && req.body.reviewer ? String(req.body.reviewer) : 'admin';
    const reason = (req.body && req.body.reason) || '';
    const out = await edits.reject(req.params.id, { reviewer, reason });
    res.json({ edit: out });
  } catch (err) { next(err); }
});

module.exports = router;
