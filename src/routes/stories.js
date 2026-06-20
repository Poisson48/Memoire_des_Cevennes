// Routes /api/stories/* + upload de média attaché à un récit.
const express = require('express');
const path = require('path');
const stories = require('../stories');
const { upload } = require('../upload');
const { resolveContributor } = require('../contributor');
const { requireAuth } = require('../middleware');
const { logActivity } = require('../activityLog');
const audioNorm = require('../audio-normalize');
const audience = require('../audience');
const { normRedactions } = require('../schema');

const router = express.Router();

router.get('/', (req, res) => {
  const status = req.query.status === 'all' ? 'all' : 'approved';
  let list = stories.list({
    status,
    placeId: req.query.placeId,
    personId: req.query.personId,
  });
  // Filtre visibilité : visiteurs non connectés → entrées "public" uniquement.
  if (!req.member) {
    list = list.filter(s => s.visibility === 'public');
  }
  // Anonymisation/censure : masque les passages selon l'audience.
  const aud = audience.audienceOf(req);
  list = list.map(s => audience.viewStory(s, aud));
  res.json({ stories: list });
});

router.get('/:id', (req, res) => {
  const story = stories.get(req.params.id);
  if (!story) return res.status(404).json({ error: 'Récit introuvable' });
  if (story.status !== 'approved' && req.query.preview !== '1') {
    return res.status(404).json({ error: 'Récit introuvable (en attente)' });
  }
  // Filtre visibilité : masquer les entrées "members" aux visiteurs non connectés.
  if (!req.member && story.visibility !== 'public') {
    return res.status(404).json({ error: 'Récit introuvable' });
  }
  res.json({ story: audience.viewStory(story, audience.audienceOf(req)) });
});

router.post('/', requireAuth('member'), async (req, res, next) => {
  try {
    if (req.body.consentGiven !== true) {
      return res.status(400).json({ error: 'consentement requis' });
    }
    if (!req.body || !req.body.placeId) {
      return res.status(400).json({ error: 'placeId requis' });
    }
    const payload = { ...req.body };
    payload.submittedBy = await resolveContributor({
      submittedBy: req.body.submittedBy,
      newPerson: req.body.newPerson,
    });
    // Le conteur DOIT être identifié : soit par autocomplétion (personId
    // existant), soit par création auto via newPerson.confirmCreate. Si on
    // arrive ici sans personId, c'est que le formulaire n'a pas envoyé de
    // nom ou que la création a échoué : on refuse plutôt que stocker un
    // nom orphelin.
    if (!payload.submittedBy || !payload.submittedBy.personId) {
      return res.status(400).json({
        error: 'Le conteur doit être identifié (nom requis pour publier).',
      });
    }
    payload.contributorId = payload.submittedBy.personId;
    // collectedBy : qui a recueilli ce récit (membre connecté). Distinct
    // du conteur : un membre peut publier la mémoire d'un petit vieux du
    // village qui n'a pas de compte.
    payload.collectedBy = req.member.id;
    const story = await stories.create(payload);
    logActivity({
      memberId: req.member.id,
      action: 'create',
      entityType: 'story',
      entityId: story.id,
      ip: req.ip,
    });
    res.status(201).json({ story, message: 'Ajout reçu : en attente de validation.' });
  } catch (err) { next(err); }
});

// Compléter une histoire existante : n'importe qui peut ajouter un
// chapitre qui vient s'attacher au récit. La complétion tombe en
// pending, l'admin valide.
router.post('/:id/completions', requireAuth('member'), async (req, res, next) => {
  try {
    if (req.body.consentGiven !== true) {
      return res.status(400).json({ error: 'consentement requis' });
    }
    const body = (req.body && req.body.body) || '';
    if (!String(body).trim()) {
      return res.status(400).json({ error: 'Le champ body est requis.' });
    }
    const submittedBy = await resolveContributor({
      submittedBy: req.body && req.body.submittedBy,
      newPerson: req.body && req.body.newPerson,
    });
    const completion = await stories.addCompletion(req.params.id, { body, submittedBy });
    if (!completion) return res.status(404).json({ error: 'Récit introuvable' });
    logActivity({
      memberId: req.member.id,
      action: 'create',
      entityType: 'completion',
      entityId: req.params.id,
      ip: req.ip,
    });
    res.status(201).json({
      completion,
      message: 'Complétion reçue : en attente de validation admin.',
    });
  } catch (err) { next(err); }
});

// Upload d'un ou plusieurs médias rattachés à un récit existant.
router.post('/:id/media', requireAuth('member'), (req, res, next) => {
  upload.array('media', 10)(req, res, async (err) => {
    if (err) return next(err);
    try {
      const story = stories.get(req.params.id);
      if (!story) return res.status(404).json({ error: 'Récit introuvable' });

      // Normalise le gain audio des fichiers audio/vidéo via ffmpeg avant
      // d'enregistrer le média dans le récit. Skip silencieux si ffmpeg
      // n'est pas dispo ou si le mime n'est pas concerné.
      for (const f of (req.files || [])) {
        if (audioNorm.isAudio(f.mimetype) || audioNorm.isVideo(f.mimetype)) {
          const r = await audioNorm.normalize(f.path, f.mimetype);
          if (r.ok) console.log(`[audio-normalize] ${path.basename(f.path)} normalisé`);
        }
      }

      // Légendes : multer expose req.body.captions comme tableau (ou string
      // unique si un seul champ). On normalise en tableau et on associe
      // par index aux fichiers.
      const rawCaptions = req.body && req.body.captions;
      const captions = Array.isArray(rawCaptions)
        ? rawCaptions
        : (rawCaptions ? [rawCaptions] : []);

      // Texte OCR relu par le contributeur, associe par index aux fichiers.
      const rawOcr = req.body && req.body.ocrText;
      const ocrTexts = Array.isArray(rawOcr)
        ? rawOcr
        : (rawOcr ? [rawOcr] : []);

      const files = (req.files || []).map((f, i) => {
        const out = {
          url: `/uploads/${req.params.id}/${f.filename}`,
          mime: f.mimetype,
        };
        const cap = captions[i] && String(captions[i]).trim().slice(0, 500);
        if (cap) out.caption = cap;
        const ocrText = ocrTexts[i] && String(ocrTexts[i]).trim().slice(0, 30000);
        if (ocrText) out.ocrText = ocrText;
        return out;
      });
      const updated = await stories.patch(req.params.id, (s) => ({
        mediaFiles: [...(s.mediaFiles || []), ...files],
      }));
      logActivity({
        memberId: req.member.id,
        action: 'create',
        entityType: 'media',
        entityId: req.params.id,
        ip: req.ip,
      });
      res.json({ story: updated, added: files });
    } catch (e) { next(e); }
  });
});

// ── Redactions de confidentialite (anonymiser / censurer) ────────────────
// Un membre marque un passage du body a masquer pour le public (et/ou les
// membres). Effet immediat (proteger la vie privee ne doit pas attendre la
// file de moderation). Le retrait d'une redaction (re-divulgation) est plus
// sensible : reserve aux admins.

router.post('/:id/redactions', requireAuth('member'), async (req, res, next) => {
  try {
    const story = stories.get(req.params.id);
    if (!story) return res.status(404).json({ error: 'Récit introuvable' });
    const candidate = {
      start: req.body && req.body.start,
      end: req.body && req.body.end,
      mode: req.body && req.body.mode,
      hideBelow: req.body && req.body.hideBelow,
      replacement: req.body && req.body.replacement,
      reason: req.body && req.body.reason,
      by: (req.member && req.member.name) || 'membre',
    };
    const [clean] = normRedactions([candidate], (story.body || '').length);
    if (!clean) {
      return res.status(400).json({ error: 'Sélection invalide (bornes hors du texte ou vides).' });
    }
    // Garde-fou d'integrite : la portion ciblee doit correspondre au texte
    // que le client a selectionne. Evite de masquer le mauvais passage si le
    // body a change (ou si l'affichage cote client differait du stocke).
    if (typeof req.body.text === 'string') {
      const slice = (story.body || '').slice(clean.start, clean.end);
      if (slice !== req.body.text) {
        return res.status(409).json({
          error: 'La sélection ne correspond plus au texte du récit. Recharge la page et réessaie.',
        });
      }
    }
    const updated = await stories.patch(req.params.id, (s) => ({
      redactions: [...(s.redactions || []), clean].sort((a, b) => a.start - b.start),
    }));
    logActivity({
      memberId: req.member.id,
      action: 'redact',
      entityType: 'story',
      entityId: req.params.id,
      ip: req.ip,
    });
    res.status(201).json({ redaction: clean, story: updated });
  } catch (err) { next(err); }
});

router.delete('/:id/redactions/:rid', requireAuth('admin'), async (req, res, next) => {
  try {
    const story = stories.get(req.params.id);
    if (!story) return res.status(404).json({ error: 'Récit introuvable' });
    const before = (story.redactions || []).length;
    const updated = await stories.patch(req.params.id, (s) => ({
      redactions: (s.redactions || []).filter(r => r.id !== req.params.rid),
    }));
    if (!updated || (updated.redactions || []).length === before) {
      return res.status(404).json({ error: 'Redaction introuvable' });
    }
    logActivity({
      memberId: req.member.id,
      action: 'unredact',
      entityType: 'story',
      entityId: req.params.id,
      ip: req.ip,
    });
    res.json({ story: updated });
  } catch (err) { next(err); }
});

module.exports = router;
