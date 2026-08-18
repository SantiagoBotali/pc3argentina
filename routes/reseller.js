const express = require('express');
const path = require('path');
const router = express.Router();

const getDb = () => global.__db;

// GET /revendedor — selector de nombre
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/reseller-picker.html'));
});

// GET /revendedor/:slug — mismo catálogo, tageado con el revendedor (validado server-side)
router.get('/:slug', async (req, res, next) => {
  try {
    const db = getDb();
    const reseller = await db.prepare(
      `SELECT id FROM resellers WHERE slug = ? AND active = 1`
    ).get(req.params.slug);
    if (!reseller) return res.redirect('/revendedor');
    res.sendFile(path.join(__dirname, '../views/catalog.html'));
  } catch (e) {
    next(e);
  }
});

module.exports = router;
