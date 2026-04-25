// Test E2E : un membre crée un lieu, l'admin l'approuve, le visiteur anonyme
// ne le voit pas (visibility=members), le membre reconnecté le voit.
//
// Pré-requis :
//   - serveur live sur BASE (par défaut http://localhost:18542)
//   - comptes démo seedés : membre@memoire-cevennes.local / admin@memoire-cevennes.local
//
//   PORT=18542 ADMIN_TOKEN=dev JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))") node server.js &
//   node scripts/seed-bootstrap.js && node scripts/seed-demo.js
//   SEED_EMAIL=admin@memoire-cevennes.local SEED_NAME=Admin SEED_PASSWORD=h_DYG8o8TSnI node scripts/seed-admin.js
//
// Lancement : npm test
//             BASE=http://localhost:18542 npm test

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const BASE   = process.env.BASE   || 'http://localhost:18542';
const MEMBER = { email: 'membre@memoire-cevennes.local', password: 'MembreDemo2026' };
const ADMIN  = { email: 'admin@memoire-cevennes.local',  password: 'h_DYG8o8TSnI' };

const PLACES_FILE = path.join(__dirname, '..', 'data', 'places.json');

function removePlaceFromFile(slug) {
  try {
    const db = JSON.parse(fs.readFileSync(PLACES_FILE, 'utf8'));
    const before = db.places.length;
    db.places = db.places.filter(x => x.id !== slug);
    if (db.places.length !== before) {
      fs.writeFileSync(PLACES_FILE, JSON.stringify(db, null, 2) + '\n');
    }
  } catch { /* fichier absent : rien à nettoyer */ }
}

async function loginAsMember(page) {
  await page.goto(`${BASE}/login.html`);
  await page.fill('input[name=email]', MEMBER.email);
  await page.fill('input[name=password]', MEMBER.password);
  await page.click('button[type=submit]');
  await page.waitForURL('**/index.html');
  await page.waitForSelector('.leaflet-marker-icon');
}

async function loginAsAdmin(page) {
  await page.goto(`${BASE}/admin.html`);
  await page.fill('#form-login-account input[name=email]', ADMIN.email);
  await page.fill('#form-login-account input[name=password]', ADMIN.password);
  await page.click('#form-login-account button[type=submit]');
  await page.waitForSelector('#dashboard:not([hidden])');
}

async function logout(page) {
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }))
            .catch(() => {});
}

test('serveur joignable et seeds en place', async () => {
  const r = await fetch(`${BASE}/api/places`);
  assert.equal(r.ok, true, `${BASE}/api/places ne répond pas (${r.status})`);
  const j = await r.json();
  assert.ok(Array.isArray(j.places), 'réponse /api/places malformée');
  assert.ok(j.places.length >= 1, 'aucun lieu seedé — lance scripts/seed-bootstrap.js');
});

test('flow contribution : membre crée, admin approuve, visibility=members protège', async (t) => {
  const stamp = Date.now();
  const placeName = `Test E2E ${stamp}`;
  // Le serveur slugifie primaryName → on dérive le slug attendu pour pouvoir
  // nettoyer même si le test plante avant d'avoir lu l'id côté API.
  const expectedSlug = `test-e2e-${stamp}`;

  const browser = await chromium.launch();
  t.after(async () => {
    removePlaceFromFile(expectedSlug);
    await browser.close();
  });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('response', r => {
    if (r.status() >= 500) pageErrors.push(`5xx ${r.status()} ${r.url()}`);
  });

  // ─── 1. Login membre ────────────────────────────────────────────────
  await loginAsMember(page);

  // ─── 2. Crée un lieu via la modale ──────────────────────────────────
  await page.click('#btn-add-place');
  const mapBox = await page.locator('#map').boundingBox();
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
  await page.waitForSelector('#dlg-place[open]');
  await page.fill('#dlg-place input[name=title]', placeName);
  await page.fill('#dlg-place textarea[name=description]', 'Lieu de test automatique.');
  await page.fill('#dlg-place input[name=name]', 'Membre démo');
  page.once('dialog', d => d.accept()); // alerte « ajout reçu »
  await page.click('#dlg-place button[value=submit]');
  await page.waitForTimeout(1200);

  // Vérifie que le lieu existe en pending côté serveur, et récupère l'id réel.
  const pending = await page.evaluate(async (name) => {
    const r = await fetch('/api/places?status=all', { credentials: 'include' });
    const j = await r.json();
    return j.places.find(p => p.primaryName === name) || null;
  }, placeName);
  assert.ok(pending, `lieu "${placeName}" introuvable après création`);
  assert.equal(pending.status, 'pending', 'lieu créé devrait être en pending');
  assert.equal(pending.visibility, 'members', 'défaut visibility=members attendu');
  assert.equal(pending.id, expectedSlug, `slug inattendu : ${pending.id}`);

  // ─── 3. Visiteur anonyme : ne doit PAS voir le lieu ─────────────────
  await logout(page);
  const anonHasIt = await page.evaluate(async (slug) => {
    const r = await fetch('/api/places');
    const j = await r.json();
    return j.places.some(p => p.id === slug);
  }, expectedSlug);
  assert.equal(anonHasIt, false, 'visibility=members mais visiteur anonyme le voit');

  // ─── 4. Admin se connecte et approuve via la file ───────────────────
  await loginAsAdmin(page);
  const queueLen = await page.locator('.queue-item').count();
  assert.ok(queueLen >= 1, `file admin vide alors qu\'un lieu pending existe (${queueLen})`);

  const approved = await page.evaluate((name) => {
    for (const card of document.querySelectorAll('.queue-item')) {
      if (card.textContent.includes(name)) {
        const btn = card.querySelector('button[data-action="approve"]')
                 || [...card.querySelectorAll('button')].find(b => /approuver/i.test(b.textContent));
        if (btn) { btn.click(); return true; }
      }
    }
    return false;
  }, placeName);
  assert.equal(approved, true, 'bouton « Approuver » introuvable dans la file admin');
  await page.waitForTimeout(1000);

  // ─── 5. Membre reconnecté voit le lieu approuvé ─────────────────────
  await logout(page);
  await loginAsMember(page);
  const memberSeesIt = await page.evaluate(async (slug) => {
    const r = await fetch('/api/places', { credentials: 'include' });
    const j = await r.json();
    const p = j.places.find(p => p.id === slug);
    return p ? p.status : null;
  }, expectedSlug);
  assert.equal(memberSeesIt, 'approved', 'membre devrait voir son lieu en approved');

  // ─── 6. Visiteur anonyme reste protégé même après approbation ──────
  await logout(page);
  const stillHidden = await page.evaluate(async (slug) => {
    const r = await fetch('/api/places');
    const j = await r.json();
    return j.places.some(p => p.id === slug);
  }, expectedSlug);
  assert.equal(stillHidden, false, 'lieu approved en visibility=members ne doit pas fuir au public');

  assert.deepEqual(pageErrors, [], `erreurs page/serveur :\n  ${pageErrors.join('\n  ')}`);
});
