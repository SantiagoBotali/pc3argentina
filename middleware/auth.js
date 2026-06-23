function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
  if (req.path.startsWith('/api/') || req.headers['content-type'] === 'application/json') {
    return res.status(401).json({ error: 'No autorizado' });
  }
  res.redirect('/admin/login');
}

module.exports = { requireAdmin };
