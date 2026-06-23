const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAdmin } = require('../middleware/auth');

// db is initialised before routes are loaded via global.__db
const getDb = () => global.__db;

// ─── Multer setup ───────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const db = getDb();
    const product = db.prepare(`SELECT slug FROM products WHERE id = ?`).get(req.params.id);
    if (!product) return cb(new Error('Producto no encontrado'));
    const dir = path.join(__dirname, '../productos', product.slug);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const db = getDb();
    const product = db.prepare(`SELECT slug, id FROM products WHERE id = ?`).get(req.params.id);
    const maxRow = db.prepare(`SELECT MAX(sort_order) as m FROM product_images WHERE product_id = ?`).get(product.id);
    const next = (maxRow.m == null ? 0 : maxRow.m) + 1;
    cb(null, `var${next}${path.extname(file.originalname).toLowerCase() || '.png'}`);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'));
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

// ─── Helpers ────────────────────────────────────────────────────
function getProductFull(id) {
  const db = getDb();
  const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(id);
  if (!product) return null;
  product.images = db.prepare(`SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order`).all(id);
  product.discount_tiers = db.prepare(`SELECT * FROM discount_tiers WHERE product_id = ? ORDER BY section, min_quantity`).all(id);
  return product;
}

// ─── PUBLIC ROUTES ──────────────────────────────────────────────

router.get('/products', (req, res) => {
  const db = getDb();
  const products = db.prepare(`SELECT * FROM products WHERE active = 1 ORDER BY sort_order, id`).all();
  const result = products.map(p => {
    p.images = db.prepare(`SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order`).all(p.id);
    p.discount_tiers = db.prepare(`SELECT * FROM discount_tiers WHERE product_id = ? ORDER BY section, min_quantity`).all(p.id);
    return p;
  });
  res.json(result);
});

router.get('/settings', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  const settings = {};
  rows.forEach(r => settings[r.key] = r.value);
  res.json(settings);
});

router.post('/validate-stock', (req, res) => {
  const db = getDb();
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items requerido' });

  const issues = [];
  for (const item of items) {
    const product = db.prepare(`SELECT id, name, stock FROM products WHERE id = ?`).get(item.product_id);
    if (!product) continue;
    if (item.quantity > product.stock) {
      issues.push({ product_id: product.id, name: product.name, available: product.stock, requested: item.quantity });
    }
  }
  res.json({ valid: issues.length === 0, issues });
});

// ─── ADMIN ROUTES ───────────────────────────────────────────────

router.get('/admin/products', requireAdmin, (req, res) => {
  const db = getDb();
  const products = db.prepare(`SELECT * FROM products ORDER BY sort_order, id`).all();
  const result = products.map(p => getProductFull(p.id));
  res.json(result);
});

router.post('/admin/products', requireAdmin, (req, res) => {
  const db = getDb();
  const { name, slug, description, contents, price_pro, price_mayo, stock, active, sort_order } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'name y slug requeridos' });

  try {
    const result = db.prepare(`
      INSERT INTO products (slug, name, description, contents, price_pro, price_mayo, stock, active, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      slug.trim().toLowerCase(),
      name.trim(),
      (description || '').trim(),
      (contents || '').trim(),
      parseInt(price_pro) || 0,
      parseInt(price_mayo) || 0,
      parseInt(stock) || 0,
      active == null ? 1 : (active ? 1 : 0),
      parseInt(sort_order) || 0
    );
    res.json(getProductFull(result.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/admin/products/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const { name, description, contents, price_pro, price_mayo, stock, active, sort_order } = req.body;
  const existing = db.prepare(`SELECT * FROM products WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });

  db.prepare(`
    UPDATE products SET
      name = ?, description = ?, contents = ?,
      price_pro = ?, price_mayo = ?,
      stock = ?, active = ?, sort_order = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name != null ? name.trim() : existing.name,
    description != null ? description.trim() : existing.description,
    contents != null ? contents.trim() : existing.contents,
    price_pro != null ? parseInt(price_pro) : existing.price_pro,
    price_mayo != null ? parseInt(price_mayo) : existing.price_mayo,
    stock != null ? parseInt(stock) : existing.stock,
    active != null ? (active ? 1 : 0) : existing.active,
    sort_order != null ? parseInt(sort_order) : existing.sort_order,
    req.params.id
  );
  res.json(getProductFull(req.params.id));
});

router.delete('/admin/products/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const { hard } = req.query;
  if (hard === '1') {
    const product = db.prepare(`SELECT slug FROM products WHERE id = ?`).get(req.params.id);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

    // Delete image files from disk
    const productDir = path.join(__dirname, '../productos', product.slug);
    if (fs.existsSync(productDir)) {
      fs.rmSync(productDir, { recursive: true, force: true });
    }

    // Delete from DB (cascades to product_images and discount_tiers)
    db.prepare(`DELETE FROM products WHERE id = ?`).run(req.params.id);
  } else {
    db.prepare(`UPDATE products SET active = 0, updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
  }
  res.json({ ok: true });
});

router.post('/admin/products/:id/images', requireAdmin, (req, res) => {
  const db = getDb();
  const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

  upload.array('images', 20)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No se recibieron imágenes' });

    const db2 = getDb();
    const insertImg = db2.prepare(`INSERT INTO product_images (product_id, filename, sort_order) VALUES (?, ?, ?)`);
    const maxRow = db2.prepare(`SELECT MAX(sort_order) as m FROM product_images WHERE product_id = ?`).get(product.id);
    let nextOrder = (maxRow.m == null ? -1 : maxRow.m) + 1;

    for (const file of req.files) {
      insertImg.run(product.id, file.filename, nextOrder++);
    }

    res.json(db2.prepare(`SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order`).all(product.id));
  });
});

router.delete('/admin/products/:id/images/:imgId', requireAdmin, (req, res) => {
  const db = getDb();
  const img = db.prepare(`SELECT pi.*, p.slug FROM product_images pi JOIN products p ON p.id = pi.product_id WHERE pi.id = ?`).get(req.params.imgId);
  if (!img) return res.status(404).json({ error: 'Imagen no encontrada' });

  const filePath = path.join(__dirname, '../productos', img.slug, img.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  db.prepare(`DELETE FROM product_images WHERE id = ?`).run(req.params.imgId);
  res.json({ ok: true });
});

router.put('/admin/products/:id/images/reorder', requireAdmin, (req, res) => {
  const db = getDb();
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order requerido' });

  const update = db.prepare(`UPDATE product_images SET sort_order = ? WHERE id = ?`);
  db.transaction(() => order.forEach(({ id, sort_order }) => update.run(sort_order, id)))();
  res.json({ ok: true });
});

router.post('/admin/products/:id/tiers', requireAdmin, (req, res) => {
  const db = getDb();
  const { section, min_quantity, percentage } = req.body;
  if (!section || !min_quantity || percentage == null) return res.status(400).json({ error: 'Campos requeridos' });

  try {
    const result = db.prepare(`
      INSERT INTO discount_tiers (product_id, section, min_quantity, percentage)
      VALUES (?, ?, ?, ?)
    `).run(req.params.id, section, parseInt(min_quantity), parseFloat(percentage));
    res.json(db.prepare(`SELECT * FROM discount_tiers WHERE id = ?`).get(result.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/admin/tiers/:tierId', requireAdmin, (req, res) => {
  const db = getDb();
  const { min_quantity, percentage } = req.body;
  db.prepare(`UPDATE discount_tiers SET min_quantity = ?, percentage = ? WHERE id = ?`)
    .run(parseInt(min_quantity), parseFloat(percentage), req.params.tierId);
  res.json(db.prepare(`SELECT * FROM discount_tiers WHERE id = ?`).get(req.params.tierId));
});

router.delete('/admin/tiers/:tierId', requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare(`DELETE FROM discount_tiers WHERE id = ?`).run(req.params.tierId);
  res.json({ ok: true });
});

router.get('/admin/settings', requireAdmin, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  const settings = {};
  rows.forEach(r => settings[r.key] = r.value);
  res.json(settings);
});

router.put('/admin/settings', requireAdmin, (req, res) => {
  const db = getDb();
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'key requerido' });
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
  res.json({ ok: true });
});

router.post('/admin/change-password', requireAdmin, (req, res) => {
  const db = getDb();
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Campos requeridos' });

  const admin = db.prepare(`SELECT * FROM admin_users WHERE id = ?`).get(req.session.adminId);
  if (!bcrypt.compareSync(current_password, admin.password_hash)) {
    return res.status(400).json({ error: 'Contraseña actual incorrecta' });
  }
  if (new_password.length < 6) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });

  const newHash = bcrypt.hashSync(new_password, 10);
  db.prepare(`UPDATE admin_users SET password_hash = ? WHERE id = ?`).run(newHash, req.session.adminId);
  res.json({ ok: true });
});

module.exports = router;
