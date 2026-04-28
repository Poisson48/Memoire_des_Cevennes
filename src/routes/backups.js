'use strict';

// Routes admin pour les sauvegardes / exports / imports.
// Toutes ces routes sont déjà protégées par requireAdmin appliqué sur le
// router parent (src/routes/admin.js), pas besoin de re-protéger ici.

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const multer  = require('multer');

const backup = require('../backup');
const activityLog = require('../activityLog');

const router = express.Router();

// Multer : on stocke l'archive uploadée dans os.tmpdir() puis on la
// passe à backup.importArchive() qui se charge des vérifs.
// Limite 1 Go — au-dessus, l'admin doit faire ça en CLI directement.
const importUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) => {
      const ext = file.originalname.endsWith('.tar.gz') ? '.tar.gz' : '.upload';
      cb(null, `mdc-import-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GiB
});

function reviewerFromReq(req) {
  if (req.member && (req.member.name || req.member.email)) {
    return req.member.name || req.member.email;
  }
  if (req.body && req.body.reviewer) return String(req.body.reviewer).slice(0, 80);
  return 'admin';
}

function logAdminAction(req, action, entityId) {
  try {
    activityLog.logActivity({
      memberId: (req.member && req.member.id) || 'admin-token',
      action,
      entityType: 'backup',
      entityId: entityId || '-',
      ip: req.ip,
    });
  } catch { /* ne bloque jamais l'opération */ }
}

// ─── Liste ────────────────────────────────────────────────────────────
router.get('/', async (_req, res, next) => {
  try {
    const items = await backup.listBackups();
    res.json({
      schemaVersion: backup.SCHEMA_VERSION,
      encryptionEnabled: backup.encryptionEnabled(),
      backups: items.map(b => ({
        id: b.id,
        sizeBytes: b.sizeBytes,
        encrypted: b.encrypted,
        manifest: b.manifest,
      })),
    });
  } catch (err) { next(err); }
});

// ─── Stats stockage ───────────────────────────────────────────────────
// Monté à part comme /api/admin/storage par admin.js — dispo aussi ici
// sous /api/admin/backups/_storage pour compat.
router.get('/_storage', async (_req, res, next) => {
  try { res.json(await backup.getStorageStats()); }
  catch (err) { next(err); }
});

// ─── Création ─────────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { label, note } = req.body || {};
    const out = await backup.createBackup({
      kind: 'manual',
      label: label ? String(label).slice(0, 200) : '',
      note: note ? String(note).slice(0, 2000) : '',
      createdBy: reviewerFromReq(req),
    });
    logAdminAction(req, 'backup.create', out.id);
    res.status(201).json({
      id: out.id,
      sizeBytes: out.sizeBytes,
      manifest: out.manifest,
    });
  } catch (err) { next(err); }
});

// ─── Détail (manifest seul) ───────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const b = await backup.getBackup(req.params.id);
    if (!b) return res.status(404).json({ error: 'Backup introuvable' });
    res.json({ id: b.id, sizeBytes: b.sizeBytes, manifest: b.manifest });
  } catch (err) { next(err); }
});

// ─── Téléchargement de l'archive ──────────────────────────────────────
router.get('/:id/download', async (req, res, next) => {
  try {
    const b = await backup.getBackup(req.params.id);
    if (!b) return res.status(404).json({ error: 'Backup introuvable' });
    logAdminAction(req, 'backup.download', b.id);
    const ext = b.encrypted ? '.tar.gz.enc' : '.tar.gz';
    res.download(b.path, `${b.id}${ext}`);
  } catch (err) { next(err); }
});

// ─── Restauration ─────────────────────────────────────────────────────
router.post('/:id/restore', async (req, res, next) => {
  try {
    const out = await backup.restoreBackup(req.params.id, {
      reviewer: reviewerFromReq(req),
    });
    logAdminAction(req, 'backup.restore', req.params.id);
    res.json({
      ok: true,
      restored: out.manifest,
      preRestore: out.preRestore && {
        id: out.preRestore.id,
        sizeBytes: out.preRestore.sizeBytes,
        manifest: out.preRestore.manifest,
      },
    });
  } catch (err) { next(err); }
});

// ─── Suppression ──────────────────────────────────────────────────────
router.delete('/:id', (req, res, next) => {
  try {
    const ok = backup.deleteBackup(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Backup introuvable' });
    logAdminAction(req, 'backup.delete', req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

// ─── Export direct (route séparée, montée à part) ────────────────────
// Crée une nouvelle archive marquée kind="export" puis la pousse en
// download. Pratique pour migrer le site vers un autre serveur en une
// seule action. L'archive reste dans backups/ pour audit.
const exportRouter = express.Router();
exportRouter.get('/', async (req, res, next) => {
  try {
    const out = await backup.createBackup({
      kind: 'export',
      label: 'Export complet',
      createdBy: reviewerFromReq(req),
    });
    logAdminAction(req, 'backup.export', out.id);
    const ext = backup.encryptionEnabled() ? '.tar.gz.enc' : '.tar.gz';
    res.download(out.path, `${out.id}${ext}`);
  } catch (err) { next(err); }
});
module.exports.exportRouter = exportRouter;

// ─── Import (upload d'une archive) ────────────────────────────────────
const importRouter = express.Router();
importRouter.post('/', importUpload.single('archive'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'Champ "archive" manquant (multipart/form-data).' });
  const tmpPath = req.file.path;
  try {
    const out = await backup.importArchive(tmpPath, {
      reviewer: reviewerFromReq(req),
    });
    logAdminAction(req, 'backup.import', out.importedAs);
    res.json({
      ok: true,
      restored: out.manifest,
      importedAs: out.importedAs,
      preRestore: out.preRestore && {
        id: out.preRestore.id,
        sizeBytes: out.preRestore.sizeBytes,
        manifest: out.preRestore.manifest,
      },
    });
  } catch (err) {
    next(err);
  } finally {
    // L'archive uploadée a été (au choix) copiée dans backups/ par
    // importArchive(), ou l'import a échoué. Dans les deux cas on peut
    // virer le tempfile.
    fs.promises.unlink(tmpPath).catch(() => {});
  }
});
module.exports.importRouter = importRouter;
