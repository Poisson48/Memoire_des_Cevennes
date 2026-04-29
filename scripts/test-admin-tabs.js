#!/usr/bin/env node
// Test post-refactor de l'admin : ouvre chaque onglet et vérifie qu'aucune
// erreur JS ne se déclenche dans la console. Capture aussi un screenshot
// par onglet pour relecture visuelle.
//
// Usage : PORT=3199 ADMIN_TOKEN=dev node scripts/test-admin-tabs.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3199;
const TOKEN = process.env.ADMIN_TOKEN || 'dev';
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(__dirname, '..', '/tmp/mdc-admin-test');
fs.mkdirSync(OUT, { recursive: true });

const TABS = [
  // [bouton à cliquer, sélecteur attendu visible après]
  { tab: 'queue',    filter: 'all',    section: '#queue' },
  { tab: 'aliases',  section: '#aliases' },
  { tab: 'members',  section: '#members' },
  { tab: 'resets',   section: '#resets' },
  { tab: 'activity', section: '#activity' },
  { tab: 'backups',  section: '#backups' },
  { tab: 'welcome',  section: '#welcome' },
  { tab: 'settings', section: '#settings' },
  { tab: 'help',     section: '#help' },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => {
    if (m.type() === 'error') errors.push({ where: 'console', text: m.text() });
  });
  page.on('pageerror', e => {
    errors.push({ where: 'pageerror', text: e.message });
  });

  // Login en mode token via localStorage
  await page.goto(`${BASE}/admin.html`);
  await page.evaluate((t) => {
    localStorage.setItem('mdc-admin-mode', 'token');
    localStorage.setItem('mdc-admin-token', t);
    localStorage.setItem('mdc-admin-reviewer', 'tester');
  }, TOKEN);
  await page.goto(`${BASE}/admin.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Sanity : dashboard visible ?
  const dashHidden = await page.evaluate(() => document.getElementById('dashboard').hidden);
  if (dashHidden) {
    console.log('❌ Dashboard caché — login a échoué');
    console.log('Erreurs :', errors);
    process.exit(1);
  }
  console.log('✓ Login OK, dashboard visible');
  await page.screenshot({ path: path.join(OUT, '00-loaded.png') });

  // Pour chaque onglet, clique le bouton, attend, vérifie visible, screenshot
  for (const t of TABS) {
    const sel = t.filter
      ? `.tab-btn[data-tab="${t.tab}"][data-filter="${t.filter}"]`
      : `.tab-btn[data-tab="${t.tab}"]`;
    const btn = await page.$(sel);
    if (!btn) { console.log(`  ⚠ tab btn ${t.tab} introuvable`); continue; }
    await btn.click();
    await page.waitForTimeout(600);
    const visible = await page.$eval(t.section, el => !el.hidden);
    const ok = visible ? '✓' : '❌';
    console.log(`${ok} onglet ${t.tab} → section ${t.section} ${visible ? 'visible' : 'cachée'}`);
    await page.screenshot({ path: path.join(OUT, `tab-${t.tab}.png`) });
  }

  console.log('\n--- Erreurs JS détectées ---');
  if (errors.length === 0) console.log('  (aucune)');
  else for (const e of errors) console.log(`  [${e.where}] ${e.text}`);

  await browser.close();
  process.exit(errors.length ? 2 : 0);
})();
