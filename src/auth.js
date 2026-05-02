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

/**
 * Normalise un numéro de téléphone (FR-friendly).
 * - Retire espaces, points, tirets, parenthèses.
 * - Préfixe +33 si le numéro commence par 0 (10 chiffres FR).
 * - Conserve un préfixe + déjà présent.
 * Retourne null si vide ou inanalysable.
 */
function normalizePhone(raw) {
  if (raw === undefined || raw === null) return null;
  const cleaned = String(raw).replace(/[\s.\-()]/g, '').trim();
  if (!cleaned) return null;
  if (cleaned.startsWith('+')) {
    if (!/^\+\d{6,16}$/.test(cleaned)) return null;
    return cleaned;
  }
  if (/^0\d{9}$/.test(cleaned)) return '+33' + cleaned.slice(1);
  if (/^\d{6,16}$/.test(cleaned)) return cleaned;
  return null;
}

/** Normalise un nom pour comparaison de doublons (lowercase + trim + espaces). */
function normalizeName(raw) {
  if (!raw) return '';
  return String(raw).toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Cherche les doublons potentiels parmi les membres.
 * - email : exact (case-insensitive). Doublon dur.
 * - phone : normalisé. Doublon mou (avertissement).
 * - name  : normalisé. Doublon mou.
 * Retourne { email: [...], phone: [...], name: [...] } — chaque tableau
 * contient les membres en collision (hors `excludeId`).
 */
function findDuplicates({ email, phone, name, excludeId } = {}) {
  const members = loadMembers();
  const out = { email: [], phone: [], name: [] };
  const ne = email ? String(email).toLowerCase().trim() : null;
  const np = normalizePhone(phone);
  const nn = normalizeName(name);
  for (const m of members) {
    if (excludeId && m.id === excludeId) continue;
    if (ne && m.email === ne) out.email.push(safe(m));
    if (np && normalizePhone(m.phone) === np) out.phone.push(safe(m));
    if (nn && normalizeName(m.name) === nn) out.name.push(safe(m));
  }
  return out;
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
    phone          = null,               // téléphone optionnel
  } = opts;

  if (!ROLES.includes(role)) throw new Error(`Rôle invalide : ${role}`);

  const members = loadMembers();
  const normalizedEmail = String(email).toLowerCase().trim();
  const normalizedPhone = normalizePhone(phone);

  if (members.find(m => m.email === normalizedEmail)) {
    throw new Error('Un compte existe déjà avec cet email.');
  }
  if (phone && !normalizedPhone) {
    throw new Error('Numéro de téléphone invalide.');
  }

  const passwordHash = await bcrypt.hash(String(password), SALT_ROUNDS);
  const now = new Date().toISOString();

  const member = {
    id: randomUUID(),
    name: String(name).trim().slice(0, 120),
    email: normalizedEmail,
    phone: normalizedPhone,
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
 * Crée un membre invité par un admin, sans mot de passe utilisable.
 *
 * Le `passwordHash` est stocké à chaîne vide : `bcrypt.compare(plain, '')`
 * renvoie toujours false, donc le compte ne peut pas être connecté tant
 * que le titulaire n'a pas consommé sa clé d'invitation sur reset.html
 * pour choisir lui-même son mot de passe. À aucun moment l'admin (ni
 * personne d'autre) ne connaît un mot de passe en clair.
 *
 * Le membre est créé directement en `status: "active"` (l'admin l'a déjà
 * validé en lui envoyant une invitation). La clé de couplage est créée
 * séparément via `passwordResets.createInvite`.
 */
async function createInvitedMember(email, name, opts = {}) {
  const {
    charterVersion = '1.0',
    role           = 'member',
    createdByAdmin = null,
    phone          = null,
  } = opts;

  if (!ROLES.includes(role)) throw new Error(`Rôle invalide : ${role}`);

  const members = loadMembers();
  const normalizedEmail = String(email).toLowerCase().trim();
  const normalizedPhone = normalizePhone(phone);

  if (members.find(m => m.email === normalizedEmail)) {
    throw new Error('Un compte existe déjà avec cet email.');
  }
  if (phone && !normalizedPhone) {
    throw new Error('Numéro de téléphone invalide.');
  }

  const now = new Date().toISOString();
  const member = {
    id: randomUUID(),
    name: String(name).trim().slice(0, 120),
    email: normalizedEmail,
    phone: normalizedPhone,
    passwordHash: '',                    // pas de mot de passe utilisable
    role,
    status: 'active',
    createdAt: now,
    charterAcceptedVersion: String(charterVersion),
    charterAcceptedAt:      now,
    approvedAt:             now,
  };
  if (createdByAdmin) member.createdByAdmin = createdByAdmin;

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
 * Met à jour les champs profil d'un membre (name, email, phone).
 * - email : vérifie l'unicité (case-insensitive) hors le membre lui-même.
 * - phone : normalisé (FR), null si vidé.
 * - name  : trim + max 120.
 * Tous les champs sont optionnels — seuls les champs fournis sont changés.
 * Retourne le membre safe.
 */
function updateMember(id, patch = {}) {
  const members = loadMembers();
  const member = members.find(m => m.id === id);
  if (!member) throw new Error('Membre introuvable.');

  if (patch.email !== undefined) {
    const ne = String(patch.email).toLowerCase().trim();
    if (!ne) throw new Error('Email requis.');
    if (members.find(m => m.id !== id && m.email === ne)) {
      throw new Error('Un compte existe déjà avec cet email.');
    }
    member.email = ne;
  }
  if (patch.name !== undefined) {
    const nn = String(patch.name).trim().slice(0, 120);
    if (!nn) throw new Error('Nom requis.');
    member.name = nn;
  }
  if (patch.phone !== undefined) {
    if (patch.phone === null || patch.phone === '') {
      member.phone = null;
    } else {
      const np = normalizePhone(patch.phone);
      if (!np) throw new Error('Numéro de téléphone invalide.');
      member.phone = np;
    }
  }
  member.updatedAt = new Date().toISOString();
  saveMembers(members);
  return safe(member);
}

/**
 * Change le mot de passe d'un membre, vérifie l'ancien.
 * Retourne true en cas de succès, false si l'ancien mot de passe est faux.
 */
async function changePassword(id, oldPassword, newPassword) {
  if (!newPassword || String(newPassword).length < 8) {
    throw new Error('Le nouveau mot de passe doit faire au moins 8 caractères.');
  }
  const members = loadMembers();
  const member = members.find(m => m.id === id);
  if (!member) throw new Error('Membre introuvable.');
  if (!member.passwordHash) {
    throw new Error("Ce compte n'a pas encore de mot de passe — utiliser une clé de réinitialisation.");
  }
  const ok = await bcrypt.compare(String(oldPassword || ''), member.passwordHash);
  if (!ok) return false;
  member.passwordHash = await bcrypt.hash(String(newPassword), SALT_ROUNDS);
  member.passwordChangedAt = new Date().toISOString();
  saveMembers(members);
  return true;
}

/** Retourne le membre safe par id, ou null. */
function getMemberById(id) {
  const member = loadMembers().find(m => m.id === id);
  return member ? safe(member) : null;
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
  // passwordHash vide = compte invité qui n'a pas encore activé via la clé.
  if (!member.passwordHash) return null;

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
  createInvitedMember,
  approveMember,
  setRole,
  updateMember,
  changePassword,
  getMemberById,
  findDuplicates,
  normalizePhone,
  login,
  verifyToken,
  roleIndex,
  ROLES,
  loadMembers,
  loadLog,
  logActivity,
};
