const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

const dataManager = require('./src/data-manager');

const PORT = Number(process.env.PORT) || 3003;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOADS_DIR = path.join(ROOT, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/x-m4a',
  'application/pdf',
]);

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const placeId = req.params.id;
    const dir = path.join(UPLOADS_DIR, placeId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const safe = `${Date.now()}-${randomUUID().slice(0, 8)}${ext.toLowerCase()}`;
    cb(null, safe);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error(`Type de fichier non supporté : ${file.mimetype}`));
  },
});

app.get('/api/version', (_req, res) => {
  const pkg = require('./package.json');
  res.json({ name: pkg.name, version: pkg.version });
});

app.get('/api/places', (_req, res) => {
  res.json({ places: dataManager.getPlaces() });
});

app.get('/api/places/:id', (req, res) => {
  const place = dataManager.getPlace(req.params.id);
  if (!place) return res.status(404).json({ error: 'Lieu introuvable' });
  res.json({ place });
});

app.post('/api/places', (req, res) => {
  const { title, description, lat, lng } = req.body || {};
  if (typeof lat === 'undefined' || typeof lng === 'undefined') {
    return res.status(400).json({ error: 'lat et lng sont requis' });
  }
  const latN = Number(lat);
  const lngN = Number(lng);
  if (!Number.isFinite(latN) || !Number.isFinite(lngN)) {
    return res.status(400).json({ error: 'lat/lng invalides' });
  }
  const place = dataManager.addPlace({ title, description, lat: latN, lng: lngN });
  res.status(201).json({ place });
});

app.post('/api/places/:id/stories', upload.single('media'), (req, res) => {
  const place = dataManager.getPlace(req.params.id);
  if (!place) return res.status(404).json({ error: 'Lieu introuvable' });

  const type = String(req.body.type || 'text').toLowerCase();
  const allowedTypes = new Set(['text', 'photo', 'audio', 'drawing', 'note']);
  if (!allowedTypes.has(type)) {
    return res.status(400).json({ error: `Type invalide : ${type}` });
  }

  let mediaUrl = null;
  let mediaMime = null;
  if (req.file) {
    mediaUrl = `/uploads/${req.params.id}/${req.file.filename}`;
    mediaMime = req.file.mimetype;
  }

  const story = dataManager.addStory(req.params.id, {
    type,
    title: req.body.title,
    author: req.body.author,
    body: req.body.body,
    mediaUrl,
    mediaMime,
  });
  res.status(201).json({ story });
});

app.use('/uploads', express.static(UPLOADS_DIR, { fallthrough: true }));
app.use(express.static(PUBLIC_DIR));

app.use((err, _req, res, _next) => {
  console.error('[err]', err.message);
  const status = err.status || 400;
  res.status(status).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`▸ Mémoire des Cévennes — http://localhost:${PORT}`);
});
