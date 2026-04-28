#!/usr/bin/env node
// Capture les vues PC et mobile du sélecteur de couches (cartes anciennes,
// cadastre) ouvert sur la carte d'État-Major.
// Usage : PORT=3199 node scripts/capture-couches.js
//   (le port doit pointer sur un serveur de dev en cours)

const { chromium } = require('playwright');
const path = require('path');

const PORT = process.env.PORT || 3199;
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');

async function shoot(page, base) {
  // Ouvre le panneau Couches.
  await page.click('.map-layers-toggle');
  await page.waitForTimeout(150);
  // Bascule sur la carte d'État-Major (lisible et caractéristique).
  await page.click(`.map-layers-timeline button[data-base="${base}"]`);
  // Laisse charger les tuiles IGN.
  await page.waitForTimeout(3500);
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ── PC ──
  const ctxPc = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pagePc = await ctxPc.newPage();
  await pagePc.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await pagePc.waitForTimeout(600);
  await shoot(pagePc, 'etatmajor');
  await pagePc.screenshot({ path: path.join(OUT, '15-couches-pc.png'), fullPage: false });
  console.log('  ✓ docs/screenshots/15-couches-pc.png');
  await ctxPc.close();

  // ── Mobile ──
  const ctxMo = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const pageMo = await ctxMo.newPage();
  await pageMo.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await pageMo.waitForTimeout(600);
  await shoot(pageMo, 'etatmajor');
  await pageMo.screenshot({ path: path.join(OUT, '15-couches-mobile.png'), fullPage: false });
  console.log('  ✓ docs/screenshots/15-couches-mobile.png');
  await ctxMo.close();

  await browser.close();
})();
