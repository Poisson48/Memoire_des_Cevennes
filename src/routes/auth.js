'use strict';

// Routes d'authentification membres.
// POST /api/auth/register  — inscription (status: pending)
// POST /api/auth/login     — connexion → cookie JWT httpOnly
// POST /api/auth/logout    — effacement du cookie
// GET  /api/auth/me        — profil du membre connecté

const express = require('express');
const jwt = require('jsonwebtoken');
const { rateLimit } = require('express-rate-limit');
const { createMember, login } = require('../auth');
const { optionalAuth } = require('../middleware');

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
    const { name, email, password, consentGiven } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email et password sont requis.' });
    }
    if (consentGiven !== true) {
      return res.status(400).json({ error: 'Tu dois accepter la charte et la politique de confidentialité.' });
    }
    const member = await createMember(email, password, name, { charterVersion: '1.0' });
    res.status(201).json({
      ok: true,
      member,
      message: 'Inscription enregistrée — en attente de validation par un administrateur.',
    });
  } catch (err) {
    if (err.message.includes('existe déjà')) {
      return res.status(409).json({ error: err.message });
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
    res.cookie('admin_jwt', token, cookieOpts());
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

// ── GET /api/auth/me ──────────────────────────────────────────────────────
router.get('/me', optionalAuth, (req, res) => {
  if (!req.member) {
    return res.status(401).json({ error: 'Non authentifié.' });
  }
  res.json({ member: req.member });
});

module.exports = router;
