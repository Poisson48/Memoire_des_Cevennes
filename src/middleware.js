'use strict';

// Middlewares partagés : auth admin, auth membre JWT, gestionnaire d'erreur.

const { verifyToken, roleIndex } = require('./auth');

// Normalise le payload JWT pour exposer à la fois .id (convention projet)
// et .sub (convention JWT). Retourne null si le payload est absent/invalide.
function normalizeMember(payload) {
  if (!payload) return null;
  return { ...payload, id: payload.sub || payload.id };
}

const ADMIN_TOKEN = () => process.env.ADMIN_TOKEN || '';

// ── Admin (compat X-Admin-Token) ──────────────────────────────────────────

function requireAdmin(req, res, next) {
  // 1) Compte admin via cookie admin_jwt (séparé du cookie membre "token")
  const cookieHeader = req.header('cookie') || '';
  const adminJwtPart = cookieHeader.split(';').map(s => s.trim())
    .find(s => s.startsWith('admin_jwt='));
  const adminJwt = adminJwtPart ? decodeURIComponent(adminJwtPart.slice('admin_jwt='.length)) : '';
  if (adminJwt) {
    const payload = verifyToken(adminJwt);
    if (payload && payload.role === 'admin') {
      req.member = normalizeMember(payload);
      return next();
    }
  }

  // 2) Compatibilité ascendante : ADMIN_TOKEN partagé (header X-Admin-Token
  // ou cookie admin_token=). Utile pour bootstrap sans login.
  const sharedToken = ADMIN_TOKEN();
  if (!sharedToken && !adminJwt) {
    return res.status(503).json({
      error: 'Aucun ADMIN_TOKEN configuré côté serveur — définir ADMIN_TOKEN=… avant de lancer.',
    });
  }
  const header = req.header('x-admin-token') || '';
  const sharedCookiePart = cookieHeader.split(';').map(s => s.trim())
    .find(s => s.startsWith('admin_token='));
  const sharedCookieToken = sharedCookiePart
    ? decodeURIComponent(sharedCookiePart.slice('admin_token='.length))
    : '';
  if (sharedToken && (header === sharedToken || sharedCookieToken === sharedToken)) {
    return next();
  }
  return res.status(401).json({ error: 'Authentification admin requise.' });
}

// ── Auth membre (JWT cookie "token") ──────────────────────────────────────

/**
 * Middleware optionnel : tente de décoder le JWT dans le cookie "token".
 * Positionne req.member = payload décodé (ou null si absent/invalide).
 * Ne bloque jamais la requête.
 */
function optionalAuth(req, res, next) {
  // Accepte le cookie membre "token" ou le cookie admin "admin_jwt".
  // Un admin connecté via /admin.html doit aussi être vu comme membre
  // sur la home (il a tous les droits d'un contributeur en plus).
  const raw = (req.cookies && (req.cookies.token || req.cookies.admin_jwt))
    || _extractTokenFromCookieHeader(req, 'token')
    || _extractTokenFromCookieHeader(req, 'admin_jwt');

  req.member = raw ? normalizeMember(verifyToken(raw)) : null;
  next();
}

/**
 * Middleware d'authentification obligatoire.
 * Requiert un membre authentifié dont le rôle est >= minRole.
 * Hiérarchie : member < contributor < admin.
 *
 * @param {string} minRole  'member' | 'contributor' | 'admin'
 */
function requireAuth(minRole) {
  return function (req, res, next) {
    const raw = (req.cookies && (req.cookies.token || req.cookies.admin_jwt))
      || _extractTokenFromCookieHeader(req, 'token')
      || _extractTokenFromCookieHeader(req, 'admin_jwt');

    if (!raw) {
      return res.status(401).json({ error: 'Authentification requise.' });
    }

    const payload = verifyToken(raw);
    if (!payload) {
      return res.status(401).json({ error: 'Session invalide ou expirée.' });
    }

    if (roleIndex(payload.role) < roleIndex(minRole)) {
      return res.status(403).json({ error: `Rôle insuffisant (requis : ${minRole}).` });
    }

    req.member = normalizeMember(payload);
    next();
  };
}

// ── Erreur ────────────────────────────────────────────────────────────────

function errorHandler(err, _req, res, _next) {
  console.error('[err]', err.message);
  const status = err.status || 400;
  res.status(status).json({ error: err.message });
}

// ── Interne ───────────────────────────────────────────────────────────────

/**
 * Extraction de secours du token depuis le header Cookie brut
 * (utile si cookie-parser n'est pas encore monté ou absent).
 */
function _extractTokenFromCookieHeader(req, name = 'token') {
  const cookieHeader = req.header('cookie') || '';
  const prefix = name + '=';
  const part = cookieHeader.split(';').map(s => s.trim())
    .find(s => s.startsWith(prefix));
  return part ? decodeURIComponent(part.slice(prefix.length)) : null;
}

module.exports = { requireAdmin, optionalAuth, requireAuth, errorHandler };
