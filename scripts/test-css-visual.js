#!/usr/bin/env node
// Capture des vues clés de l'app pour comparaison avant/après refactor CSS.
// Usage : PORT=3199 node scripts/test-css-visual.js [before|after]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3199;
const BASE = `http://localhost:${PORT}`;
const TAG = process.argv[2] || 'snapshot';
const OUT = path.join('/tmp/mdc-css-visual', TAG);
fs.mkdirSync(OUT, { recursive: true });

async function settle(page) {
  try { await page.waitForSelector('.leaflet-marker-icon', { timeout: 5000 }); } catch {}
  await page.waitForTimeout(800);
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log('  ✓', file);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];

  // Desktop home
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(`[home] ${m.text()}`); });
    page.on('pageerror', e => errors.push(`[home pageerror] ${e.message}`));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await settle(page);
    // Ferme le modal d'accueil s'il s'affiche
    await page.evaluate(() => {
      const dlg = document.getElementById('welcome-dialog');
      if (dlg && dlg.open) dlg.close();
    });
    await page.waitForTimeout(300);
    await shot(page, '01-home-desktop');

    // Open a place
    await page.evaluate(() => { location.hash = '#/lieu/saint-roman-de-codieres'; });
    await page.waitForTimeout(700);
    await shot(page, '02-place-panel');

    // Open a person
    await page.evaluate(() => { location.hash = '#/personne/suzanne-duval'; });
    await page.waitForTimeout(700);
    await shot(page, '03-person-panel');

    await ctx.close();
  }

  // Mobile home
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await settle(page);
    await page.evaluate(() => {
      const dlg = document.getElementById('welcome-dialog');
      if (dlg && dlg.open) dlg.close();
    });
    await page.waitForTimeout(300);
    await shot(page, '04-home-mobile');
    await ctx.close();
  }

  // Admin (token mode)
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin.html`);
    await page.evaluate(() => {
      localStorage.setItem('mdc-admin-mode', 'token');
      localStorage.setItem('mdc-admin-token', 'dev');
      localStorage.setItem('mdc-admin-reviewer', 'tester');
    });
    await page.goto(`${BASE}/admin.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await shot(page, '05-admin-queue');
    await ctx.close();
  }

  // Aide page
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/aide.html`, { waitUntil: 'networkidle' });
    await shot(page, '06-aide');
    await ctx.close();
  }

  await browser.close();

  if (errors.length) {
    console.log('\nErreurs détectées :');
    for (const e of errors) console.log(' ', e);
  } else {
    console.log('\n(aucune erreur JS)');
  }
})();
