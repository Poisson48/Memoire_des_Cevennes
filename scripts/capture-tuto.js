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

// Pré-remplit le formulaire reset avec une clé bidon pour que les captures
// soient pédagogiquement parlantes (sans soumettre, juste pour montrer
// l'aspect rempli).
async function fillResetSample(page) {
  await page.fill('input[name="key"]', 'ABCD-EFGH-JKMN');
  await page.fill('input[name="password"]', 'monMotDePasse');
  await page.fill('input[name="password2"]', 'monMotDePasse');
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ── Desktop : tutoriel ──
  const ctxPc = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pagePc = await ctxPc.newPage();
  await pagePc.goto(`${BASE}/aide.html`, { waitUntil: 'networkidle' });
  await pagePc.waitForTimeout(800);
  await shot(pagePc, '14-tutoriel-pc');

  // ── Desktop : page reset (active ton compte) ──
  await pagePc.goto(`${BASE}/reset.html`, { waitUntil: 'networkidle' });
  await fillResetSample(pagePc);
  await pagePc.waitForTimeout(300);
  await shot(pagePc, '15-reset-cle-pc');
  await ctxPc.close();

  // ── Mobile : tutoriel ──
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

  // ── Mobile : page reset ──
  await pageMo.goto(`${BASE}/reset.html`, { waitUntil: 'networkidle' });
  await fillResetSample(pageMo);
  await pageMo.waitForTimeout(300);
  await shot(pageMo, '15-reset-cle-mobile');
  await ctxMo.close();

  await browser.close();
  console.log('\nCaptures régénérées (tutoriel + page reset).');
})().catch(e => { console.error(e); process.exit(1); });
