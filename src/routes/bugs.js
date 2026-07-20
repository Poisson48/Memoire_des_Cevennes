// Route /api/bugs : « Bug trouvé ! », le carnet de bord des membres.
// Un membre connecté signale un bug rencontré sur le site ou dépose une
// remarque. Rien n'est visible du public : toutes les routes exigent
// requireAuth('member'), et data/bugs.json est exclu du /data statique
// (voir la whitelist dans server.js).
'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { randomUUID } = require('crypto');
const { requireAuth } = require('../middleware');

const BUGS_FILE = path.join(__dirname, '..', '..', 'data', 'bugs.json');

const KINDS    = ['bug', 'remarque'];
const STATUSES = ['open', 'in-progress', 'fixed', 'wontfix'];

function str(v, maxLen = 2000) {
  return String(v ?? '').slice(0, maxLen).trim();
}

function loadBugs() {
  try { return JSON.parse(fs.readFileSync(BUGS_FILE, 'utf8')); }
  catch { return []; }
}

function saveBugs(bugs) {
  const tmp = BUGS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(bugs, null, 2) + '\n');
  fs.renameSync(tmp, BUGS_FILE);
}

// Vue renvoyée aux membres : ni l'email ni le user-agent brut des autres.
function publicView(b, me) {
  const mine = me && b.memberId === me.id;
  return {
    id: b.id,
    kind: b.kind,
    title: b.title,
    description: b.description,
    page: b.page,
    status: b.status,
    authorName: b.memberName,
    mine: !!mine,
    createdAt: b.createdAt,
    adminNote: b.adminNote || '',
    resolvedAt: b.resolvedAt || null,
  };
}

const router = express.Router();

// Liste, réservée aux membres. Ils voient tout le carnet (pas seulement
// leurs propres entrées) pour éviter les doublons et voir ce qui est déjà
// corrigé.
router.get('/', requireAuth('member'), (req, res, next) => {
  try {
    const bugs = loadBugs()
      .slice()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json({ bugs: bugs.map(b => publicView(b, req.member)) });
  } catch (err) { next(err); }
});

router.post('/', requireAuth('member'), (req, res, next) => {
  try {
    const { kind, title, description, page } = req.body || {};
    if (!str(title) || !str(description)) {
      return res.status(400).json({ error: 'Un titre et une description sont requis.' });
    }
    const bug = {
      id:          randomUUID(),
      kind:        KINDS.includes(str(kind)) ? str(kind) : 'bug',
      title:       str(title, 160),
      description: str(description, 5000),
      page:        str(page, 300) || null,
      userAgent:   str(req.get('user-agent'), 300) || null,
      memberId:    req.member.id,
      memberName:  str(req.member.name, 120) || 'Membre',
      status:      'open',
      adminNote:   '',
      createdAt:   new Date().toISOString(),
    };
    const all = loadBugs();
    all.push(bug);
    saveBugs(all);
    res.status(201).json({ ok: true, bug: publicView(bug, req.member) });
  } catch (err) { next(err); }
});

// Un membre peut retirer sa propre entrée (faute de frappe, doublon).
// Un admin peut retirer n'importe laquelle.
router.delete('/:id', requireAuth('member'), (req, res, next) => {
  try {
    const all = loadBugs();
    const i = all.findIndex(b => b.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Entrée introuvable.' });
    const isAdmin = req.member.role === 'admin';
    if (!isAdmin && all[i].memberId !== req.member.id) {
      return res.status(403).json({ error: 'Tu ne peux retirer que tes propres entrées.' });
    }
    all.splice(i, 1);
    saveBugs(all);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.loadBugs  = loadBugs;
module.exports.saveBugs  = saveBugs;
module.exports.STATUSES  = STATUSES;
module.exports.publicView = publicView;
