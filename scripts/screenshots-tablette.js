#!/usr/bin/env node
// Capture les vues du tutoriel/aide en 3 formats : PC (1280×800),
// tablette portrait (768×1024) et mobile (390×844). Cible les vues
// accessibles en mode visiteur (sans login). Les captures résultantes
// sont consommées par aide.html via <picture> (sources mobile / tab,
// fallback PC).
//
// Prérequis : serveur sur $PORT (défaut 3199 pour ne pas perturber l'instance live).
// Usage : PORT=18542 node scripts/screenshots-tablette.js

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3199;
const BASE = `http://localhost:${PORT}`;
const OUT  = path.join(__dirname, '..', 'docs', 'screenshots');

const FORMATS = [
  { suffix: 'pc',     viewport: { width: 1280, height: 800 } },
  { suffix: 'tab',    viewport: { width: 768,  height: 1024 } },
  { suffix: 'mobile', viewport: { width: 390,  height: 844 }, isMobile: true, scale: 2 },
];

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  console.log('  ✓', `docs/screenshots/${name}.png`);
}

async function settleMap(page) {
  try { await page.waitForSelector('.leaflet-marker-icon', { timeout: 8000 }); } catch {}
  await page.waitForTimeout(800);
}

async function dismissWelcome(page) {
  await page.evaluate(() => {
    try { localStorage.setItem('mdc-welcome-dismissed', '1'); } catch {}
    document.querySelectorAll('dialog[open]').forEach(d => d.close('cancel'));
  });
}

async function captureFormat(browser, fmt) {
  console.log(`\n— ${fmt.suffix} (${fmt.viewport.width}×${fmt.viewport.height}) —`);
  const ctx = await browser.newContext({
    viewport: fmt.viewport,
    deviceScaleFactor: fmt.scale || 1,
    isMobile: !!fmt.isMobile,
    hasTouch: !!fmt.isMobile,
  });
  const page = await ctx.newPage();

  // ── 01 : carte d'accueil anonyme ──
  await page.goto(BASE);
  await dismissWelcome(page);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await dismissWelcome(page);
  await settleMap(page);
  await shot(page, `01-home-anonyme-${fmt.suffix}`);

  // ── 15-couches : panneau Couches ouvert sur fond État-Major ──
  await page.evaluate(() => {
    const t = document.querySelector('.map-layers-toggle');
    if (t) t.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const radio = document.querySelector('input[name="mdc-base"][value="etatmajor"]');
    if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.waitForTimeout(800);
  await shot(page, `15-couches-${fmt.suffix}`);
  await page.evaluate(() => {
    const radio = document.querySelector('input[name="mdc-base"][value="osm"]');
    if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
    const t = document.querySelector('.map-layers-toggle');
    if (t) t.click();
  });
  await page.waitForTimeout(200);

  // ── 05 : panneau d'un lieu (visiteur) ──
  await page.goto(`${BASE}/#/lieu/saint-roman-de-codieres`, { waitUntil: 'networkidle' });
  await dismissWelcome(page);
  try { await page.waitForSelector('.panel[aria-hidden="false"]', { timeout: 5000 }); } catch {}
  await page.waitForTimeout(600);
  await shot(page, `05-panneau-lieu-${fmt.suffix}`);

  // ── 02 : page de connexion membre ──
  await page.goto(`${BASE}/login.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await shot(page, `02-login-membre-${fmt.suffix}`);

  // ── 06 : page signaler ──
  await page.goto(`${BASE}/signaler.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await shot(page, `06-signaler-${fmt.suffix}`);

  // ── 15-reset-cle : page activation avec clé pré-remplie ──
  await page.goto(`${BASE}/reset.html`, { waitUntil: 'networkidle' });
  await page.fill('input[name="key"]', 'ABCD-EFGH-JKMN').catch(() => {});
  await page.fill('input[name="password"]', 'monMotDePasse').catch(() => {});
  await page.fill('input[name="password2"]', 'monMotDePasse').catch(() => {});
  await page.waitForTimeout(300);
  await shot(page, `15-reset-cle-${fmt.suffix}`);

  // ── 08 : politique de confidentialité ──
  await page.goto(`${BASE}/legal/confidentialite.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await shot(page, `08-confidentialite-${fmt.suffix}`);

  await ctx.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  for (const f of FORMATS) await captureFormat(browser, f);
  await browser.close();
  console.log('\nCaptures multi-format générées dans', path.relative(process.cwd(), OUT));
})().catch(e => { console.error(e); process.exit(1); });
