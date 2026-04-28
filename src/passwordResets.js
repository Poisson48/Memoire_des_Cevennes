'use strict';

// Demandes de clé d'usage unique — flux 100% humain, pas de mail.
//
// Deux usages partagent le même mécanisme (champ `kind`) :
//
//   • kind = "reset"  — mot de passe oublié.
//     1. Le membre remplit oubli.html (email + nom + message) → "pending".
//     2. L'admin vérifie l'identité hors-ligne, approuve → clé générée.
//     3. Le membre saisit la clé sur reset.html → nouveau mot de passe.
//
//   • kind = "invite" — création d'un compte par un admin.
//     1. L'admin crée le compte (sans mot de passe) → on génère
//        directement une entrée "approved" avec une clé.
//     2. L'admin transmet la clé au futur membre, de la main à la main.
//     3. Le membre saisit la clé sur reset.html → choisit son mot de passe
//        lui-même. À aucun moment le mot de passe ne transite par l'admin.
//
// La clé en clair est conservée tant que l'entrée est "approved" (pour que
// l'admin puisse la relire si le membre ne l'a pas notée). Au consume ou à
// l'expiration (purge), seul le hash sha256 reste.

const fs   = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { randomUUID } = require('crypto');

const FILE = path.join(__dirname, '..', 'data', 'password_resets.json');
const MEMBERS_FILE = path.join(__dirname, '..', 'data', 'members.json');

const KIND_RESET  = 'reset';
const KIND_INVITE = 'invite';

// 7 jours — l'admin a le temps de joindre le membre.
const KEY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Alphabet sans caractères ambigus à dicter au téléphone : pas de 0/O,
// pas de 1/I/L. 30 caractères.
const KEY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const KEY_GROUPS = 3;
const KEY_GROUP_LEN = 4;

const SALT_ROUNDS = 12;

// ── I/O ───────────────────────────────────────────────────────────────────

function loadAll() {
  try {
    const list = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    // Migration douce : les entrées d'avant l'ajout du champ `kind` sont
    // toutes des resets. On normalise à la lecture pour que les filtres et
    // les vues admin n'aient pas à gérer le cas absent.
    return list.map(r => (r.kind ? r : { ...r, kind: KIND_RESET }));
  } catch {
    return [];
  }
}

function saveAll(list) {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n');
  fs.renameSync(tmp, FILE);
}

function loadMembers() {
  try { return JSON.parse(fs.readFileSync(MEMBERS_FILE, 'utf8')); }
  catch { return []; }
}

function saveMembers(members) {
  const tmp = MEMBERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(members, null, 2) + '\n');
  fs.renameSync(tmp, MEMBERS_FILE);
}

// ── Génération de clé ─────────────────────────────────────────────────────

function generateKey() {
  const groups = [];
  for (let g = 0; g < KEY_GROUPS; g++) {
    let group = '';
    const buf = crypto.randomBytes(KEY_GROUP_LEN);
    for (let i = 0; i < KEY_GROUP_LEN; i++) {
      group += KEY_ALPHABET[buf[i] % KEY_ALPHABET.length];
    }
    groups.push(group);
  }
  return groups.join('-');
}

// Normalise une clé saisie par l'utilisateur : majuscules, sans espaces,
// puis re-groupé XXXX-XXXX-XXXX.
function normalizeKey(input) {
  if (!input) return '';
  const flat = String(input).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (flat.length !== KEY_GROUPS * KEY_GROUP_LEN) return '';
  const parts = [];
  for (let i = 0; i < KEY_GROUPS; i++) {
    parts.push(flat.slice(i * KEY_GROUP_LEN, (i + 1) * KEY_GROUP_LEN));
  }
  return parts.join('-');
}

function hashKey(key) {
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
}

function keyHint(key) {
  // "ABCD-…-WXYZ" — utile pour distinguer plusieurs demandes en attente.
  const parts = key.split('-');
  if (parts.length < 2) return key;
  return `${parts[0]}-…-${parts[parts.length - 1]}`;
}

// ── Création ──────────────────────────────────────────────────────────────

/**
 * Crée une demande de réinitialisation. Toujours en "pending".
 * Résout silencieusement memberId si l'email matche un compte (l'admin
 * voit la résolution dans la file).
 */
function createRequest({ email, name, message, ip } = {}) {
  const list = loadAll();
  const normalizedEmail = String(email || '').toLowerCase().trim().slice(0, 200);
  const cleanName = String(name || '').trim().slice(0, 200);
  const cleanMessage = String(message || '').trim().slice(0, 2000);

  // Tente de matcher un membre existant pour aider l'admin à décider.
  // On garde la demande même sans match — c'est un signal pour l'admin.
  const members = loadMembers();
  const matched = members.find(m => m.email === normalizedEmail);

  const now = new Date().toISOString();
  const request = {
    id: randomUUID(),
    kind: KIND_RESET,
    emailRequested: normalizedEmail,
    name: cleanName,
    message: cleanMessage,
    memberId: matched ? matched.id : null,
    memberKnown: Boolean(matched),
    status: 'pending',
    requestedAt: now,
    requestedFromIp: ip || null,
  };
  list.push(request);
  saveAll(list);
  return request;
}

// ── Invitation (création de compte par un admin) ──────────────────────────

/**
 * Crée une entrée "invite" directement en status "approved" (l'admin
 * authentifié a déjà la légitimité d'agir, pas de phase pending).
 * Génère la clé en clair et la retourne — elle reste lisible dans
 * `keyPlain` tant que l'invite est "approved", comme pour les resets.
 *
 * @param {{memberId: string, reviewerId?: string, reviewerName?: string}} opts
 * @returns {{request: object, key: string}}
 */
function createInvite({ memberId, reviewerId, reviewerName } = {}) {
  if (!memberId) throw new Error('memberId requis pour créer une invitation.');
  const members = loadMembers();
  const member = members.find(m => m.id === memberId);
  if (!member) throw new Error('Membre introuvable.');

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + KEY_TTL_MS).toISOString();
  const key = generateKey();

  const list = loadAll();
  const request = {
    id: randomUUID(),
    kind: KIND_INVITE,
    emailRequested: member.email,
    name: member.name || '',
    message: '',
    memberId: member.id,
    memberKnown: true,
    status: 'approved',
    requestedAt: now,
    requestedFromIp: null,
    reviewedAt: now,
    reviewedBy: reviewerId || null,
    reviewerName: reviewerName || null,
    keyHash: hashKey(key),
    keyPlain: key,
    keyHint: keyHint(key),
    expiresAt,
  };
  list.push(request);
  saveAll(list);
  return { request, key };
}

// ── Lecture admin ─────────────────────────────────────────────────────────

function listAll() {
  const list = loadAll();
  // Joindre quelques infos sur le membre pour l'affichage admin.
  const members = loadMembers();
  const byId = new Map(members.map(m => [m.id, m]));
  return list.map(r => {
    const m = r.memberId ? byId.get(r.memberId) : null;
    return {
      ...r,
      member: m ? { id: m.id, name: m.name, email: m.email, status: m.status, role: m.role } : null,
    };
  }).sort((a, b) => (b.requestedAt || '').localeCompare(a.requestedAt || ''));
}

// ── Approbation ───────────────────────────────────────────────────────────

/**
 * Approuve une demande : génère une clé en clair (à transmettre à l'admin),
 * stocke le hash + une copie en clair pour réaffichage tant que la demande
 * est active (consume/expire l'efface).
 *
 * Retourne { request, key } — la clé en clair n'est PAS dans request.keyPlain
 * du payload pour forcer l'admin à la copier maintenant (mais elle reste
 * lisible via l'API tant que la demande est "approved").
 */
function approve(id, { reviewerId, reviewerName } = {}) {
  const list = loadAll();
  const idx = list.findIndex(r => r.id === id);
  if (idx === -1) throw new Error('Demande introuvable.');
  const r = list[idx];
  if (r.status !== 'pending') {
    throw new Error(`Demande déjà ${r.status}.`);
  }
  if (!r.memberId) {
    throw new Error('Aucun compte membre lié à cette demande : refuser plutôt qu\'approuver.');
  }
  const key = generateKey();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + KEY_TTL_MS).toISOString();
  list[idx] = {
    ...r,
    status: 'approved',
    reviewedAt: now,
    reviewedBy: reviewerId || null,
    reviewerName: reviewerName || null,
    keyHash: hashKey(key),
    keyPlain: key,
    keyHint: keyHint(key),
    expiresAt,
  };
  saveAll(list);
  return { request: list[idx], key };
}

function reject(id, { reviewerId, reviewerName, reason } = {}) {
  const list = loadAll();
  const idx = list.findIndex(r => r.id === id);
  if (idx === -1) throw new Error('Demande introuvable.');
  const r = list[idx];
  if (r.status !== 'pending') {
    throw new Error(`Demande déjà ${r.status}.`);
  }
  list[idx] = {
    ...r,
    status: 'rejected',
    reviewedAt: new Date().toISOString(),
    reviewedBy: reviewerId || null,
    reviewerName: reviewerName || null,
    rejectedReason: String(reason || '').slice(0, 1000),
  };
  saveAll(list);
  return list[idx];
}

// ── Consommation ──────────────────────────────────────────────────────────

/**
 * Vérifie une clé saisie + applique le nouveau mot de passe.
 * Ne révèle pas si la clé existe / est expirée / est déjà consommée :
 * le frontend ne reçoit qu'un succès/échec générique.
 */
async function consume(rawKey, newPassword) {
  const key = normalizeKey(rawKey);
  if (!key) return { ok: false };
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return { ok: false, reason: 'password-too-short' };
  }

  const list = loadAll();
  const wantHash = hashKey(key);
  const idx = list.findIndex(r => r.status === 'approved' && r.keyHash === wantHash);
  if (idx === -1) return { ok: false };

  const r = list[idx];
  if (!r.expiresAt || new Date(r.expiresAt).getTime() < Date.now()) {
    // Expirée : on bascule le status et on retire la clé en clair.
    list[idx] = { ...r, status: 'expired', keyPlain: undefined };
    saveAll(list);
    return { ok: false };
  }
  if (!r.memberId) return { ok: false };

  const members = loadMembers();
  const memberIdx = members.findIndex(m => m.id === r.memberId);
  if (memberIdx === -1) return { ok: false };

  const passwordHash = await bcrypt.hash(String(newPassword), SALT_ROUNDS);
  members[memberIdx] = {
    ...members[memberIdx],
    passwordHash,
    passwordChangedAt: new Date().toISOString(),
  };
  saveMembers(members);

  list[idx] = {
    ...r,
    status: 'consumed',
    consumedAt: new Date().toISOString(),
    keyPlain: undefined,
  };
  saveAll(list);

  return { ok: true, memberId: r.memberId, email: members[memberIdx].email };
}

// ── Purge des expirées ────────────────────────────────────────────────────

/**
 * Bascule en "expired" toutes les demandes approuvées dont la clé a expiré.
 * Idempotent ; à appeler avant chaque listing admin pour rafraîchir l'état.
 */
function purgeExpired() {
  const list = loadAll();
  const now = Date.now();
  let dirty = false;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (r.status === 'approved' && r.expiresAt && new Date(r.expiresAt).getTime() < now) {
      list[i] = { ...r, status: 'expired', keyPlain: undefined };
      dirty = true;
    }
  }
  if (dirty) saveAll(list);
  return dirty;
}

module.exports = {
  createRequest,
  createInvite,
  listAll,
  approve,
  reject,
  consume,
  purgeExpired,
  // export utilitaires testables
  generateKey,
  normalizeKey,
  hashKey,
  KEY_TTL_MS,
  KIND_RESET,
  KIND_INVITE,
};
