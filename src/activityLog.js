'use strict';

// Journal d'activité membres : écrit dans data/activity_log.json.

const fs   = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '../data/activity_log.json');

// La politique de confidentialite (public/legal/confidentialite.html)
// annonce 12 mois de conservation pour « ID membre, action, adresse IP,
// horodatage ». On purge donc a chaque ecriture, sinon l'engagement n'est
// pas tenu (les entrees s'accumulaient indefiniment).
const KEEP_MONTHS = 12;

function withinRetention(entry) {
  if (!entry || !entry.timestamp) return true;   // horodatage illisible : on garde
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - KEEP_MONTHS);
  const t = new Date(entry.timestamp);
  return Number.isNaN(t.getTime()) || t >= cutoff;
}

function readLog() {
  try {
    return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Ajoute une entrée dans le journal d'activité.
 *
 * @param {object} opts
 * @param {string} opts.memberId    - ID du membre authentifié
 * @param {string} opts.action      - ex. 'create'
 * @param {string} opts.entityType  - 'place' | 'person' | 'story' | 'completion'
 * @param {string} opts.entityId    - ID de l'entité concernée
 * @param {string} [opts.ip]        - adresse IP de la requête
 * @param {object} [opts.details]   - metadata libre (counts, motif, etc.)
 * @param {string} [opts.actorName] - nom lisible si memberId ne l'identifie pas
 */
function logActivity({ memberId, action, entityType, entityId, ip, details, actorName }) {
  const log = readLog();
  const entry = {
    memberId,
    action,
    entityType,
    entityId,
    timestamp: new Date().toISOString(),
    ip: ip || 'unknown',
  };
  // Nom lisible de l'auteur, stocke seulement quand il ne peut pas etre
  // deduit de memberId (jeton admin partage, contributeur non connecte).
  if (actorName) entry.actorName = String(actorName).slice(0, 120);
  if (details && typeof details === 'object') entry.details = details;
  log.push(entry);
  const kept = log.filter(withinRetention);
  // Ecriture atomique : deux requetes concurrentes ne peuvent plus laisser
  // le fichier a moitie ecrit.
  const tmp = LOG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(kept, null, 2), 'utf8');
  fs.renameSync(tmp, LOG_PATH);
}

module.exports = { logActivity, readLog, KEEP_MONTHS };
