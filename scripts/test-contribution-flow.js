// Test E2E : un membre crée un lieu + un récit, l'admin les valide,
// puis on vérifie qu'ils apparaissent.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:18542';
const SHOTS = path.join(__dirname, '..', 'docs', 'screenshots', 'flow');
fs.mkdirSync(SHOTS, { recursive: true });

const MEMBER = { email: 'membre@memoire-cevennes.local', password: 'MembreDemo2026' };
const ADMIN  = { email: 'admin@memoire-cevennes.local',  password: 'h_DYG8o8TSnI' };

const errs = [];

async function step(page, num, label, fn) {
  console.log(`\n— ${num}. ${label} —`);
  await fn();
  await page.screenshot({ path: path.join(SHOTS, `${String(num).padStart(2, '0')}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`) });
}

async function logoutAll(page) {
  try { await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' })); } catch {}
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('response', r => { if (r.status() >= 500) errs.push(`5xx ${r.url()}`); });

  // ─── Étape 1 : login membre ─────────────────────────────────────
  await step(page, 1, 'login membre', async () => {
    await page.goto(BASE + '/login.html');
    await page.fill('input[name=email]', MEMBER.email);
    await page.fill('input[name=password]', MEMBER.password);
    await page.click('button[type=submit]');
    await page.waitForURL('**/index.html');
    await page.waitForSelector('.leaflet-marker-icon');
    await page.waitForTimeout(1200);
  });

  // ─── Étape 2 : membre crée un lieu ──────────────────────────────
  let createdPlaceId = null;
  await step(page, 2, 'membre clique Ajouter un lieu', async () => {
    await page.click('#btn-add-place');
    await page.waitForTimeout(300);
  });

  await step(page, 3, 'membre place le marqueur sur la carte', async () => {
    // Clic au centre de la carte
    const mapBox = await page.locator('#map').boundingBox();
    await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
    await page.waitForSelector('#dlg-place[open]');
    await page.waitForTimeout(300);
  });

  await step(page, 4, 'membre remplit la modale Nouveau lieu', async () => {
    await page.fill('#dlg-place input[name=title]', 'Le Café du Pont (test E2E)');
    await page.fill('#dlg-place textarea[name=description]',
      'Café installé près du pont, lieu de rencontre des bergers le dimanche. Contribution test.');
    await page.fill('#dlg-place input[name=name]', 'Membre démo');
    await page.fill('#dlg-place input[name=writtenFrom]', 'Saint-Roman');
    await page.fill('#dlg-place input[name=relationship]', 'habitant·e');
  });

  await step(page, 5, 'membre soumet le nouveau lieu', async () => {
    page.once('dialog', d => d.accept());     // alert "ajout reçu"
    await page.click('#dlg-place button[value=submit]');
    await page.waitForTimeout(1500);
  });

  // Récupère l'id du lieu créé via l'API admin (token partagé)
  createdPlaceId = await page.evaluate(async () => {
    const r = await fetch('/api/places?status=all', { credentials: 'include' });
    const j = await r.json();
    const found = j.places.find(p => p.primaryName === 'Le Café du Pont (test E2E)');
    return found ? found.id : null;
  });
  console.log('   id du lieu créé :', createdPlaceId);

  // ─── Étape 3 : logout, login admin ──────────────────────────────
  await logoutAll(page);

  await step(page, 6, 'admin se connecte sur admin.html', async () => {
    await page.goto(BASE + '/admin.html');
    await page.fill('#form-login-account input[name=email]', ADMIN.email);
    await page.fill('#form-login-account input[name=password]', ADMIN.password);
    await page.click('#form-login-account button[type=submit]');
    await page.waitForSelector('#dashboard:not([hidden])');
    await page.waitForTimeout(800);
  });

  await step(page, 7, 'admin voit le lieu en attente dans la file', async () => {
    // file de modération est l'onglet par défaut
    const items = await page.$$eval('.queue-item', els =>
      els.map(e => e.textContent.trim().slice(0, 80)));
    console.log('   items en file :', items.length);
    items.forEach((t, i) => console.log(`     ${i + 1}. ${t}`));
  });

  await step(page, 8, 'admin approuve le lieu', async () => {
    // Trouve le bouton Approuver dans le card qui contient « Le Café du Pont »
    const approved = await page.evaluate(async (placeId) => {
      const cards = document.querySelectorAll('.queue-item');
      for (const c of cards) {
        if (c.textContent.includes('Café du Pont')) {
          const btn = c.querySelector('button[data-action="approve"]')
                   || [...c.querySelectorAll('button')].find(b => b.textContent.includes('Approuver'));
          if (btn) { btn.click(); return true; }
        }
      }
      return false;
    }, createdPlaceId);
    console.log('   approbation déclenchée :', approved);
    await page.waitForTimeout(1200);
  });

  // ─── Étape 4 : retour membre, ajoute un récit ────────────────────
  await logoutAll(page);

  await step(page, 9, 'membre se reconnecte et voit son lieu approuvé', async () => {
    await page.goto(BASE + '/login.html');
    await page.fill('input[name=email]', MEMBER.email);
    await page.fill('input[name=password]', MEMBER.password);
    await page.click('button[type=submit]');
    await page.waitForURL('**/index.html');
    await page.waitForSelector('.leaflet-marker-icon');
    await page.waitForTimeout(1200);
    const count = await page.locator('.leaflet-marker-icon').count();
    console.log('   marqueurs visibles :', count);
  });

  await step(page, 10, 'membre ouvre le lieu et clique Ajouter un récit', async () => {
    // Va directement à la fiche du lieu via le hash
    await page.evaluate((id) => { location.hash = '#/lieu/' + id; }, createdPlaceId);
    await page.waitForTimeout(700);
    await page.click('.btn-add-story');
    await page.waitForTimeout(400);
  });

  await step(page, 11, 'membre rédige un récit avec une mention @', async () => {
    const ta = await page.$('#dlg-story textarea[name=body]');
    await ta.click();
    await page.keyboard.type('Récit test : ', { delay: 20 });
    await page.keyboard.type('@geor', { delay: 30 });
    await page.waitForTimeout(700);
    // Sélectionne la suggestion
    if (await page.locator('#mention-popover:not([hidden])').isVisible().catch(() => false)) {
      await page.keyboard.press('Enter');
    }
    await page.keyboard.type(' venait souvent ici dans les années 1900.', { delay: 20 });
    await page.fill('#dlg-story input[name=title]', 'Test récit avec mention');
    await page.selectOption('#dlg-story select[name=type]', 'text');
    await page.fill('#dlg-story input[name=name]', 'Membre démo');
    await page.waitForTimeout(300);
  });

  await step(page, 12, 'membre soumet le récit', async () => {
    page.once('dialog', d => d.accept());
    await page.click('#dlg-story button[type=submit]');
    await page.waitForTimeout(1500);
  });

  // ─── Étape 5 : admin approuve le récit ──────────────────────────
  await logoutAll(page);

  await step(page, 13, 'admin retourne à la file et approuve le récit', async () => {
    await page.goto(BASE + '/admin.html');
    await page.fill('#form-login-account input[name=email]', ADMIN.email);
    await page.fill('#form-login-account input[name=password]', ADMIN.password);
    await page.click('#form-login-account button[type=submit]');
    await page.waitForSelector('#dashboard:not([hidden])');
    await page.waitForTimeout(800);
    const approved = await page.evaluate(() => {
      const cards = document.querySelectorAll('.queue-item');
      for (const c of cards) {
        if (c.textContent.includes('Test récit avec mention')) {
          const btn = c.querySelector('button[data-action="approve"]')
                   || [...c.querySelectorAll('button')].find(b => b.textContent.includes('Approuver'));
          if (btn) { btn.click(); return true; }
        }
      }
      return false;
    });
    console.log('   approbation récit déclenchée :', approved);
    await page.waitForTimeout(1200);
  });

  // ─── Étape 6 : vérification visiteur anonyme ────────────────────
  await logoutAll(page);

  await step(page, 14, 'visiteur anonyme — le contenu visibility=members reste invisible', async () => {
    await page.goto(BASE + '/');
    await page.waitForSelector('.leaflet-marker-icon');
    await page.waitForTimeout(800);
    const found = await page.evaluate(async () => {
      const r = await fetch('/api/places');
      const j = await r.json();
      return j.places.some(p => p.primaryName === 'Le Café du Pont (test E2E)');
    });
    console.log('   visiteur anonyme voit le café (devrait être false car visibility=members) :', found);
  });

  // ─── Étape 7 : vérification membre reconnecté ───────────────────
  await step(page, 15, 'membre reconnecté voit lieu + récit approuvés', async () => {
    await page.goto(BASE + '/login.html');
    await page.fill('input[name=email]', MEMBER.email);
    await page.fill('input[name=password]', MEMBER.password);
    await page.click('button[type=submit]');
    await page.waitForURL('**/index.html');
    await page.waitForSelector('.leaflet-marker-icon');
    await page.waitForTimeout(1000);
    await page.evaluate((id) => { location.hash = '#/lieu/' + id; }, createdPlaceId);
    await page.waitForTimeout(800);
    const story = await page.evaluate(async () => {
      const r = await fetch('/api/stories?placeId=' + encodeURIComponent(window.location.hash.split('/').pop()));
      const j = await r.json();
      return j.stories.find(s => s.title && s.title.includes('Test récit avec mention'));
    });
    console.log('   récit visible avec mention :', story ? 'OUI' : 'NON');
    if (story) console.log('   mentions :', JSON.stringify(story.mentions));
  });

  await browser.close();

  console.log(`\n${errs.length ? '✖' : '✓'} ${errs.length} erreurs console/serveur`);
  if (errs.length) errs.forEach(e => console.log('  ' + e));
  console.log(`captures dans ${path.relative(process.cwd(), SHOTS)}/`);
})();
