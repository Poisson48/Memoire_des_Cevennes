// Middlewares partagés : auth admin + gestionnaire d'erreur.

const ADMIN_TOKEN = () => process.env.ADMIN_TOKEN || '';

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

function errorHandler(err, _req, res, _next) {
  console.error('[err]', err.message);
  const status = err.status || 400;
  res.status(status).json({ error: err.message });
}

module.exports = { requireAdmin, errorHandler };
