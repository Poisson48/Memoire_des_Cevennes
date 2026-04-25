'use strict';

const fs   = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { randomUUID } = require('crypto');

const MEMBERS_FILE = path.join(__dirname, '..', 'data', 'members.json');
const LOG_FILE     = path.join(__dirname, '..', 'data', 'activity_log.json');

// Hiérarchie des rôles : member < contributor < admin
const ROLES = ['member', 'contributor', 'admin'];
const SALT_ROUNDS = 12;

// ── Lecture / écriture ────────────────────────────────────────────────────

function loadMembers() {
  try {
    return JSON.parse(fs.readFileSync(MEMBERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveMembers(members) {
  const tmp = MEMBERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(members, null, 2) + '\n');
  fs.renameSync(tmp, MEMBERS_FILE);
}

function loadLog() {
  try {
    return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveLog(entries) {
  const tmp = LOG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2) + '\n');
  fs.renameSync(tmp, LOG_FILE);
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Retourne une copie du membre sans le hash de mot de passe. */
function safe(member) {
  const { passwordHash: _, ...rest } = member;
  return rest;
}

// ── Gestion des membres ───────────────────────────────────────────────────

/**
 * Crée un nouveau membre (status: "pending").
 * Lance une erreur si l'email est déjà utilisé.
 */
async function createMember(email, password, name, opts = {}) {
  const {
    charterVersion = '1.0',
    role           = 'member',          // par défaut self-register → "member"
    status         = 'pending',          // par défaut self-register → "pending"
    createdByAdmin = null,               // id admin qui a créé le compte
  } = opts;

  if (!ROLES.includes(role)) throw new Error(`Rôle invalide : ${role}`);

  const members = loadMembers();
  const normalizedEmail = String(email).toLowerCase().trim();

  if (members.find(m => m.email === normalizedEmail)) {
    throw new Error('Un compte existe déjà avec cet email.');
  }

  const passwordHash = await bcrypt.hash(String(password), SALT_ROUNDS);
  const now = new Date().toISOString();

  const member = {
    id: randomUUID(),
    name: String(name).trim().slice(0, 120),
    email: normalizedEmail,
    passwordHash,
    role,
    status,
    createdAt: now,
    charterAcceptedVersion: String(charterVersion),
    charterAcceptedAt:      now,
  };
  if (status === 'active') member.approvedAt = now;
  if (createdByAdmin)      member.createdByAdmin = createdByAdmin;

  members.push(member);
  saveMembers(members);
  return safe(member);
}

/**
 * Passe un membre de "pending" à "active".
 */
function approveMember(id) {
  const members = loadMembers();
  const member = members.find(m => m.id === id);
  if (!member) throw new Error('Membre introuvable.');
  member.status = 'active';
  member.approvedAt = new Date().toISOString();
  saveMembers(members);
  return safe(member);
}

/**
 * Change le rôle d'un membre.
 * Rôles valides : member | contributor | admin.
 */
function setRole(id, role) {
  if (!ROLES.includes(role)) throw new Error(`Rôle invalide : ${role}`);
  const members = loadMembers();
  const member = members.find(m => m.id === id);
  if (!member) throw new Error('Membre introuvable.');
  member.role = role;
  saveMembers(members);
  return safe(member);
}

// ── Authentification ──────────────────────────────────────────────────────

/**
 * Tente de connecter un membre.
 * Retourne un JWT signé HS256 (string) si succès, null sinon.
 */
async function login(email, password) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET non défini.');

  const members = loadMembers();
  const normalizedEmail = String(email).toLowerCase().trim();
  const member = members.find(m => m.email === normalizedEmail);

  if (!member || member.status !== 'active') return null;

  const ok = await bcrypt.compare(String(password), member.passwordHash);
  if (!ok) return null;

  const payload = {
    sub:   member.id,
    email: member.email,
    name:  member.name,
    role:  member.role,
  };

  return jwt.sign(payload, secret, { expiresIn: '7d', algorithm: 'HS256' });
}

/**
 * Vérifie un JWT et retourne le payload décodé, ou null si invalide/expiré.
 */
function verifyToken(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    return jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
}

// ── Rôles ─────────────────────────────────────────────────────────────────

/**
 * Indice numérique du rôle dans la hiérarchie (plus grand = plus de droits).
 * Retourne -1 si le rôle est inconnu.
 */
function roleIndex(role) {
  return ROLES.indexOf(role);
}

// ── Journal d'activité ────────────────────────────────────────────────────

/**
 * Enregistre une action dans data/activity_log.json.
 * @param {{ memberId, action, entityType, entityId, ip }} opts
 */
function logActivity({ memberId, action, entityType, entityId, ip }) {
  const log = loadLog();
  log.push({
    memberId:   memberId   || null,
    action:     String(action),
    entityType: entityType || null,
    entityId:   entityId   || null,
    timestamp:  new Date().toISOString(),
    ip:         ip         || null,
  });
  saveLog(log);
}

module.exports = {
  createMember,
  approveMember,
  setRole,
  login,
  verifyToken,
  roleIndex,
  ROLES,
  loadMembers,
  loadLog,
  logActivity,
};
