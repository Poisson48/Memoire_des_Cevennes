#!/usr/bin/env node
// Vérifie la lightbox media sur le site public et la file de modération
// admin. Capture des écrans en double viewport (desktop + mobile).
//
// Usage : node scripts/test-lightbox.js
//   (cible le serveur live sur localhost:18542 ; pour qu'il serve la
//   nouvelle lightbox.js et son CSS, aucun restart Node n'est nécessaire,
//   ces fichiers sont servis statiquement.)

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:18542';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'dev';
const OUT = path.join(__dirname, '..', 'docs', 'screenshots', 'lightbox');

async function dismissWelcome(page) {
  await page.evaluate(() => {
    try { localStorage.setItem('mdc-welcome-dismissed', '1'); } catch {}
    document.querySelectorAll('dialog[open]').forEach(d => d.close('cancel'));
  });
}

const VIEWPORTS = [
  { name: 'pc',     width: 1280, height: 800,  isMobile: false },
  { name: 'mobile', width: 390,  height: 844,  isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
];

const issues = [];

async function testPublic(browser, vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, ...(vp.userAgent ? { userAgent: vp.userAgent } : {}) });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/#/recit/geographie-et-origines-antiques`, { waitUntil: 'networkidle' });
  await dismissWelcome(page);
  await page.waitForTimeout(800);

  // Attend qu'un récit avec une image apparaisse
  const img = await page.locator('article.story img[data-lightbox-media]').first();
  if (!(await img.count())) {
    issues.push(`[public/${vp.name}] aucune image data-lightbox-media trouvée`);
    await ctx.close();
    return;
  }
  await page.screenshot({ path: path.join(OUT, `public-${vp.name}-1-before.png`) });

  await img.scrollIntoViewIfNeeded();
  await img.click();
  await page.waitForTimeout(400);

  const lbVisible = await page.locator('dialog#lightbox[open]').count();
  if (!lbVisible) {
    issues.push(`[public/${vp.name}] lightbox ne s'est pas ouverte au clic image`);
  } else {
    await page.screenshot({ path: path.join(OUT, `public-${vp.name}-2-lightbox.png`) });
    // Vérifie présence du compteur "n / N" si multi-média
    const counter = await page.locator('.lb-counter').textContent().catch(() => '');
    console.log(`[public/${vp.name}] counter='${counter}'`);
    if (counter && /\d+ \/ \d+/.test(counter)) {
      await page.locator('.lb-next').click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, `public-${vp.name}-3-next.png`) });
    }
    // Test zoom : double-clic souris sur l'image -> zoom 2x
    if (!vp.isMobile) {
      const lbImg = page.locator('.lb-img');
      await lbImg.dblclick();
      await page.waitForTimeout(200);
      const zoomed = await lbImg.evaluate(el => el.classList.contains('zoomed'));
      if (!zoomed) issues.push(`[public/${vp.name}] double-clic ne zoome pas`);
      await page.screenshot({ path: path.join(OUT, `public-${vp.name}-4-zoomed.png`) });
      // ESC en zoom -> reset (pas fermeture)
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      const stillOpen = await page.locator('dialog#lightbox[open]').count();
      if (!stillOpen) issues.push(`[public/${vp.name}] ESC en zoom devrait dézoomer, pas fermer`);
      const stillZoomed = await lbImg.evaluate(el => el.classList.contains('zoomed')).catch(() => false);
      if (stillZoomed) issues.push(`[public/${vp.name}] ESC en zoom n'a pas dézoomé`);
    }
    // Ferme avec ESC
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  await ctx.close();
}

async function testAdmin(browser, vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, ...(vp.userAgent ? { userAgent: vp.userAgent } : {}) });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/admin.html`, { waitUntil: 'networkidle' });
  await page.evaluate((tok) => {
    try { localStorage.setItem('mdc_admin_token', tok); } catch {}
  }, ADMIN_TOKEN);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Cherche une qmedia avec image
  const img = await page.locator('.qmedia img[data-lightbox-media]').first();
  const has = await img.count();
  if (!has) {
    issues.push(`[admin/${vp.name}] aucune image data-lightbox-media dans la file de modération (rien en pending avec image ?)`);
    await page.screenshot({ path: path.join(OUT, `admin-${vp.name}-0-empty.png`) });
    await ctx.close();
    return;
  }
  await img.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, `admin-${vp.name}-1-before.png`) });
  await img.click();
  await page.waitForTimeout(400);

  const lbVisible = await page.locator('dialog#lightbox[open]').count();
  if (!lbVisible) {
    issues.push(`[admin/${vp.name}] lightbox ne s'est pas ouverte au clic image`);
  } else {
    await page.screenshot({ path: path.join(OUT, `admin-${vp.name}-2-lightbox.png`) });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  await ctx.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  for (const vp of VIEWPORTS) {
    console.log(`\n=== Viewport ${vp.name} (${vp.width}x${vp.height}) ===`);
    await testPublic(browser, vp);
    await testAdmin(browser, vp);
  }
  await browser.close();
  if (issues.length) {
    console.log('\n--- PROBLÈMES ---');
    for (const i of issues) console.log('•', i);
    process.exit(1);
  }
  console.log('\nOK : captures dans', OUT);
})();
