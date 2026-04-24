'use strict';

// Routes d'authentification membres.
// POST /api/auth/register  — inscription (status: pending)
// POST /api/auth/login     — connexion → cookie JWT httpOnly
// POST /api/auth/logout    — effacement du cookie
// GET  /api/auth/me        — profil du membre connecté

const express = require('express');
const { createMember, login } = require('../auth');
const { optionalAuth } = require('../middleware');

const router = express.Router();

/** Options du cookie JWT. */
const cookieOpts = () => ({
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,           // 7 jours en ms
  secure: process.env.COOKIE_SECURE === 'true',
});

// ── POST /api/auth/register ───────────────────────────────────────────────
router.post('/register', async (req, res, next) => {
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
router.post('/login', async (req, res, next) => {
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
    res.cookie('token', token, cookieOpts());
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────
router.post('/logout', (_req, res) => {
  res.clearCookie('token', { path: '/' });
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
