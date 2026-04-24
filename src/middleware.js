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
  const token = ADMIN_TOKEN();
  if (!token) {
    return res.status(503).json({
      error: 'Aucun ADMIN_TOKEN configuré côté serveur — définir ADMIN_TOKEN=… avant de lancer.',
    });
  }
  const header = req.header('x-admin-token') || '';
  const cookieHeader = req.header('cookie') || '';
  const cookiePart = cookieHeader.split(';').map(s => s.trim())
    .find(s => s.startsWith('admin_token='));
  const cookieToken = cookiePart ? decodeURIComponent(cookiePart.slice('admin_token='.length)) : '';
  if (header !== token && cookieToken !== token) {
    return res.status(401).json({ error: 'Token admin invalide' });
  }
  next();
}

// ── Auth membre (JWT cookie "token") ──────────────────────────────────────

/**
 * Middleware optionnel : tente de décoder le JWT dans le cookie "token".
 * Positionne req.member = payload décodé (ou null si absent/invalide).
 * Ne bloque jamais la requête.
 */
function optionalAuth(req, res, next) {
  const raw = req.cookies && req.cookies.token
    ? req.cookies.token
    : _extractTokenFromCookieHeader(req);

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
    const raw = req.cookies && req.cookies.token
      ? req.cookies.token
      : _extractTokenFromCookieHeader(req);

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
function _extractTokenFromCookieHeader(req) {
  const cookieHeader = req.header('cookie') || '';
  const part = cookieHeader.split(';').map(s => s.trim())
    .find(s => s.startsWith('token='));
  return part ? decodeURIComponent(part.slice('token='.length)) : null;
}

module.exports = { requireAdmin, optionalAuth, requireAuth, errorHandler };
