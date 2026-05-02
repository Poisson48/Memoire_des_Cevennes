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
const siteConfig = require('../siteConfig');
const passwordResets = require('../passwordResets');
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

// ─── Réglages du site (titre, tagline) ───────────────────────────────
router.get('/site-config', (_req, res) => {
  res.json(siteConfig.load());
});

router.put('/site-config', async (req, res, next) => {
  try {
    const { title, tagline } = req.body || {};
    const updatedBy = (req.member && (req.member.name || req.member.email)) || 'admin';
    const out = await siteConfig.save({ title, tagline, updatedBy });
    activityLog.logActivity({
      memberId: (req.member && req.member.id) || 'admin-token',
      action: 'site-config.update',
      entityType: 'site-config',
      entityId: '-',
      ip: req.ip,
    });
    res.json(out);
  } catch (err) { next(err); }
});

// ─── Membres ──────────────────────────────────────────────────────────
// Liste, approbation, changement de rôle, journal d'activité.
router.get('/members', (req, res) => {
  const all = auth.loadMembers().map(m => {
    const { passwordHash: _ph, ...safe } = m;
    return safe;
  });
  // Index pour signaler les doublons mous : même téléphone normalisé, ou
  // même nom (lowercase trim). On expose `duplicateHints` par membre pour
  // que l'UI puisse afficher un badge "doublon possible".
  const byPhone = new Map();
  const byName  = new Map();
  for (const m of all) {
    const p = auth.normalizePhone(m.phone);
    if (p) {
      if (!byPhone.has(p)) byPhone.set(p, []);
      byPhone.get(p).push(m.id);
    }
    const n = (m.name || '').toLowerCase().trim().replace(/\s+/g, ' ');
    if (n) {
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n).push(m.id);
    }
  }
  const members = all.map(m => {
    const p = auth.normalizePhone(m.phone);
    const n = (m.name || '').toLowerCase().trim().replace(/\s+/g, ' ');
    const phoneIds = p ? (byPhone.get(p) || []).filter(id => id !== m.id) : [];
    const nameIds  = n ? (byName.get(n)  || []).filter(id => id !== m.id) : [];
    const hints = [];
    if (phoneIds.length) hints.push({ kind: 'phone', ids: phoneIds });
    if (nameIds.length)  hints.push({ kind: 'name',  ids: nameIds  });
    return hints.length ? { ...m, duplicateHints: hints } : m;
  });
  res.json({ members });
});

// Création d'un compte par un admin — par invitation, sans mot de passe.
// Mécanisme identique à un reset : on génère une clé d'usage unique que
// l'admin transmet de la main à la main. Le membre choisit lui-même son
// mot de passe sur reset.html en saisissant la clé. À aucun moment l'admin
// ne connaît le mot de passe.
router.post('/members', async (req, res, next) => {
  try {
    const { name, email, role, phone } = req.body || {};
    if (!name || !email) {
      return res.status(400).json({ error: 'name et email sont requis.' });
    }
    const validRoles = ['member', 'contributor', 'admin'];
    const wantedRole = validRoles.includes(role) ? role : 'member';
    const reviewerId   = (req.member && req.member.id) || 'admin-token';
    const reviewerName = (req.member && (req.member.name || req.member.email)) || 'admin';

    const member = await auth.createInvitedMember(email, name, {
      role: wantedRole,
      phone: phone || null,
      createdByAdmin: req.member ? req.member.id : null,
    });
    const { request, key } = passwordResets.createInvite({
      memberId: member.id,
      reviewerId,
      reviewerName,
    });
    activityLog.logActivity({
      memberId: reviewerId,
      action: 'member.invite',
      entityType: 'member',
      entityId: member.id,
      ip: req.ip,
    });
    // La clé en clair n'est renvoyée que sur cette réponse — l'admin doit
    // la copier maintenant. Elle reste lisible via GET /password-resets
    // tant que l'invitation est "approved".
    const dups = auth.findDuplicates({
      name: member.name,
      phone: member.phone,
      excludeId: member.id,
    });
    res.status(201).json({
      ok: true,
      member,
      key,
      expiresAt: request.expiresAt,
      message: 'Compte créé. Transmets la clé au membre — il choisira son mot de passe.',
      duplicates: {
        phone: dups.phone.map(m => ({ id: m.id, name: m.name, email: m.email })),
        name:  dups.name.map(m  => ({ id: m.id, name: m.name, email: m.email })),
      },
    });
  } catch (err) {
    if (err.message && err.message.includes('existe déjà')) {
      return res.status(409).json({ error: err.message });
    }
    if (/téléphone/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
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

// PATCH /members/:id — l'admin met à jour name, email et/ou phone.
router.patch('/members/:id', (req, res, next) => {
  try {
    const { name, email, phone } = req.body || {};
    const patch = {};
    if (name  !== undefined) patch.name  = name;
    if (email !== undefined) patch.email = email;
    if (phone !== undefined) patch.phone = phone;
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });
    }
    const member = auth.updateMember(req.params.id, patch);
    activityLog.logActivity({
      memberId: (req.member && req.member.id) || 'admin-token',
      action: 'admin.member-update',
      entityType: 'member',
      entityId: member.id,
      ip: req.ip,
    });
    res.json({ member });
  } catch (err) {
    if (err.message.includes('existe déjà')) {
      return res.status(409).json({ error: err.message });
    }
    if (/téléphone|requis|introuvable/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// ─── Demandes de réinitialisation de mot de passe ─────────────────────
// Flux 100% humain : l'admin vérifie l'identité hors-ligne (téléphone,
// en personne…) avant d'approuver. L'approbation génère une clé d'usage
// unique que l'admin transmet de la main à la main.
router.get('/password-resets', (req, res) => {
  passwordResets.purgeExpired();
  res.json({ requests: passwordResets.listAll() });
});

router.post('/password-resets/:id/approve', (req, res, next) => {
  try {
    const reviewerId = (req.member && req.member.id) || 'admin-token';
    const reviewerName = (req.member && (req.member.name || req.member.email)) || 'admin';
    const { request, key } = passwordResets.approve(req.params.id, { reviewerId, reviewerName });
    activityLog.logActivity({
      memberId: reviewerId,
      action: 'password-reset.approve',
      entityType: 'password-reset',
      entityId: request.id,
      ip: req.ip,
    });
    // La clé en clair n'est renvoyée que sur cette réponse — l'admin doit
    // la copier maintenant. (Elle reste lisible via GET /password-resets
    // tant que la demande est "approved", utile en cas de fermeture
    // d'onglet, mais on encourage à la noter immédiatement.)
    res.json({ request, key });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/password-resets/:id/reject', (req, res, next) => {
  try {
    const reviewerId = (req.member && req.member.id) || 'admin-token';
    const reviewerName = (req.member && (req.member.name || req.member.email)) || 'admin';
    const reason = (req.body && req.body.reason) || '';
    const out = passwordResets.reject(req.params.id, { reviewerId, reviewerName, reason });
    activityLog.logActivity({
      memberId: reviewerId,
      action: 'password-reset.reject',
      entityType: 'password-reset',
      entityId: out.id,
      ip: req.ip,
    });
    res.json({ request: out });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
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

// ─── Édition directe des alias ───────────────────────────────────────
// Hors file de modération : un admin peut corriger / enrichir les alias
// d'un Lieu ou d'une Personne directement (typiquement après import en
// vrac). Journalisé pour pouvoir reconstituer l'historique.
const { normAliases } = require('../schema');

function buildAliasRoute(type, store, label) {
  router.patch(`/${type}/:id/aliases`, async (req, res, next) => {
    try {
      const incoming = Array.isArray(req.body && req.body.aliases) ? req.body.aliases : null;
      if (!incoming) return res.status(400).json({ error: 'Body { aliases: [...] } requis' });
      const aliases = normAliases(incoming);
      let before = null;
      const updated = await store.patch(req.params.id, (entity) => {
        before = entity.aliases || [];
        return { aliases };
      });
      if (!updated) return res.status(404).json({ error: `${label} introuvable` });
      activityLog.logActivity({
        memberId: (req.member && req.member.id) || 'admin-token',
        action: `${type === 'places' ? 'place' : 'person'}.aliases.update`,
        entityType: type === 'places' ? 'place' : 'person',
        entityId: req.params.id,
        ip: req.ip,
        meta: { from: before, to: aliases },
      });
      res.json({ item: updated });
    } catch (err) { next(err); }
  });
}

buildAliasRoute('places', places, 'Lieu');
buildAliasRoute('people', people, 'Personne');

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
