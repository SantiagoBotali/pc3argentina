const express = require('express');
const router = express.Router();
const path = require('path');
const bcrypt = require('bcryptjs');
const { requireAdmin } = require('../middleware/auth');

const getDb = () => global.__db;

// GET /admin/login
router.get('/login', (req, res) => {
  if (req.session && req.session.adminId) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, '../views/admin-login.html'));
});

// POST /admin/login
router.post('/login', async (req, res) => {
  try {
    const db = getDb();
    const { username, password } = req.body;
    const admin = await db.prepare(`SELECT * FROM admin_users WHERE username = ?`).get(username);

    if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
      return res.redirect('/admin/login?error=1');
    }

    req.session.adminId = admin.id;
    req.session.adminUsername = admin.username;
    res.redirect('/admin');
  } catch (e) {
    res.redirect('/admin/login?error=1');
  }
});

// POST /admin/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// GET /admin (all authenticated admin pages)
router.get('/', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../views/admin.html'));
});

router.get('*', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../views/admin.html'));
});

module.exports = router;
