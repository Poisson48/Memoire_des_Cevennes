// Route /api/reports — signalement de contenu par un visiteur.
// POST anonyme (pas d'auth requise), écrit dans data/reports.json en file.
// Les signalements sont relus depuis la page admin.
'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { randomUUID } = require('crypto');

const REPORTS_FILE = path.join(__dirname, '..', '..', 'data', 'reports.json');

function str(v, maxLen = 2000) {
  return String(v ?? '').slice(0, maxLen).trim();
}

function loadReports() {
  try { return JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8')); }
  catch { return []; }
}

function saveReports(reports) {
  const tmp = REPORTS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(reports, null, 2) + '\n');
  fs.renameSync(tmp, REPORTS_FILE);
}

const router = express.Router();

router.post('/', (req, res, next) => {
  try {
    const { target, category, description, name, email } = req.body || {};
    if (!str(target) || !str(category) || !str(description)) {
      return res.status(400).json({ error: 'target, category et description sont requis.' });
    }
    const report = {
      id: randomUUID(),
      target:      str(target, 500),
      category:    str(category, 40),
      description: str(description, 5000),
      name:        str(name, 120)  || null,
      email:       str(email, 160) || null,
      ip:          req.ip,
      status:      'open',
      receivedAt:  new Date().toISOString(),
    };
    const all = loadReports();
    all.push(report);
    saveReports(all);
    res.status(201).json({
      ok: true,
      id: report.id,
      message: 'Signalement enregistré — nous revenons vers vous sous 72 h ouvrées.',
    });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.loadReports = loadReports;
module.exports.saveReports = saveReports;
