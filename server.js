// Mémoire des Cévennes — serveur Express.
// Côté HTTP : rien de métier ici, tout est dans src/routes/*.

const express = require('express');
const path = require('path');

const { UPLOADS_DIR } = require('./src/upload');
const { errorHandler } = require('./src/middleware');

const meta = require('./src/routes/meta');
const placesRouter = require('./src/routes/places');
const peopleRouter = require('./src/routes/people');
const storiesRouter = require('./src/routes/stories');
const editsRouter = require('./src/routes/edits');
const adminRouter = require('./src/routes/admin');

const PORT = Number(process.env.PORT) || 3003;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// API
app.use('/api', meta);
app.use('/api/places',  placesRouter);
app.use('/api/people',  peopleRouter);
app.use('/api/stories', storiesRouter);
app.use('/api', editsRouter);         // /api/:type/:id/edits
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
});
