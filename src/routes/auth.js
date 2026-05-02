'use strict';

// Routes d'authentification membres.
// POST /api/auth/register  — inscription (status: pending)
// POST /api/auth/login     — connexion → cookie JWT httpOnly
// POST /api/auth/logout    — effacement du cookie
// GET  /api/auth/me        — profil du membre connecté

const express = require('express');
const jwt = require('jsonwebtoken');
const { rateLimit } = require('express-rate-limit');
const {
  createMember,
  login,
  updateMember,
  changePassword,
  getMemberById,
  findDuplicates,
} = require('../auth');
const { optionalAuth, requireAuth } = require('../middleware');
const passwordResets = require('../passwordResets');
const activityLog = require('../activityLog');

const router = express.Router();

// ── Rate limiters ─────────────────────────────────────────────────────────
// Pour qu'ils soient corrects derrière un reverse proxy (Caddy en prod), il
// faut que le serveur Express ait `app.set("trust proxy", 1)` pour récupérer
// la vraie IP. C'est fait dans server.js si NODE_ENV=production.
//
// Limites volontairement strictes — on accepte de gêner un user honnête qui
// se trompe 5 fois plutôt que d'autoriser un brute-force en ligne.

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,            // 15 minutes
  limit: 5,                            // 5 tentatives par fenêtre
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Trop de tentatives — réessaie dans 15 minutes.' },
  // Ne compte que les échecs : si le user se connecte du premier coup,
  // ses 4 essais "réussis" précédents (en SSO multi-onglets par ex.) ne
  // déclenchent pas le verrou.
  skipSuccessfulRequests: true,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,            // 1 heure
  limit: 5,                            // 5 inscriptions max / IP / heure
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Trop d\'inscriptions depuis cette adresse — réessaie plus tard.' },
});

// Demande "mot de passe oublié" — rare, manuel côté admin. On limite
// surtout pour empêcher un script de polluer la file de modération.
const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,            // 1 heure
  limit: 5,                            // 5 demandes max / IP / heure
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Trop de demandes — réessaie plus tard.' },
});

// Tentatives de saisie d'une clé de réinitialisation. Plus généreux que
// le login (l'utilisateur peut se tromper en recopiant), mais brute-force
// d'un secret 60-bit est de toute façon hors de portée à 20/h.
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Trop de tentatives — réessaie dans 15 minutes.' },
});

/** Options du cookie JWT. */
const cookieOpts = () => ({
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,           // 7 jours en ms
  secure: process.env.COOKIE_SECURE === 'true',
});

// ── POST /api/auth/register ───────────────────────────────────────────────
router.post('/register', registerLimiter, async (req, res, next) => {
  try {
    const { name, email, password, phone, consentGiven } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email et password sont requis.' });
    }
    if (consentGiven !== true) {
      return res.status(400).json({ error: 'Tu dois accepter la charte et la politique de confidentialité.' });
    }
    const member = await createMember(email, password, name, {
      charterVersion: '1.0',
      phone: phone || null,
    });
    res.status(201).json({
      ok: true,
      member,
      message: 'Inscription enregistrée — en attente de validation par un administrateur.',
    });
  } catch (err) {
    if (err.message.includes('existe déjà')) {
      return res.status(409).json({ error: err.message });
    }
    if (err.message.includes('téléphone')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────
// Login membre — refuse les comptes admin (séparation des deux espaces).
// Les admins se connectent via /admin.html avec X-Admin-Token, ou via
// /api/auth/admin-login s'ils veulent leur cookie JWT admin.
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email et password sont requis.' });
    }
    const token = await login(email, password);
    if (!token) {
      return res.status(401).json({
        error: 'Identifiants invalides ou compte non approuvé.',
      });
    }
    const payload = jwt.decode(token);
    if (payload && payload.role === 'admin') {
      return res.status(403).json({
        error: 'Compte administrateur — connecte-toi via /admin.html',
        adminLoginUrl: '/admin.html',
      });
    }
    res.cookie('token', token, cookieOpts());
    res.json({ ok: true, role: payload && payload.role });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/admin-login ────────────────────────────────────────────
// Login admin par email + mot de passe. N'accepte QUE role==admin.
// Pose un cookie séparé "admin_jwt" pour que les sessions ne se mélangent pas.
router.post('/admin-login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email et password sont requis.' });
    }
    const token = await login(email, password);
    if (!token) {
      return res.status(401).json({ error: 'Identifiants invalides ou compte non approuvé.' });
    }
    const payload = jwt.decode(token);
    if (!payload || payload.role !== 'admin') {
      return res.status(403).json({ error: "Ce compte n'a pas le rôle administrateur." });
    }
    // Double cookie : un admin est techniquement aussi un membre — il peut
    // contribuer comme un contributeur. On pose donc admin_jwt (pour les
    // routes /api/admin/*) ET token (pour optionalAuth / requireAuth sur
    // les routes membres).
    res.cookie('admin_jwt', token, cookieOpts());
    res.cookie('token',     token, cookieOpts());
    res.json({ ok: true, member: { id: payload.sub, email: payload.email, name: payload.name, role: payload.role } });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────
router.post('/logout', (_req, res) => {
  res.clearCookie('token',     { path: '/' });
  res.clearCookie('admin_jwt', { path: '/' });
  res.json({ ok: true });
});

// ── POST /api/auth/forgot ─────────────────────────────────────────────────
// Soumet une demande de réinitialisation. Toujours répondre 200 (anti-
// énumération de comptes). L'admin verra la demande dans la file et
// décidera si elle est légitime — la vérification d'identité se fait
// hors-ligne (téléphone, en personne…).
router.post('/forgot', forgotLimiter, async (req, res, next) => {
  try {
    const { email, name, message } = req.body || {};
    if (!email || String(email).length > 200) {
      // Réponse identique au cas nominal pour ne pas révéler la validation.
      return res.json({ ok: true });
    }
    const request = passwordResets.createRequest({
      email,
      name,
      message,
      ip: req.ip,
    });
    activityLog.logActivity({
      memberId: request.memberId || null,
      action: 'password-reset.request',
      entityType: 'password-reset',
      entityId: request.id,
      ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    // Même en erreur interne, on ne donne pas de signal — log côté serveur.
    console.error('[forgot]', err.message);
    res.json({ ok: true });
  }
});

// ── POST /api/auth/reset ──────────────────────────────────────────────────
// Le membre saisit la clé reçue de l'admin + son nouveau mot de passe.
// Réponse générique en cas d'échec : la clé est invalide, expirée, ou
// déjà consommée — on ne dit pas laquelle.
router.post('/reset', resetLimiter, async (req, res, next) => {
  try {
    const { key, password } = req.body || {};
    if (!key || !password) {
      return res.status(400).json({ error: 'Clé et nouveau mot de passe requis.' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères.' });
    }
    const result = await passwordResets.consume(key, password);
    if (!result.ok) {
      return res.status(400).json({ error: 'Clé invalide, expirée ou déjà utilisée.' });
    }
    activityLog.logActivity({
      memberId: result.memberId,
      action: 'password-reset.consume',
      entityType: 'member',
      entityId: result.memberId,
      ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────
// Renvoie le profil complet (depuis members.json), pas seulement le payload
// du JWT — pour exposer phone, updatedAt, etc. mis à jour après émission
// du token.
router.get('/me', optionalAuth, (req, res) => {
  if (!req.member) {
    return res.status(401).json({ error: 'Non authentifié.' });
  }
  const fresh = getMemberById(req.member.id);
  if (!fresh) {
    return res.status(401).json({ error: 'Compte introuvable.' });
  }
  res.json({ member: fresh });
});

// ── PATCH /api/auth/me ────────────────────────────────────────────────────
// Le membre connecté met à jour son nom, email et/ou téléphone.
// Vérifie l'unicité de l'email et signale les doublons mous (phone, name).
router.patch('/me', requireAuth('member'), (req, res, next) => {
  try {
    const { name, email, phone } = req.body || {};
    const patch = {};
    if (name  !== undefined) patch.name  = name;
    if (email !== undefined) patch.email = email;
    if (phone !== undefined) patch.phone = phone;
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });
    }
    const member = updateMember(req.member.id, patch);
    activityLog.logActivity({
      memberId: member.id,
      action: 'member.self-update',
      entityType: 'member',
      entityId: member.id,
      ip: req.ip,
    });
    const dups = findDuplicates({
      phone: member.phone,
      name:  member.name,
      excludeId: member.id,
    });
    res.json({
      ok: true,
      member,
      duplicates: {
        phone: dups.phone.map(m => ({ id: m.id, name: m.name, email: m.email })),
        name:  dups.name.map(m  => ({ id: m.id, name: m.name, email: m.email })),
      },
    });
  } catch (err) {
    if (err.message.includes('existe déjà')) {
      return res.status(409).json({ error: err.message });
    }
    if (/téléphone|requis/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// ── POST /api/auth/me/password ────────────────────────────────────────────
// Le membre connecté change son mot de passe en saisissant l'ancien.
router.post('/me/password', requireAuth('member'), async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Ancien et nouveau mot de passe requis.' });
    }
    const ok = await changePassword(req.member.id, oldPassword, newPassword);
    if (!ok) {
      return res.status(401).json({ error: 'Ancien mot de passe incorrect.' });
    }
    activityLog.logActivity({
      memberId: req.member.id,
      action: 'member.password-change',
      entityType: 'member',
      entityId: req.member.id,
      ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    if (/8 caractères|réinitialisation/.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
