// Configuration Multer pour les uploads de médias attachés aux récits.

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

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
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error(`Type de fichier non supporté : ${file.mimetype}`));
  },
});

module.exports = { upload, UPLOADS_DIR, ALLOWED_MIME };
