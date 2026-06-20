// Journalisation concise des operations sensibles/couteuses (OCR, TTS, PDF…)
// pour reperer les abus. Une ligne par appel, format greppable, ecrite sur
// la sortie standard -> capturee par systemd (journalctl -u
// memoires-cevenoles | grep '\[op\]').
//
// Choix : on logue ICI plutot que dans data/activity_log.json pour ne pas
// gonfler le JSON metier avec des operations frequentes/publiques. Le journal
// systemd est horodate, rotatif, et fait pour ca.
//
// Exemple de ligne :
//   [op] tts ip=78.x.x.x user=anon kind=story id=geo... ms=412 bytes=327713

'use strict';

function ipOf(req) {
  if (!req) return '-';
  // req.ip respecte trust proxy ; fallback sur l'en-tete si besoin.
  return req.ip || (req.headers && req.headers['x-forwarded-for']) || '-';
}

function userOf(req) {
  if (req && req.member) return req.member.id || req.member.email || 'member';
  return 'anon';
}

function fmt(v) {
  if (v === undefined || v === null) return '';
  // Pas de retours a la ligne ni d'espaces qui casseraient le format clef=val.
  return String(v).replace(/\s+/g, ' ').slice(0, 200);
}

function opLog(req, op, fields = {}) {
  const base = `ip=${fmt(ipOf(req))} user=${fmt(userOf(req))}`;
  const extra = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${fmt(v)}`)
    .join(' ');
  console.log(`[op] ${op} ${base}${extra ? ' ' + extra : ''}`);
}

module.exports = { opLog, ipOf, userOf };
