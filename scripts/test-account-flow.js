#!/usr/bin/env node
// Test E2E API : inscription avec téléphone, edition self-service, edition admin,
// détection de doublons. Snapshot data/ avant, restaure après — n'écrit
// rien de durable.
//
// Lancement :
//   node scripts/test-account-flow.js
// (lance son propre serveur sur PORT=3199, indépendant du live 18542)

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const SNAPSHOT_FILES = ['members.json', 'activity_log.json', 'password_resets.json'];
const PORT = process.env.TEST_PORT || '3199';
const BASE = `http://localhost:${PORT}`;
const ADMIN_TOKEN = 'test-admin-token';

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else    { fail++; console.error(`  ✗ ${name}`); if (detail) console.error('    ', detail); }
}

function snapshot() {
  const out = {};
  for (const f of SNAPSHOT_FILES) {
    const p = path.join(DATA, f);
    if (fs.existsSync(p)) out[f] = fs.readFileSync(p, 'utf8');
  }
  return out;
}
function restore(snap) {
  for (const f of SNAPSHOT_FILES) {
    const p = path.join(DATA, f);
    if (snap[f] !== undefined) fs.writeFileSync(p, snap[f]);
  }
}

async function waitFor(url, timeoutMs = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url, { method: 'GET' });
      if (r.status < 500) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`server not up at ${url} after ${timeoutMs}ms`);
}

class Cookies {
  constructor() { this.jar = new Map(); }
  push(setCookie) {
    if (!setCookie) return;
    const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const sc of arr) {
      const [pair] = sc.split(';');
      const [name, ...rest] = pair.split('=');
      this.jar.set(name.trim(), rest.join('='));
    }
  }
  header() {
    return [...this.jar.entries()].map(([k,v]) => `${k}=${v}`).join('; ');
  }
}

async function api(method, urlPath, { body, cookies, adminToken } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookies) headers.Cookie = cookies.header();
  if (adminToken) headers['X-Admin-Token'] = adminToken;
  const res = await fetch(BASE + urlPath, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : res.headers.raw?.()['set-cookie'];
  if (cookies && setCookie) cookies.push(setCookie);
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

async function main() {
  console.log('→ snapshot data/');
  const snap = snapshot();

  console.log(`→ start server on :${PORT}`);
  const env = {
    ...process.env,
    PORT,
    ADMIN_TOKEN,
    JWT_SECRET: process.env.JWT_SECRET || 'test-jwt-secret-test-jwt-secret-test',
    NODE_ENV: 'test',
  };
  const server = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverErr = '';
  server.stderr.on('data', d => { serverErr += d.toString(); });

  const stop = async () => {
    if (!server.killed) server.kill('SIGTERM');
    await new Promise(r => server.on('exit', r));
  };

  try {
    await waitFor(`${BASE}/api/places`);
    console.log('→ server up');

    const stamp = Date.now();
    const u1 = { name: 'Alice Test',  email: `alice-${stamp}@test.local`, password: 'AlicePass123', phone: '06 11 22 33 44' };
    const u2 = { name: 'Bob Test',    email: `bob-${stamp}@test.local`,   password: 'BobPass123',   phone: '06 11 22 33 44' };
    const memberIds = [];

    console.log('\n[1] Inscription avec téléphone');
    const reg = await api('POST', '/api/auth/register', { body: { ...u1, consentGiven: true } });
    check('register 201', reg.status === 201, JSON.stringify(reg));
    check('register stocke phone normalisé', reg.body?.member?.phone === '+33611223344',
      `got phone=${reg.body?.member?.phone}`);
    if (reg.body?.member?.id) memberIds.push(reg.body.member.id);
    const u1Id = reg.body.member.id;

    console.log('\n[2] Téléphone invalide rejeté');
    const badReg = await api('POST', '/api/auth/register', {
      body: { name: 'X', email: `x-${stamp}@test.local`, password: 'XxxXxx12', phone: 'lol', consentGiven: true }
    });
    check('register 400 sur phone invalide', badReg.status === 400, JSON.stringify(badReg));

    console.log('\n[3] Approve par admin (token partagé)');
    const approve = await api('POST', `/api/admin/members/${u1Id}/approve`, { adminToken: ADMIN_TOKEN });
    check('approve 200', approve.status === 200);
    check('approve → status active', approve.body?.member?.status === 'active');

    console.log('\n[4] Login membre');
    const cookies = new Cookies();
    const login = await api('POST', '/api/auth/login', { body: { email: u1.email, password: u1.password }, cookies });
    check('login 200', login.status === 200, JSON.stringify(login));

    console.log('\n[5] GET /me → expose phone');
    const me = await api('GET', '/api/auth/me', { cookies });
    check('me 200', me.status === 200);
    check('me.phone présent', me.body?.member?.phone === '+33611223344');

    console.log('\n[6] PATCH /me → mise à jour profil');
    const patchMe = await api('PATCH', '/api/auth/me', {
      cookies,
      body: { phone: '07 99 88 77 66', name: 'Alice Modifiée' },
    });
    check('PATCH me 200', patchMe.status === 200);
    check('phone normalisé après patch', patchMe.body?.member?.phone === '+33799887766');
    check('name mis à jour', patchMe.body?.member?.name === 'Alice Modifiée');
    check('updatedAt présent', !!patchMe.body?.member?.updatedAt);

    console.log('\n[7] PATCH /me → email déjà pris ⇒ 409');
    // Crée un 2e compte (Bob) pour réserver son email
    const reg2 = await api('POST', '/api/auth/register', { body: { ...u2, consentGiven: true } });
    if (reg2.body?.member?.id) memberIds.push(reg2.body.member.id);
    const u2Id = reg2.body.member.id;
    const conflict = await api('PATCH', '/api/auth/me', { cookies, body: { email: u2.email } });
    check('email pris → 409', conflict.status === 409, JSON.stringify(conflict));

    console.log('\n[8] Doublons remontés dans GET /admin/members');
    const list = await api('GET', '/api/admin/members', { adminToken: ADMIN_TOKEN });
    check('list 200', list.status === 200);
    // Bob (06 11…) et Alice (07 99…) ont des téléphones différents maintenant
    // → on retire Alice du test précédent. Bob doit avoir aucun doublon phone.
    const bob = list.body.members.find(m => m.id === u2Id);
    check('bob présent', !!bob);
    check('bob phone normalisé', bob?.phone === '+33611223344');
    // Crée un 3e compte qui partage le téléphone de Bob → doit déclencher hint
    const u3 = { name: 'Charlie Test', email: `charlie-${stamp}@test.local`, role: 'member', phone: '0611223344' };
    const created = await api('POST', '/api/admin/members', { adminToken: ADMIN_TOKEN, body: u3 });
    check('admin POST /members 201', created.status === 201, JSON.stringify(created));
    if (created.body?.member?.id) memberIds.push(created.body.member.id);
    check('réponse contient duplicates.phone', Array.isArray(created.body?.duplicates?.phone) && created.body.duplicates.phone.length === 1,
      JSON.stringify(created.body?.duplicates));
    check('doublon détecté = bob', created.body?.duplicates?.phone?.[0]?.email === u2.email);

    const list2 = await api('GET', '/api/admin/members', { adminToken: ADMIN_TOKEN });
    const bob2 = list2.body.members.find(m => m.id === u2Id);
    check('bob a maintenant duplicateHints phone',
      bob2?.duplicateHints?.some(h => h.kind === 'phone'));

    console.log('\n[9] PATCH /admin/members/:id → admin édite');
    const adminPatch = await api('PATCH', `/api/admin/members/${u2Id}`, {
      adminToken: ADMIN_TOKEN,
      body: { name: 'Bob Édité', phone: '0102030405' },
    });
    check('admin PATCH 200', adminPatch.status === 200);
    check('admin PATCH phone normalisé', adminPatch.body?.member?.phone === '+33102030405');
    check('admin PATCH name appliqué', adminPatch.body?.member?.name === 'Bob Édité');

    console.log('\n[10] POST /me/password → change le mdp');
    const pwd = await api('POST', '/api/auth/me/password', {
      cookies,
      body: { oldPassword: u1.password, newPassword: 'NouveauMdp2026' },
    });
    check('change pwd 200', pwd.status === 200, JSON.stringify(pwd));

    const pwdBad = await api('POST', '/api/auth/me/password', {
      cookies,
      body: { oldPassword: 'wrong', newPassword: 'AutreMdp123' },
    });
    check('change pwd 401 si ancien faux', pwdBad.status === 401);

    // Re-login avec le nouveau mdp
    const cookies2 = new Cookies();
    const relog = await api('POST', '/api/auth/login', {
      body: { email: u1.email, password: 'NouveauMdp2026' }, cookies: cookies2,
    });
    check('login avec nouveau mdp', relog.status === 200);

  } catch (err) {
    console.error('ERREUR :', err.message);
    if (serverErr) console.error('STDERR serveur :', serverErr.slice(-2000));
    fail++;
  } finally {
    console.log('\n→ stop server');
    await stop();
    console.log('→ restore data/');
    restore(snap);
  }

  console.log(`\n${pass} ✓ / ${fail} ✗`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
