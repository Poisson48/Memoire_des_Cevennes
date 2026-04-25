#!/usr/bin/env node
// Test end-to-end Mémoire des Cévennes — PC (1280×800) + mobile (390×844).
// Capture les écrans clés dans docs/screenshots/.
// Usage : PORT=18542 node scripts/e2e-test.js
//         (admin doit déjà exister, identifiants ci-dessous)

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 18542;
const BASE = `http://localhost:${PORT}`;
const SHOTS_DIR = path.join(__dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const ADMIN_EMAIL = 'admin@memoire-cevennes.local';
const ADMIN_PWD   = 'h_DYG8o8TSnI';
const MEMBER_EMAIL = 'membre@memoire-cevennes.local';
const MEMBER_PWD   = 'MembreDemo2026';

const errors = [];
const results = [];

async function shot(target, name) {
  const file = path.join(SHOTS_DIR, name + '.png');
  await target.screenshot({ path: file });
  results.push({ name, file });
}

async function tabSettleMap(page) {
  try {
    await page.waitForSelector('.leaflet-marker-icon', { timeout: 8000 });
  } catch {}
  await page.waitForTimeout(1200);
}

async function runViewport(browser, label, viewport, suffix) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('response', r => { if (r.status() >= 500) errors.push(`[${label}] ${r.status()} ${r.url()}`); });

  console.log(`\n— ${label} (${viewport.width}×${viewport.height}) —`);

  // 1. Home anonyme
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await tabSettleMap(page);
  await shot(page, `01-home-anonyme${suffix}`);
  const anonPlaces = await page.evaluate(() =>
    document.querySelectorAll('.leaflet-marker-icon').length
  );
  console.log(`  marqueurs visibles (anonyme) : ${anonPlaces}`);

  // 2. Page de login membre
  await page.goto(BASE + '/login.html');
  await page.waitForSelector('input[name=email]');
  await shot(page, `02-login-membre${suffix}`);

  // 3. Tentative admin sur /login.html → refus
  await page.fill('input[name=email]', ADMIN_EMAIL);
  await page.fill('input[name=password]', ADMIN_PWD);
  await page.click('button[type=submit]');
  await page.waitForTimeout(800);
  const adminRefus = await page.locator('#auth-error').isVisible();
  console.log(`  admin refusé sur /login.html : ${adminRefus ? '✓' : '✖'}`);
  await shot(page, `03-admin-refuse-sur-login${suffix}`);

  // 4. Login membre OK
  await page.goto(BASE + '/login.html');
  await page.waitForSelector('input[name=email]');
  await page.fill('input[name=email]', MEMBER_EMAIL);
  await page.fill('input[name=password]', MEMBER_PWD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/index.html', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  await tabSettleMap(page);
  const memberPlaces = await page.evaluate(() =>
    document.querySelectorAll('.leaflet-marker-icon').length
  );
  console.log(`  marqueurs visibles (membre) : ${memberPlaces} (gain : +${memberPlaces - anonPlaces})`);
  await shot(page, `04-home-membre-connecte${suffix}`);

  // 5. Clic sur un marqueur → panneau de lieu
  const markers = await page.$$('.leaflet-marker-icon');
  if (markers.length) {
    await markers[0].click();
    await page.waitForTimeout(700);
    await shot(page, `05-panneau-lieu${suffix}`);
  }

  // 6. Page de signalement
  await page.goto(BASE + '/signaler.html');
  await page.waitForSelector('select[name=category]');
  await shot(page, `06-signaler${suffix}`);

  // 7. Pages légales
  await page.goto(BASE + '/legal/mentions.html');
  await page.waitForTimeout(300);
  await shot(page, `07-mentions${suffix}`);
  await page.goto(BASE + '/legal/confidentialite.html');
  await page.waitForTimeout(300);
  await shot(page, `08-confidentialite${suffix}`);

  // 8. Logout du membre, accès admin
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
  await page.goto(BASE + '/admin.html');
  await page.waitForSelector('[data-login=account]');
  await shot(page, `09-admin-login${suffix}`);

  // 9. Admin login compte → dashboard
  await page.fill('#form-login-account input[name=email]', ADMIN_EMAIL);
  await page.fill('#form-login-account input[name=password]', ADMIN_PWD);
  await page.click('#form-login-account button[type=submit]');
  await page.waitForSelector('#dashboard:not([hidden])', { timeout: 5000 });
  await page.waitForTimeout(600);
  await shot(page, `10-admin-dashboard${suffix}`);

  // 10. Onglet membres admin
  await page.click('.tab-btn[data-tab=members]');
  await page.waitForTimeout(800);
  await shot(page, `11-admin-membres${suffix}`);

  // 11. Onglet activité
  await page.click('.tab-btn[data-tab=activity]');
  await page.waitForTimeout(800);
  await shot(page, `12-admin-activite${suffix}`);

  // 12. Admin retour à la carte → doit voir tout (admin = membre)
  await page.goto(BASE + '/');
  await tabSettleMap(page);
  const adminPlaces = await page.evaluate(() =>
    document.querySelectorAll('.leaflet-marker-icon').length
  );
  console.log(`  marqueurs visibles (admin connecté) : ${adminPlaces}`);
  await shot(page, `13-admin-aussi-membre${suffix}`);

  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();

  await runViewport(browser, 'PC',     { width: 1280, height: 800 }, '-pc');
  await runViewport(browser, 'Mobile', { width: 390,  height: 844 }, '-mobile');

  await browser.close();

  console.log(`\n✓ ${results.length} captures dans ${path.relative(process.cwd(), SHOTS_DIR)}/`);
  if (errors.length) {
    console.log('\n✖ ERREURS :');
    errors.forEach(e => console.log('  -', e));
    process.exit(1);
  } else {
    console.log('✓ aucune erreur console / serveur');
  }
})();
