// Journalisation des operations sensibles/couteuses (OCR, TTS, PDF…) pour
// reperer les abus. Chaque appel ecrit :
//   1. une ligne greppable sur la sortie standard -> journal systemd ;
//   2. une ligne JSON dans data/op_log.jsonl -> consultable depuis l'admin
//      (onglet « Operations »).
//
// On garde ca SEPARE de data/activity_log.json (audit metier) : ces
// operations sont frequentes/publiques (TTS, PDF) et gonfleraient l'audit.
//
// Le fichier est borne : au-dela de KEEP_LINES, on ne garde que les plus
// recentes (rotation paresseuse, faite a la lecture).

'use strict';

const fs = require('fs');
const path = require('path');

const OP_LOG = path.join(__dirname, '..', 'data', 'op_log.jsonl');
const KEEP_LINES = 5000;

function ipOf(req) {
  if (!req) return '-';
  return req.ip || (req.headers && req.headers['x-forwarded-for']) || '-';
}

function userOf(req) {
  if (req && req.member) return req.member.id || req.member.email || 'member';
  return 'anon';
}

function fmt(v) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/\s+/g, ' ').slice(0, 200);
}

function opLog(req, op, fields = {}) {
  const ip = fmt(ipOf(req));
  const user = fmt(userOf(req));

  // 1. Journal systemd (greppable).
  const extra = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${fmt(v)}`)
    .join(' ');
  console.log(`[op] ${op} ip=${ip} user=${user}${extra ? ' ' + extra : ''}`);

  // 2. Fichier JSONL pour l'admin (best effort, async, ne bloque jamais).
  const entry = { ts: new Date().toISOString(), op, ip, user, ...fields };
  fs.appendFile(OP_LOG, JSON.stringify(entry) + '\n', () => {});
}

// Lit les dernieres operations (plus recentes d'abord). Effectue une
// rotation paresseuse si le fichier a trop grossi.
function readOps({ limit = 300 } = {}) {
  let lines;
  try {
    lines = fs.readFileSync(OP_LOG, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
  if (lines.length > KEEP_LINES + 1000) {
    const trimmed = lines.slice(-KEEP_LINES);
    try { fs.writeFileSync(OP_LOG, trimmed.join('\n') + '\n'); } catch {}
    lines = trimmed;
  }
  const recent = lines.slice(-Math.max(1, Math.min(limit, KEEP_LINES))).reverse();
  return recent.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

module.exports = { opLog, readOps, ipOf, userOf };
