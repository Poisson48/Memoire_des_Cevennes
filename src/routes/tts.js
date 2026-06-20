// GET /api/tts/story/:id : lit un recit a voix haute (Piper, local).
//
// Le texte synthetise est celui ADAPTE A L'AUDIENCE (les passages anonymises
// ne sont pas prononces) : on reutilise src/audience.js, comme l'API stories.
// Accessibilite : pas d'auth requise (lecture publique des recits publics),
// mais la visibilite et les redactions sont respectees.

'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const stories = require('../stories');
const audience = require('../audience');
const tts = require('../tts');

const router = express.Router();

const ttsLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Trop de demandes de lecture : patiente un instant.' },
});

router.get('/status', (_req, res) => {
  res.json({ available: tts.available() });
});

// Construit le texte a lire pour un recit, selon l'audience.
function textForStory(story, aud, part) {
  if (part && /^completion-/.test(part)) {
    const cid = part.replace(/^completion-/, '');
    const comp = (story.completions || []).find(c => c.id === cid && c.status === 'approved');
    return comp ? String(comp.body || '') : '';
  }
  const title = story.title ? story.title + '. ' : '';
  return title + audience.redactedBody(story, aud);
}

router.get('/story/:id', ttsLimiter, async (req, res, next) => {
  try {
    const aud = audience.audienceOf(req);
    const story = stories.get(req.params.id);
    if (!story || !audience.isVisible(story, aud)) {
      return res.status(404).json({ error: 'Récit introuvable' });
    }
    const text = textForStory(story, aud, req.query.part).trim();
    if (!text) return res.status(400).json({ error: 'Rien à lire.' });

    const { path: filePath, contentType } = await tts.synthesize(text);
    res.set('Cache-Control', 'public, max-age=86400');
    res.type(contentType);
    res.sendFile(filePath); // Express gere Range + 304
  } catch (e) {
    if (e.statusCode) return res.status(e.statusCode).json({ error: e.message });
    next(e);
  }
});

module.exports = router;
