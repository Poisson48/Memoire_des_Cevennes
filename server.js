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
const visitsRouter  = require('./src/routes/visits');

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
app.use('/api/visits',  visitsRouter);

// API — administration (X-Admin-Token OU JWT admin via requireAdmin)
app.use('/api/admin',   adminRouter);

// SEO : sitemap.xml dynamique. Listé à la racine pour que les robots qui
// lisent robots.txt y trouvent les URLs canoniques. Pour l'instant
// minimaliste (home + tutoriel) ; l'étape suivante du plan SEO ajoutera
// les URLs entité (/lieu/:slug, /recit/:slug, /personne/:slug) une fois
// que ces routes existeront côté serveur avec meta tags pré-rendus.
app.get('/sitemap.xml', (req, res) => {
  const fs = require('fs');
  const SITE = 'https://memoires-cevenoles.poisson48.fr';
  // lastmod calé sur la dernière modif de public/index.html : reflète
  // la date du dernier déploiement (changements de meta, structure…)
  // sans mentir avec une date « maintenant ».
  let lastmod;
  try {
    lastmod = fs.statSync(path.join(PUBLIC_DIR, 'index.html')).mtime
      .toISOString().slice(0, 10);
  } catch {
    lastmod = new Date().toISOString().slice(0, 10);
  }
  const urls = [
    { loc: `${SITE}/`,           changefreq: 'weekly',  priority: '1.0' },
    { loc: `${SITE}/aide.html`,  changefreq: 'monthly', priority: '0.5' },
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u =>
      `  <url>\n` +
      `    <loc>${u.loc}</loc>\n` +
      `    <lastmod>${lastmod}</lastmod>\n` +
      `    <changefreq>${u.changefreq}</changefreq>\n` +
      `    <priority>${u.priority}</priority>\n` +
      `  </url>`
    ).join('\n') +
    `\n</urlset>\n`;
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.send(xml);
});

// Statique
app.use('/uploads', express.static(UPLOADS_DIR, { fallthrough: true }));
// Expose data/ pour cohérence avec le mode statique (GitHub Pages) — le
// frontend peut faire un fallback sur /data/*.json en statique.
app.use('/data', express.static(DATA_DIR));
// Captures d'écran utilisées par la page tutoriel (aide.html). Servies
// depuis docs/ pour rester la source unique (régénérées par
// scripts/screenshots.js).
app.use('/screenshots', express.static(path.join(__dirname, 'docs', 'screenshots')));
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
