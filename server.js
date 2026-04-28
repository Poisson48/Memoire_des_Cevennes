// Mémoire des Cévennes — serveur Express.
// Côté HTTP : rien de métier ici, tout est dans src/routes/*.

'use strict';

const express      = require('express');
const path         = require('path');
const cookieParser = require('cookie-parser');

const { UPLOADS_DIR } = require('./src/upload');
const { errorHandler, optionalAuth } = require('./src/middleware');
const backup = require('./src/backup');

const meta          = require('./src/routes/meta');
const authRouter    = require('./src/routes/auth');
const placesRouter  = require('./src/routes/places');
const peopleRouter  = require('./src/routes/people');
const storiesRouter = require('./src/routes/stories');
const editsRouter   = require('./src/routes/edits');
const adminRouter   = require('./src/routes/admin');
const reportsRouter = require('./src/routes/reports');

const PORT       = Number(process.env.PORT) || 3003;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR   = path.join(__dirname, 'data');

const app = express();

// En prod, on sera derrière Caddy ou un autre reverse proxy. Sans cette
// ligne, req.ip = "127.0.0.1" pour toutes les requêtes → le rate-limiter
// verrouille tout le monde dès qu'une IP attaque. Sécurité par défaut :
// on ne fait confiance qu'à 1 hop (le proxy direct), pas à toute la chaîne.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Parseur de cookies — nécessaire pour lire le cookie JWT "token".
app.use(cookieParser());

// Peuple req.member sur toutes les routes (null si non connecté).
// Les middlewares de route peuvent ensuite exiger requireAuth(minRole).
app.use(optionalAuth);

// API — authentification membres (routes publiques)
app.use('/api/auth', authRouter);

// API — méta
app.use('/api', meta);

// API — entités (visibilité filtrée par req.member dans chaque router)
app.use('/api/places',  placesRouter);
app.use('/api/people',  peopleRouter);
app.use('/api/stories', storiesRouter);
app.use('/api', editsRouter);         // /api/:type/:id/edits
app.use('/api/reports', reportsRouter);

// API — administration (X-Admin-Token OU JWT admin via requireAdmin)
app.use('/api/admin',   adminRouter);

// Statique
app.use('/uploads', express.static(UPLOADS_DIR, { fallthrough: true }));
// Expose data/ pour cohérence avec le mode statique (GitHub Pages) — le
// frontend peut faire un fallback sur /data/*.json en statique.
app.use('/data', express.static(DATA_DIR));
app.use(express.static(PUBLIC_DIR));

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`▸ Mémoire des Cévennes — http://localhost:${PORT}`);
  if (!process.env.ADMIN_TOKEN) {
    console.log('  (ADMIN_TOKEN non défini — file de modération inaccessible)');
  }
  if (!process.env.JWT_SECRET) {
    console.log('  ⚠  JWT_SECRET non défini — authentification membres désactivée.');
  }

  // Sauvegardes automatiques périodiques (désactivé si l'env n'est pas mis).
  const autoH = parseFloat(process.env.BACKUP_AUTO_INTERVAL_HOURS || '');
  const autoKeep = parseInt(process.env.BACKUP_AUTO_KEEP || '14', 10);
  const preKeep  = parseInt(process.env.BACKUP_AUTO_PRE_RESTORE_KEEP || '10', 10);
  if (Number.isFinite(autoH) && autoH > 0) {
    backup.startAutoBackups({
      intervalHours: autoH,
      keep: Number.isFinite(autoKeep) ? autoKeep : 14,
      preRestoreKeep: Number.isFinite(preKeep) ? preKeep : 10,
    });
  }
  if (!backup.encryptionEnabled()) {
    console.log('  (BACKUP_PASSPHRASE non défini — backups en clair)');
  } else {
    console.log('  Backups chiffrés (AES-256-GCM, scrypt) — ne perds pas BACKUP_PASSPHRASE !');
  }
});
