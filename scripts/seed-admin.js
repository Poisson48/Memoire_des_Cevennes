#!/usr/bin/env node
// Crée (ou réinitialise) le premier membre admin.
// Sans ce seed, personne ne peut jamais approuver une inscription → deadlock.
//
// Usage :
//   node scripts/seed-admin.js
//   SEED_EMAIL=me@asso.fr SEED_PASSWORD=... SEED_NAME="Mon Nom" node scripts/seed-admin.js
//
// Si les variables d'env ne sont pas fournies, le script les demande en
// interactif. Si un admin existe déjà avec le même email, il est réinitialisé
// (rôle admin, status active, nouveau mot de passe).

'use strict';

const fs   = require('fs');
const path = require('path');
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');

const MEMBERS_FILE = path.join(__dirname, '..', 'data', 'members.json');
const SALT_ROUNDS = 12;

function loadMembers() {
  try { return JSON.parse(fs.readFileSync(MEMBERS_FILE, 'utf8')); }
  catch { return []; }
}

function saveMembers(members) {
  const tmp = MEMBERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(members, null, 2) + '\n');
  fs.renameSync(tmp, MEMBERS_FILE);
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) {
      // Masque la saisie pour le mot de passe.
      const stdin = process.openStdin();
      process.stdin.on('data', char => {
        char = char.toString('utf8');
        if (['\n', '\r', ''].includes(char)) { stdin.pause(); }
        else process.stdout.write('\x1b[2K\x1b[200D' + question + '*'.repeat(rl.line.length));
      });
    }
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

(async () => {
  const email    = process.env.SEED_EMAIL    || await ask('Email admin : ');
  const name     = process.env.SEED_NAME     || await ask('Nom affiché : ');
  const password = process.env.SEED_PASSWORD || await ask('Mot de passe : ', { hidden: true });

  if (!email || !password || !name) {
    console.error('✖ email, nom et mot de passe sont obligatoires.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('✖ le mot de passe doit faire au moins 8 caractères.');
    process.exit(1);
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  const members = loadMembers();
  const existing = members.find(m => m.email === normalizedEmail);
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const now = new Date().toISOString();

  if (existing) {
    existing.name = name;
    existing.passwordHash = passwordHash;
    existing.role = 'admin';
    existing.status = 'active';
    existing.approvedAt = existing.approvedAt || now;
    console.log(`✎ membre existant "${normalizedEmail}" réinitialisé → admin active.`);
  } else {
    members.push({
      id: randomUUID(),
      name: String(name).trim().slice(0, 120),
      email: normalizedEmail,
      passwordHash,
      role: 'admin',
      status: 'active',
      createdAt: now,
      approvedAt: now,
    });
    console.log(`✎ nouveau membre admin créé : ${normalizedEmail}`);
  }

  saveMembers(members);
  console.log(`✓ data/members.json mis à jour (${members.length} membre(s) au total).`);
  console.log('Tu peux maintenant te connecter sur /login.html.');
})();
