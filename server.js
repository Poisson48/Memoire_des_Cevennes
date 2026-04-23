const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

const places = require('./src/places');
const people = require('./src/people');
const stories = require('./src/stories');
const moderation = require('./src/moderation');
const { resolve } = require('./src/resolve');

const PORT = Number(process.env.PORT) || 3003;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOADS_DIR = path.join(ROOT, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ── Uploads ────────────────────────────────────────────────────────────
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/x-m4a',
  'video/mp4', 'video/webm', 'video/quicktime',
  'application/pdf',
]);

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const placeId = req.params.id || 'misc';
    const dir = path.join(UPLOADS_DIR, placeId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}${ext.toLowerCase()}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 Mo (audio long, vidéo courte)
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error(`Type de fichier non supporté : ${file.mimetype}`));
  },
});

// ── Auth admin ─────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({
      error: 'Aucun ADMIN_TOKEN configuré côté serveur — définir ADMIN_TOKEN=… avant de lancer.',
    });
  }
  const header = req.header('x-admin-token') || '';
  const cookie = (req.header('cookie') || '')
    .split(';').map(s => s.trim()).find(s => s.startsWith('admin_token='));
  const cookieToken = cookie ? decodeURIComponent(cookie.slice('admin_token='.length)) : '';
  if (header !== ADMIN_TOKEN && cookieToken !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Token admin invalide' });
  }
  next();
}

// ── Meta ───────────────────────────────────────────────────────────────
app.get('/api/version', (_req, res) => {
  const pkg = require('./package.json');
  res.json({ name: pkg.name, version: pkg.version });
});

app.get('/api/resolve', (req, res) => {
  const q = String(req.query.q || '');
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
  res.json({ results: resolve(q, { limit }) });
});

// ── Places ─────────────────────────────────────────────────────────────
app.get('/api/places', (req, res) => {
  const status = req.query.status === 'all' ? 'all' : 'approved';
  res.json({ places: places.list({ status }) });
});

app.get('/api/places/:id', (req, res) => {
  const place = places.get(req.params.id);
  if (!place) return res.status(404).json({ error: 'Lieu introuvable' });
  if (place.status !== 'approved' && req.query.preview !== '1') {
    return res.status(404).json({ error: 'Lieu introuvable (en attente)' });
  }
  res.json({ place });
});

app.post('/api/places', async (req, res, next) => {
  try {
    const place = await places.create(req.body || {});
    res.status(201).json({ place, message: 'Ajout reçu — en attente de validation.' });
  } catch (err) { next(err); }
});

// ── People ─────────────────────────────────────────────────────────────
app.get('/api/people', (req, res) => {
  const status = req.query.status === 'all' ? 'all' : 'approved';
  res.json({ people: people.list({ status }) });
});

app.get('/api/people/:id', (req, res) => {
  const person = people.get(req.params.id);
  if (!person) return res.status(404).json({ error: 'Personne introuvable' });
  if (person.status !== 'approved' && req.query.preview !== '1') {
    return res.status(404).json({ error: 'Personne introuvable (en attente)' });
  }
  res.json({
    person,
    children: people.childrenOf(person.id),
    siblings: people.siblingsOf(person.id),
  });
});

app.post('/api/people', async (req, res, next) => {
  try {
    const person = await people.create(req.body || {});
    res.status(201).json({ person, message: 'Ajout reçu — en attente de validation.' });
  } catch (err) { next(err); }
});

// ── Stories ────────────────────────────────────────────────────────────
app.get('/api/stories', (req, res) => {
  const status = req.query.status === 'all' ? 'all' : 'approved';
  res.json({
    stories: stories.list({
      status,
      placeId: req.query.placeId,
      personId: req.query.personId,
    }),
  });
});

app.get('/api/stories/:id', (req, res) => {
  const story = stories.get(req.params.id);
  if (!story) return res.status(404).json({ error: 'Récit introuvable' });
  if (story.status !== 'approved' && req.query.preview !== '1') {
    return res.status(404).json({ error: 'Récit introuvable (en attente)' });
  }
  res.json({ story });
});

app.post('/api/stories', async (req, res, next) => {
  try {
    if (!req.body || !req.body.placeId) {
      return res.status(400).json({ error: 'placeId requis' });
    }
    const story = await stories.create(req.body);
    res.status(201).json({ story, message: 'Ajout reçu — en attente de validation.' });
  } catch (err) { next(err); }
});

// Upload d'un média pour un récit (en deux temps : client POST story → obtient id
// → POST media avec storyId ; ou tout dans un seul multipart selon l'UI).
// Ici endpoint simple multipart multiFiles pour un récit existant.
app.post('/api/stories/:id/media', (req, res, next) => {
  req.params.id = req.params.id;
  upload.array('media', 10)(req, res, async (err) => {
    if (err) return next(err);
    try {
      const story = stories.get(req.params.id);
      if (!story) return res.status(404).json({ error: 'Récit introuvable' });
      const files = (req.files || []).map(f => ({
        url: `/uploads/${req.params.id}/${f.filename}`,
        mime: f.mimetype,
      }));
      const updated = await stories.patch(req.params.id, (s) => ({
        mediaFiles: [...(s.mediaFiles || []), ...files],
      }));
      res.json({ story: updated, added: files });
    } catch (e) { next(e); }
  });
});

// ── Admin (modération) ─────────────────────────────────────────────────
app.get('/api/admin/queue', requireAdmin, (req, res) => {
  const type = req.query.type;
  res.json({ queue: moderation.queue({ type }), counts: moderation.counts() });
});

app.post('/api/admin/:type/:id/approve', requireAdmin, async (req, res, next) => {
  try {
    const reviewer = req.body && req.body.reviewer ? String(req.body.reviewer) : 'admin';
    const updated = await moderation.approve(req.params.type, req.params.id, { reviewer });
    if (!updated) return res.status(404).json({ error: 'Entité introuvable' });
    res.json({ item: updated });
  } catch (err) { next(err); }
});

app.post('/api/admin/:type/:id/reject', requireAdmin, async (req, res, next) => {
  try {
    const reviewer = req.body && req.body.reviewer ? String(req.body.reviewer) : 'admin';
    const reason = (req.body && req.body.reason) || '';
    const updated = await moderation.reject(req.params.type, req.params.id, { reviewer, reason });
    if (!updated) return res.status(404).json({ error: 'Entité introuvable' });
    res.json({ item: updated });
  } catch (err) { next(err); }
});

// ── Static ─────────────────────────────────────────────────────────────
app.use('/uploads', express.static(UPLOADS_DIR, { fallthrough: true }));
// Expose data/ en lecture (utile pour GH Pages, où le frontend charge
// data/places.json en statique ; ici pour rester cohérent en dev server).
app.use('/data', express.static(DATA_DIR));
app.use(express.static(PUBLIC_DIR));

// ── Error handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[err]', err.message);
  const status = err.status || 400;
  res.status(status).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`▸ Mémoire des Cévennes — http://localhost:${PORT}`);
  if (!ADMIN_TOKEN) {
    console.log('  (ADMIN_TOKEN non défini — file de modération inaccessible)');
  }
});
