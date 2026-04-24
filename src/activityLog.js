'use strict';

// Journal d'activité membres — écrit dans data/activity_log.json.

const fs   = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '../data/activity_log.json');

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
 */
function logActivity({ memberId, action, entityType, entityId, ip }) {
  const log = readLog();
  log.push({
    memberId,
    action,
    entityType,
    entityId,
    timestamp: new Date().toISOString(),
    ip: ip || 'unknown',
  });
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2), 'utf8');
}

module.exports = { logActivity, readLog };
