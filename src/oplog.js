// Journalisation des operations sensibles/couteuses (OCR, TTS, PDF…) pour
// reperer les abus. Chaque appel ecrit :
//   1. une ligne greppable sur la sortie standard -> journal systemd ;
//   2. une ligne JSON dans data/op_log.jsonl -> consultable depuis l'admin
//      (onglet « Operations »).
//
// On garde ca SEPARE de data/activity_log.json (audit metier) : ces
// operations sont frequentes/publiques (TTS, PDF) et gonfleraient l'audit.
//
// Le fichier est borne DANS LE TEMPS, pas en nombre de lignes : les
// entrees contiennent des adresses IP, donc la duree de conservation est
// ce qui compte pour le RGPD. Une borne en lignes ne garantissait rien (un
// site peu frequente aurait garde des IP pendant des annees). On aligne
// donc sur la meme duree que l'audit metier : voir KEEP_MONTHS dans
// src/activityLog.js, et la politique de confidentialite qui l'annonce.
// Rotation paresseuse, faite a la lecture.

'use strict';

const fs = require('fs');
const path = require('path');

const OP_LOG = path.join(__dirname, '..', 'data', 'op_log.jsonl');
const { KEEP_MONTHS } = require('./activityLog');

// Garde-fou volume : purement anti-emballement (fichier qui exploserait
// entre deux purges), pas une politique de conservation.
const MAX_LINES = 200000;

function cutoffDate() {
  const d = new Date();
  d.setMonth(d.getMonth() - KEEP_MONTHS);
  return d;
}

/** true si l'entree est dans la fenetre de conservation. */
function withinRetention(line) {
  const i = line.indexOf('"ts":"');
  if (i === -1) return true;                       // ligne illisible : on garde
  const ts = line.slice(i + 6, line.indexOf('"', i + 6));
  const t = new Date(ts);
  return Number.isNaN(t.getTime()) || t >= cutoffDate();
}

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
  // Purge par anciennete. On ne reecrit le fichier que si quelque chose a
  // reellement ete retire, pour ne pas le reserialiser a chaque lecture.
  const kept = lines.filter(withinRetention);
  const capped = kept.length > MAX_LINES ? kept.slice(-MAX_LINES) : kept;
  if (capped.length !== lines.length) {
    try { fs.writeFileSync(OP_LOG, capped.length ? capped.join('\n') + '\n' : ''); } catch {}
    lines = capped;
  }
  const recent = lines.slice(-Math.max(1, limit)).reverse();
  return recent.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

module.exports = { opLog, readOps, ipOf, userOf, KEEP_MONTHS };
