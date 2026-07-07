// Generation d'un livret PDF imprimable a partir des recits, filtre par tags
// (lieux / personnes / alias coches). Tout est local : rendu HTML -> PDF via
// Playwright (Chromium deja installe). Le contenu respecte l'audience
// (visibilite + anonymisation) via src/audience.js.

'use strict';

const fs = require('fs');
const path = require('path');
const stories = require('./stories');
const places = require('./places');
const people = require('./people');
const audience = require('./audience');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const MAX_STORIES = 500;          // borne de securite
const MAX_IMG_BYTES = 8 * 1024 * 1024;

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Rendu leger du corps : echappe le HTML, convertit l'emphase markdown
// simple (*italique*, **gras**) et les sauts de ligne. Reste volontairement
// minimal (le PDF n'a pas besoin des liens/mentions du site).
function renderBodyHtml(text) {
  let h = escapeHtml(text);
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  return h.replace(/\n/g, '<br>');
}

// Selectionne les recits lies a au moins un tag coche, pour l'audience donnee.
function selectStories({ placeIds = [], personIds = [] }, aud) {
  const placeSet = new Set(placeIds);
  const personSet = new Set(personIds);
  if (placeSet.size === 0 && personSet.size === 0) return [];

  const all = audience.visibleStories(stories.list({ status: 'approved' }), aud);
  const matched = all.filter(s => {
    if (placeSet.has(s.placeId)) return true;
    if (s.contributorId && personSet.has(s.contributorId)) return true;
    return (s.mentions || []).some(m =>
      (m.type === 'place' && placeSet.has(m.entityId)) ||
      (m.type === 'person' && personSet.has(m.entityId))
    );
  });
  return matched.slice(0, MAX_STORIES);
}

// Apercu : nombre et titres des recits qui seraient inclus.
function preview(selection, aud) {
  const list = selectStories(selection, aud);
  return {
    count: list.length,
    titles: list.map(s => ({
      id: s.id,
      title: s.title || '(récit sans titre)',
      placeId: s.placeId,
    })),
  };
}

function imgDataUri(url) {
  // url = "/uploads/<storyId>/<file>" -> chemin disque
  if (!/^\/uploads\//.test(url)) return null;
  const rel = url.replace(/^\/uploads\//, '');
  const file = path.join(UPLOADS_DIR, rel);
  // Anti path-traversal : le chemin resolu doit rester sous uploads/.
  if (!file.startsWith(UPLOADS_DIR + path.sep)) return null;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_IMG_BYTES) return null;
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp'
      : ext === 'gif' ? 'image/gif' : 'image/jpeg';
    return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  } catch { return null; }
}

function renderStory(story, aud, { includeImages }) {
  const placeName = (places.get(story.placeId) || {}).primaryName || '';
  const byName = (story.submittedBy && story.submittedBy.name)
    || (story.contributorId && (people.get(story.contributorId) || {}).primaryName)
    || '';
  const body = audience.redactedBody(story, aud);

  let imgs = '';
  if (includeImages) {
    for (const m of (story.mediaFiles || [])) {
      if (!/^image\//.test(m.mime || '')) continue;
      const data = imgDataUri(m.url);
      if (!data) continue;
      imgs += `<figure class="ph"><img src="${data}" alt="">` +
        (m.caption ? `<figcaption>${escapeHtml(m.caption)}</figcaption>` : '') +
        `</figure>`;
    }
  }

  return `<article class="recit">
    <h2>${escapeHtml(story.title || '(récit sans titre)')}</h2>
    ${byName ? `<p class="by">Raconté par ${escapeHtml(byName)}</p>` : ''}
    <div class="corps">${renderBodyHtml(body)}</div>
    ${imgs}
  </article>`;
}

// Construit le HTML complet du livret (page de titre + sommaire + recits
// groupes par lieu). `cssHref` est injecte tel quel (chemin/URL du CSS).
function buildHtml({ title = 'Mémoire des Cévennes', selection, aud, includeImages = true, css = '' }) {
  const list = selectStories(selection, aud);

  // Groupe par lieu, dans l'ordre des lieux.
  const byPlace = new Map();
  for (const s of list) {
    if (!byPlace.has(s.placeId)) byPlace.set(s.placeId, []);
    byPlace.get(s.placeId).push(s);
  }

  const audLabel = aud === 'admin' ? 'version administration (texte intégral)'
    : aud === 'member' ? 'version membres' : 'version publique';

  let toc = '';
  let sections = '';
  for (const [placeId, group] of byPlace) {
    const placeName = (places.get(placeId) || {}).primaryName || placeId;
    toc += `<li><strong>${escapeHtml(placeName)}</strong><ul>` +
      group.map(s => `<li>${escapeHtml(s.title || '(récit sans titre)')}</li>`).join('') +
      `</ul></li>`;
    sections += `<section class="lieu"><h1>${escapeHtml(placeName)}</h1>` +
      group.map(s => renderStory(s, aud, { includeImages })).join('') +
      `</section>`;
  }

  const dateStr = new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${css}</style></head><body>
<div class="couverture">
  <h1 class="titre">${escapeHtml(title)}</h1>
  <p class="sous-titre">Recueil de récits et de mémoire vivante</p>
  <p class="meta">${escapeHtml(audLabel)} — ${list.length} récit${list.length > 1 ? 's' : ''} — ${escapeHtml(dateStr)}</p>
</div>
<nav class="sommaire"><h1>Sommaire</h1><ol>${toc}</ol></nav>
${sections || '<p class="vide">Aucun récit ne correspond aux sujets choisis.</p>'}
</body></html>`;
}

// ── Rendu PDF via Playwright (instance partagee + verrou) ─────────────────
// Repli navigateur : apres une mise a jour de Playwright, le Chromium
// vendorise change de revision et n'est pas forcement re-telecharge (le
// binaire manque alors dans ~/.cache/ms-playwright). Plutot que de casser la
// generation de PDF, on retombe sur un Chromium systeme via executablePath.
const CHROMIUM_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  process.env.CHROMIUM_PATH,
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/snap/bin/chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
].filter(Boolean);

async function launchChromium() {
  const { chromium } = require('playwright');
  const base = { headless: true, args: ['--no-sandbox'] };
  // 1. Chromium fourni par Playwright (meilleure fidelite s'il est installe).
  try {
    return await chromium.launch(base);
  } catch (bundledErr) {
    // 2. Repli : premier Chromium systeme disponible.
    for (const executablePath of CHROMIUM_CANDIDATES) {
      try {
        if (!fs.existsSync(executablePath)) continue;
        return await chromium.launch({ ...base, executablePath });
      } catch { /* candidat suivant */ }
    }
    // Aucun repli n'a fonctionne : on remonte l'erreur d'origine (message clair).
    throw bundledErr;
  }
}

let browserPromise = null;
let chainTail = Promise.resolve(); // serialise les rendus (Chromium lourd)

async function getBrowser() {
  if (!browserPromise) browserPromise = launchChromium();
  let browser;
  try {
    browser = await browserPromise;
  } catch (e) {
    browserPromise = null; // laisse une chance a la prochaine demande
    throw e;
  }
  if (!browser.isConnected()) {
    browserPromise = launchChromium();
    browser = await browserPromise;
  }
  return browser;
}

async function renderPdf(html) {
  const run = async () => {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'networkidle', timeout: 60_000 });
      return await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: '<div style="width:100%;font-size:8px;color:#888;text-align:center;">' +
          '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      });
    } finally {
      await page.close();
    }
  };
  // Serialise : un rendu a la fois.
  const result = chainTail.then(run, run);
  chainTail = result.then(() => {}, () => {});
  return result;
}

module.exports = { selectStories, preview, buildHtml, renderPdf };
