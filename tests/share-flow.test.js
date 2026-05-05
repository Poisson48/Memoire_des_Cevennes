// Test E2E : le bouton 📤 Partager ouvre le dialog avec un QR code et une
// URL hash (#/lieu/, #/personne/, #/recit/), copie le lien dans le
// presse-papier, déclenche le téléchargement du PNG, et appelle
// navigator.share() en mobile (Web Share API stubée).
//
// Pré-requis : serveur live sur BASE (par défaut http://localhost:18542).
// Lancement : node --test tests/share-flow.test.js

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, devices } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:18542';
const PLACE_ID = 'saint-roman-de-codieres';

async function dismissWelcome(page) {
  // Le dialog d'accueil intercepte les clics tant qu'il est ouvert.
  await page.evaluate(() => {
    try { localStorage.setItem('mdc-welcome-dismissed', '1'); } catch {}
    const w = document.getElementById('welcome-dialog');
    if (w && w.open) w.close();
  });
}

async function openSharedDialogForPlace(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('mdc-welcome-dismissed', '1'); } catch {}
  });
  await page.goto(`${BASE}/#/lieu/${PLACE_ID}`);
  await page.waitForSelector('.btn-share', { timeout: 5000 });
  await dismissWelcome(page);
  const dlg = page.locator('#dlg-share');
  await page.locator('.btn-share').first().click();
  await dlg.waitFor({ state: 'visible' });
  return dlg;
}

test('partage lieu — dialog ouvre, QR + URL #/lieu/<id>', async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  try {
    const dlg = await openSharedDialogForPlace(page);

    const url = await page.locator('#share-url').inputValue();
    assert.match(url, new RegExp(`#/lieu/${PLACE_ID}$`), 'URL partagée doit pointer vers le lieu');

    const title = await dlg.locator('h2').textContent();
    assert.match(title || '', /Saint-Roman-de-Codières/, 'titre du dialog reprend le nom du lieu');

    const qrCanvas = dlg.locator('#share-qr canvas');
    await qrCanvas.waitFor({ state: 'attached' });
    assert.equal(await qrCanvas.count(), 1, 'un canvas QR rendu');
  } finally {
    await browser.close();
  }
});

test('partage lieu — bouton Copier place le lien dans le presse-papier', async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  try {
    await openSharedDialogForPlace(page);
    await page.locator('#share-copy').click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(clip, new RegExp(`#/lieu/${PLACE_ID}$`));
  } finally {
    await browser.close();
  }
});

test('partage lieu — bouton Télécharger déclenche un PNG', async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await openSharedDialogForPlace(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#share-download').click(),
    ]);
    assert.match(download.suggestedFilename(), /^qr-.*\.png$/);
  } finally {
    await browser.close();
  }
});

test('partage mobile — bouton « Partager via… » appelle navigator.share()', async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    ...devices['Pixel 5'],
  });
  const page = await ctx.newPage();
  // Stub Web Share API avant tout script de la page.
  await page.addInitScript(() => {
    window.__shareCalls = [];
    navigator.share = (data) => {
      window.__shareCalls.push(data);
      return Promise.resolve();
    };
  });
  try {
    await openSharedDialogForPlace(page);

    const btnNative = page.locator('#share-native');
    await btnNative.waitFor({ state: 'visible' });
    await btnNative.click();

    const calls = await page.evaluate(() => window.__shareCalls);
    assert.equal(calls.length, 1, 'navigator.share appelé une fois');
    assert.match(calls[0].url, new RegExp(`#/lieu/${PLACE_ID}$`));
    assert.match(calls[0].title || '', /Saint-Roman-de-Codières/);
  } finally {
    await browser.close();
  }
});

test('partage personne — URL #/personne/<id>', async () => {
  const PERSON_ID = 'pierre-bermond-de-sauve';
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    try { localStorage.setItem('mdc-welcome-dismissed', '1'); } catch {}
  });
  try {
    await page.goto(`${BASE}/#/personne/${PERSON_ID}`);
    await page.waitForSelector('.btn-share', { timeout: 5000 });
    await dismissWelcome(page);
    await page.locator('.btn-share').first().click();
    const dlg = page.locator('#dlg-share');
    await dlg.waitFor({ state: 'visible' });
    const url = await page.locator('#share-url').inputValue();
    assert.match(url, new RegExp(`#/personne/${PERSON_ID}$`));
  } finally {
    await browser.close();
  }
});

test('partage récit — URL #/recit/<id>', async () => {
  const STORY_ID = 'geographie-et-origines-antiques';
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    try { localStorage.setItem('mdc-welcome-dismissed', '1'); } catch {}
  });
  try {
    await page.goto(`${BASE}/#/recit/${STORY_ID}`);
    await page.waitForSelector('.btn-share', { timeout: 5000 });
    await dismissWelcome(page);
    await page.locator('.btn-share').first().click();
    const dlg = page.locator('#dlg-share');
    await dlg.waitFor({ state: 'visible' });
    const url = await page.locator('#share-url').inputValue();
    assert.match(url, new RegExp(`#/recit/${STORY_ID}$`));
  } finally {
    await browser.close();
  }
});

test('partage desktop — bouton « Partager via… » caché si pas de Web Share API', async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // S'assurer que navigator.share n'existe pas (cas desktop par défaut).
  await page.addInitScript(() => {
    if ('share' in navigator) {
      try { delete Navigator.prototype.share; } catch {}
      try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch {}
    }
  });
  try {
    await openSharedDialogForPlace(page);
    const hidden = await page.locator('#share-native').getAttribute('hidden');
    assert.notEqual(hidden, null, 'bouton natif doit rester caché sur desktop sans Web Share API');
  } finally {
    await browser.close();
  }
});
