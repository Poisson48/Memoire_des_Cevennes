#!/usr/bin/env node
// Capture les vues principales de l'app pour le README.
// Prérequis : le serveur tourne sur $PORT (défaut 3003).
// Usage : PORT=3109 node scripts/screenshots.js

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3003;
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

// Les tuiles OSM mettent quelques secondes à charger — on attend un peu.
async function settleMap(page) {
  await page.waitForSelector('.leaflet-marker-icon', { timeout: 10000 });
  await page.waitForTimeout(1200);
}

async function shot(target, name) {
  const file = path.join(OUT, `${name}.png`);
  await target.screenshot({ path: file });
  console.log('  ✓', path.relative(process.cwd(), file));
}

async function runDesktop(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('  [console.error]', msg.text());
  });
  page.on('pageerror', err => console.log('  [pageerror]', err.message));

  console.log('— Desktop —');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await settleMap(page);
  await shot(page, '01-map-desktop');

  // 1. Cliquer le marqueur Mas de la Coste (2e marqueur attendu)
  const markers = await page.$$('.leaflet-marker-icon');
  // Tente de repérer par tooltip / title attribute
  let masMarker = null;
  for (const m of markers) {
    const title = await m.getAttribute('title');
    if (title && title.toLowerCase().includes('coste')) { masMarker = m; break; }
  }
  if (!masMarker && markers.length >= 2) masMarker = markers[1];
  if (masMarker) {
    await masMarker.click();
    await page.waitForTimeout(600);
    await shot(page, '02-place-panel-desktop');
  }

  // 2. Naviguer directement sur la fiche Suzanne (la plus riche de nos
  //    exemples : alias, parents, grands-parents dérivés, enfants…)
  await page.evaluate(() => { location.hash = '#/personne/suzanne-duval'; });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const tree = document.getElementById('tree-mini');
    if (tree) tree.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(300);
  await shot(page, '03-person-panel-tree-desktop');

  // 3. Arbre plein écran centré sur Suzanne (3 générations visibles)
  await page.evaluate(() => { location.hash = '#/arbre/suzanne-duval'; });
  await page.waitForTimeout(800);
  await shot(page, '04-full-tree-desktop');

  await ctx.close();
}

async function runMobile(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 14-ish
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();

  console.log('— Mobile —');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await settleMap(page);
  await shot(page, '05-map-mobile');

  // Ouvre Mas de la Coste
  const markers = await page.$$('.leaflet-marker-icon');
  let masMarker = null;
  for (const m of markers) {
    const title = await m.getAttribute('title');
    if (title && title.toLowerCase().includes('coste')) { masMarker = m; break; }
  }
  if (!masMarker && markers.length >= 2) masMarker = markers[1];
  if (masMarker) {
    await masMarker.click();
    await page.waitForTimeout(800);
    await shot(page, '06-place-panel-mobile');
  }

  // Suzanne
  await page.evaluate(() => { location.hash = '#/personne/suzanne-duval'; });
  await page.waitForTimeout(700);
  await shot(page, '07-person-panel-mobile');

  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await runDesktop(browser);
    await runMobile(browser);
  } finally {
    await browser.close();
  }
  console.log('\nScreenshots dans', path.relative(process.cwd(), OUT));
})().catch(e => { console.error(e); process.exit(1); });
