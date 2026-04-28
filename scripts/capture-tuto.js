#!/usr/bin/env node
// Capture les vues PC et mobile de aide.html (tutoriel par rôle).
// Prérequis : le serveur tourne sur $PORT (défaut 3199 pour ne pas
// entrer en collision avec un dev en cours).
// Usage : PORT=3199 node scripts/capture-tuto.js

const { chromium } = require('playwright');
const path = require('path');

const PORT = process.env.PORT || 3199;
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');

async function shot(target, name) {
  await target.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  console.log('  ✓', `docs/screenshots/${name}.png`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ── Desktop : section "guest" (par défaut, anonyme) ──
  const ctxPc = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pagePc = await ctxPc.newPage();
  await pagePc.goto(`${BASE}/aide.html`, { waitUntil: 'networkidle' });
  await pagePc.waitForTimeout(800); // laisse charger les screenshots inline
  await shot(pagePc, '14-tutoriel-pc');
  await ctxPc.close();

  // ── Mobile : pareil ──
  const ctxMo = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const pageMo = await ctxMo.newPage();
  await pageMo.goto(`${BASE}/aide.html`, { waitUntil: 'networkidle' });
  await pageMo.waitForTimeout(800);
  await shot(pageMo, '14-tutoriel-mobile');
  await ctxMo.close();

  await browser.close();
  console.log('\nCaptures du tutoriel régénérées.');
})().catch(e => { console.error(e); process.exit(1); });
