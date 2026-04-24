// Routes d'administration : file de modération, approve/reject.
// Toutes sous /api/admin/*, protégées par middleware requireAdmin.
//
// Ordre important : les routes spécifiques (/edits/*, /stories/*/completions/*)
// doivent être déclarées AVANT la wildcard /:type/:id/*, sinon Express
// matche la wildcard en premier et on se retrouve avec targetType='edits'.
const express = require('express');
const moderation = require('../moderation');
const edits = require('../edits');
const stories = require('../stories');
const auth = require('../auth');
const activityLog = require('../activityLog');
const { requireAdmin } = require('../middleware');

const router = express.Router();
router.use(requireAdmin);

// ─── Membres ──────────────────────────────────────────────────────────
// Liste, approbation, changement de rôle, journal d'activité.
router.get('/members', (req, res) => {
  const members = auth.loadMembers().map(m => {
    const { passwordHash: _ph, ...safe } = m;
    return safe;
  });
  res.json({ members });
});

router.post('/members/:id/approve', (req, res, next) => {
  try {
    const member = auth.approveMember(req.params.id);
    res.json({ member });
  } catch (err) { next(err); }
});

router.post('/members/:id/role', (req, res, next) => {
  try {
    const role = req.body && req.body.role;
    const member = auth.setRole(req.params.id, role);
    res.json({ member });
  } catch (err) { next(err); }
});

router.get('/activity', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 2000);
  const log = activityLog.readLog().slice(-limit).reverse();
  res.json({ activity: log });
});

router.get('/queue', (req, res) => {
  const type = req.query.type;
  res.json({ queue: moderation.queue({ type }), counts: moderation.counts() });
});

// ─── Propositions de modification ─────────────────────────────────────
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

// ─── Complétions (sous-records d'un récit) ────────────────────────────
router.post('/stories/:storyId/completions/:completionId/approve', async (req, res, next) => {
  try {
    const reviewer = req.body && req.body.reviewer ? String(req.body.reviewer) : 'admin';
    const out = await stories.patchCompletion(req.params.storyId, req.params.completionId, () => ({
      status: 'approved',
      reviewedAt: new Date().toISOString(),
      reviewedBy: reviewer,
      rejectionReason: undefined,
    }));
    if (!out) return res.status(404).json({ error: 'Complétion introuvable' });
    res.json({ completion: out });
  } catch (err) { next(err); }
});

router.post('/stories/:storyId/completions/:completionId/reject', async (req, res, next) => {
  try {
    const reviewer = req.body && req.body.reviewer ? String(req.body.reviewer) : 'admin';
    const reason = (req.body && req.body.reason) || '';
    const out = await stories.patchCompletion(req.params.storyId, req.params.completionId, () => ({
      status: 'rejected',
      reviewedAt: new Date().toISOString(),
      reviewedBy: reviewer,
      rejectionReason: String(reason).slice(0, 2000),
    }));
    if (!out) return res.status(404).json({ error: 'Complétion introuvable' });
    res.json({ completion: out });
  } catch (err) { next(err); }
});

// ─── Créations (Place / Person / Story pending → approved) ────────────
// Wildcard en dernier — contrainte via regex pour que 'edits' / 'stories'
// avec un sous-path ne tombent PAS ici par erreur.
router.post('/:type(places|people|stories)/:id/approve', async (req, res, next) => {
  try {
    const reviewer = req.body && req.body.reviewer ? String(req.body.reviewer) : 'admin';
    const updated = await moderation.approve(req.params.type, req.params.id, { reviewer });
    if (!updated) return res.status(404).json({ error: 'Entité introuvable' });
    res.json({ item: updated });
  } catch (err) { next(err); }
});

router.post('/:type(places|people|stories)/:id/reject', async (req, res, next) => {
  try {
    const reviewer = req.body && req.body.reviewer ? String(req.body.reviewer) : 'admin';
    const reason = (req.body && req.body.reason) || '';
    const updated = await moderation.reject(req.params.type, req.params.id, { reviewer, reason });
    if (!updated) return res.status(404).json({ error: 'Entité introuvable' });
    res.json({ item: updated });
  } catch (err) { next(err); }
});

module.exports = router;
