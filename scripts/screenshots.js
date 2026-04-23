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

  // 4. Dialog « Ajouter un contenu » avec le widget d'enregistrement audio
  await page.evaluate(() => { location.hash = '#/lieu/mas-de-la-coste'; });
  await page.waitForTimeout(600);
  const addBtnEl = await page.$('.btn-add-story');
  if (addBtnEl) {
    await addBtnEl.click();
    await page.waitForTimeout(400);
    // Type audio → affiche le recorder. Passe par evaluate car playwright
    // ne sait pas bien interagir avec un <dialog> modal.
    await page.evaluate(() => {
      const sel = document.getElementById('story-type');
      sel.value = 'audio';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(200);
    await shot(page, '10-add-story-audio-recorder');
    await page.evaluate(() => document.getElementById('dlg-story').close('cancel'));
  }

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

async function runAdmin(browser) {
  // Pour avoir du contenu à afficher : on injecte une proposition de modif
  // via l'API publique, puis on se connecte à l'admin.
  const http = require('http');
  await new Promise((res, rej) => {
    const req = http.request({
      hostname: 'localhost', port: PORT, path: '/api/places/saint-roman-de-codieres/edits',
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    }, r => { r.on('data', () => {}); r.on('end', res); });
    req.on('error', rej);
    req.write(JSON.stringify({
      changes: { description: 'Village du piémont cévenol, sur le flanc sud du massif de la Fage, à mi-chemin entre Ganges et Le Vigan. Point de départ du projet.' },
      note: 'Reformule plus concis et ajoute une référence géographique',
      submittedBy: { pseudo: 'marie-d' },
    }));
    req.end();
  });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('  [admin console.error]', msg.text());
  });
  page.on('pageerror', err => console.log('  [admin pageerror]', err.message));
  page.on('response', r => {
    if (r.url().includes('/api/admin') && r.status() >= 400) {
      console.log('  [admin api]', r.status(), r.url());
    }
  });

  console.log('— Admin —');
  // Dépose le token + reviewer en localStorage via une première visite.
  await page.goto(`${BASE}/admin.html`);
  await page.evaluate((token) => {
    localStorage.setItem('mdc-admin-token', token);
    localStorage.setItem('mdc-admin-reviewer', 'valou');
  }, process.env.ADMIN_TOKEN || 'dev');
  await page.goto(`${BASE}/admin.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  try {
    await page.waitForSelector('.queue-item', { timeout: 5000 });
  } catch {
    // Capture l'écran quand même pour diagnostiquer
    console.log('  [admin] .queue-item introuvable, capture quand même');
    await shot(page, '08-admin-debug');
  }
  await page.waitForTimeout(400);
  await shot(page, '08-admin-queue-desktop');

  // Vue de la boîte de dialogue "Proposer une modification" côté utilisateur
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page2 = await ctx2.newPage();
  await page2.goto(BASE, { waitUntil: 'networkidle' });
  await settleMap(page2);
  await page2.evaluate(() => { location.hash = '#/lieu/saint-roman-de-codieres'; });
  await page2.waitForTimeout(500);
  await page2.click('.btn-propose-edit');
  await page2.waitForTimeout(400);
  await shot(page2, '09-propose-edit-dialog');

  await ctx.close();
  await ctx2.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await runDesktop(browser);
    await runMobile(browser);
    if (process.env.ADMIN_TOKEN) await runAdmin(browser);
    else console.log('— Admin — (skip : ADMIN_TOKEN non défini)');
  } finally {
    await browser.close();
  }
  console.log('\nScreenshots dans', path.relative(process.cwd(), OUT));
})().catch(e => { console.error(e); process.exit(1); });
