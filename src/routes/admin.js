// Routes d'administration : file de modération, approve/reject.
// Toutes sous /api/admin/*, protégées par middleware requireAdmin.
//
// Ordre important : les routes spécifiques (/edits/*, /stories/*/completions/*)
// doivent être déclarées AVANT la wildcard /:type/:id/*, sinon Express
// matche la wildcard en premier et on se retrouve avec targetType='edits'.
const express = require('express');
const fs   = require('fs');
const path = require('path');
const moderation = require('../moderation');
const edits = require('../edits');
const stories = require('../stories');
const places = require('../places');
const people = require('../people');
const auth = require('../auth');
const activityLog = require('../activityLog');
const backup = require('../backup');
const welcome = require('../welcome');
const backupsRouter = require('./backups');
const { requireAdmin } = require('../middleware');

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

// Supprime récursivement le dossier d'uploads d'un récit (médias attachés).
function removeStoryMedia(storyId) {
  const dir = path.join(UPLOADS_DIR, storyId);
  if (fs.existsSync(dir)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); }
    catch (e) { console.warn(`[admin/delete] échec rm uploads/${storyId} :`, e.message); }
  }
}

const router = express.Router();
router.use(requireAdmin);

// ─── Sauvegardes / Export / Import ────────────────────────────────────
// Routes /api/admin/backups/* : liste, création, restauration, suppression.
// /api/admin/export et /api/admin/import sont montés via les sous-routers
// exposés par ./backups (export = télécharger un nouveau backup ;
// import = uploader une archive externe pour la restaurer).
router.use('/backups', backupsRouter);
router.use('/export',  backupsRouter.exportRouter);
router.use('/import',  backupsRouter.importRouter);

// Aperçu du stockage : tailles data/, uploads/, backups/ (par kind),
// espace disque libre. Affiché en haut de l'onglet Sauvegardes.
router.get('/storage', async (_req, res, next) => {
  try { res.json(await backup.getStorageStats()); }
  catch (err) { next(err); }
});

// ─── Page d'accueil personnalisable ───────────────────────────────────
// La lecture publique est sous /api/welcome (routes/meta.js). L'écriture
// passe par ici, protégée par requireAdmin.
router.put('/welcome', async (req, res, next) => {
  try {
    const content = req.body && typeof req.body.content === 'string' ? req.body.content : '';
    if (content.length > 50_000) {
      return res.status(400).json({ error: 'Contenu trop long (50 000 caractères max).' });
    }
    const updatedBy = (req.member && (req.member.name || req.member.email)) || 'admin';
    const out = await welcome.save({ content, updatedBy });
    activityLog.logActivity({
      memberId: (req.member && req.member.id) || 'admin-token',
      action: 'welcome.update',
      entityType: 'welcome',
      entityId: '-',
      ip: req.ip,
    });
    res.json(out);
  } catch (err) { next(err); }
});

// ─── Membres ──────────────────────────────────────────────────────────
// Liste, approbation, changement de rôle, journal d'activité.
router.get('/members', (req, res) => {
  const members = auth.loadMembers().map(m => {
    const { passwordHash: _ph, ...safe } = m;
    return safe;
  });
  res.json({ members });
});

// Création d'un compte directement par un admin — déjà actif, rôle au choix.
// L'admin choisit un mot de passe initial (à changer par le membre ensuite).
router.post('/members', async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email et password sont requis.' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères.' });
    }
    const validRoles = ['member', 'contributor', 'admin'];
    const wantedRole = validRoles.includes(role) ? role : 'member';
    const member = await auth.createMember(email, password, name, {
      role: wantedRole,
      status: 'active',
      createdByAdmin: req.member ? req.member.id : null,
    });
    res.status(201).json({ ok: true, member, message: 'Compte créé et activé.' });
  } catch (err) {
    if (err.message && err.message.includes('existe déjà')) {
      return res.status(409).json({ error: err.message });
    }
    next(err);
  }
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

// ─── Déplacement d'un lieu ────────────────────────────────────────────
// Permet à l'admin de corriger les coordonnées d'un lieu existant (ex.
// pin posé approximativement par un contributeur). Pas de flux de
// modération : action directe, journalisée. L'ancienne position est
// stockée dans activity_log pour pouvoir reconstituer l'historique.
router.patch('/places/:id/move', async (req, res, next) => {
  try {
    const lat = Number(req.body && req.body.lat);
    const lng = Number(req.body && req.body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'lat et lng numériques requis' });
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'lat/lng hors limites géographiques' });
    }
    let before = null;
    const updated = await places.patch(req.params.id, (place) => {
      before = { lat: place.lat, lng: place.lng };
      return { lat, lng };
    });
    if (!updated) return res.status(404).json({ error: 'Lieu introuvable' });
    activityLog.logActivity({
      memberId: (req.member && req.member.id) || 'admin-token',
      action: 'place.move',
      entityType: 'place',
      entityId: req.params.id,
      ip: req.ip,
      // Le journal accepte des champs additionnels — on stocke les coords
      // d'avant/après pour pouvoir reconstituer l'historique.
      meta: { from: before, to: { lat, lng } },
    });
    res.json({ place: updated, from: before });
  } catch (err) { next(err); }
});

// ─── Suppression définitive ──────────────────────────────────────────
// Différent du "Refuser" qui passe juste status=rejected. Ici on retire
// l'entrée de la base + médias sur disque (pour les récits).
router.delete('/places/:id',  async (req, res, next) => {
  try {
    const removed = await places.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Lieu introuvable' });
    res.json({ ok: true, removed });
  } catch (err) { next(err); }
});

router.delete('/people/:id',  async (req, res, next) => {
  try {
    const removed = await people.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Personne introuvable' });
    res.json({ ok: true, removed });
  } catch (err) { next(err); }
});

router.delete('/stories/:id', async (req, res, next) => {
  try {
    const removed = await stories.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Récit introuvable' });
    removeStoryMedia(req.params.id);
    res.json({ ok: true, removed });
  } catch (err) { next(err); }
});

router.delete('/stories/:storyId/completions/:completionId', async (req, res, next) => {
  try {
    const removed = await stories.removeCompletion(req.params.storyId, req.params.completionId);
    if (!removed) return res.status(404).json({ error: 'Complétion introuvable' });
    res.json({ ok: true, removed });
  } catch (err) { next(err); }
});

module.exports = router;
