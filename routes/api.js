const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { requireAdmin } = require('../middleware/auth');

const getDb = () => global.__db;

// ─── Cloudinary setup ───────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer stores files in memory; we upload the buffer directly to Cloudinary
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'));
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

/** Upload a file buffer to Cloudinary and return the secure URL */
function uploadToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, transformation: [{ quality: 'auto', fetch_format: 'auto' }] },
      (err, result) => err ? reject(err) : resolve(result.secure_url)
    );
    stream.end(buffer);
  });
}

/** Extract Cloudinary public_id from a secure_url */
function cloudinaryPublicId(url) {
  if (!url || !url.startsWith('http')) return null;
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)$/);
  if (!match) return null;
  return match[1].replace(/\.[^.]+$/, '');
}

// ─── Helpers ────────────────────────────────────────────────────
async function getProductFull(id) {
  const db = getDb();
  const product = await db.prepare(`SELECT * FROM products WHERE id = ?`).get(id);
  if (!product) return null;
  product.images = await db.prepare(
    `SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order`
  ).all(id);
  product.discount_tiers = await db.prepare(
    `SELECT * FROM discount_tiers WHERE product_id = ? ORDER BY section, min_quantity`
  ).all(id);
  return product;
}

// ─── PUBLIC ROUTES ──────────────────────────────────────────────

router.get('/products', async (req, res) => {
  try {
    const db = getDb();
    const products = await db.prepare(
      `SELECT * FROM products WHERE active = 1 ORDER BY sort_order, id`
    ).all();
    const result = await Promise.all(products.map(p => getProductFull(p.id)));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/settings', async (req, res) => {
  try {
    const db = getDb();
    const rows = await db.prepare(`SELECT key, value FROM settings`).all();
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/validate-stock', async (req, res) => {
  try {
    const db = getDb();
    const { items } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items requerido' });

    const issues = [];
    for (const item of items) {
      const product = await db.prepare(
        `SELECT id, name, stock FROM products WHERE id = ?`
      ).get(item.product_id);
      if (!product) continue;

      let availableStock = product.stock;
      if (item.variant_idx != null) {
        const img = await db.prepare(
          `SELECT stock FROM product_images WHERE product_id = ? AND sort_order = ?`
        ).get(item.product_id, item.variant_idx);
        if (img && img.stock > 0) availableStock = img.stock;
      }

      if (item.quantity > availableStock) {
        issues.push({
          product_id: product.id,
          name: product.name,
          available: availableStock,
          requested: item.quantity,
        });
      }
    }
    res.json({ valid: issues.length === 0, issues });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── ADMIN ROUTES ───────────────────────────────────────────────

router.get('/admin/products', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const products = await db.prepare(
      `SELECT * FROM products ORDER BY sort_order, id`
    ).all();
    const result = await Promise.all(products.map(p => getProductFull(p.id)));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/products', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const { name, slug, description, contents, price_pro, price_mayo, price_public, stock, active, sort_order } = req.body;
    if (!name || !slug) return res.status(400).json({ error: 'name y slug requeridos' });

    const result = await db.prepare(`
      INSERT INTO products (slug, name, description, contents, price_pro, price_mayo, price_public, stock, active, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      slug.trim().toLowerCase(),
      name.trim(),
      (description || '').trim(),
      (contents || '').trim(),
      parseInt(price_pro) || 0,
      parseInt(price_mayo) || 0,
      parseInt(price_public) || 0,
      parseInt(stock) || 0,
      active == null ? 1 : (active ? 1 : 0),
      parseInt(sort_order) || 0,
    );
    res.json(await getProductFull(result.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/admin/products/:id', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const { name, description, contents, price_pro, price_mayo, price_public, stock, active, sort_order } = req.body;
    const existing = await db.prepare(`SELECT * FROM products WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });

    const safeInt = (v, fallback) => { const n = parseInt(v, 10); return Number.isInteger(n) ? n : fallback; };

    await db.prepare(`
      UPDATE products SET
        name = ?, description = ?, contents = ?,
        price_pro = ?, price_mayo = ?, price_public = ?,
        stock = ?, active = ?, sort_order = ?,
        updated_at = NOW()
      WHERE id = ?
    `).run(
      name != null ? name.trim() : existing.name,
      description != null ? description.trim() : existing.description,
      contents != null ? contents.trim() : existing.contents,
      safeInt(price_pro,    existing.price_pro),
      safeInt(price_mayo,   existing.price_mayo),
      safeInt(price_public, existing.price_public),
      safeInt(stock,        existing.stock),
      active != null ? (active ? 1 : 0) : existing.active,
      safeInt(sort_order,   existing.sort_order),
      req.params.id,
    );
    res.json(await getProductFull(req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/admin/products/:id', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const { hard } = req.query;
    if (hard === '1') {
      const product = await db.prepare(`SELECT slug FROM products WHERE id = ?`).get(req.params.id);
      if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

      // Delete Cloudinary images
      const images = await db.prepare(
        `SELECT filename FROM product_images WHERE product_id = ?`
      ).all(req.params.id);
      for (const img of images) {
        const pubId = cloudinaryPublicId(img.filename);
        if (pubId) {
          await cloudinary.uploader.destroy(pubId).catch(() => {});
        }
      }

      await db.prepare(`DELETE FROM products WHERE id = ?`).run(req.params.id);
    } else {
      await db.prepare(
        `UPDATE products SET active = 0, updated_at = NOW() WHERE id = ?`
      ).run(req.params.id);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/products/:id/images', requireAdmin, (req, res) => {
  upload.array('images', 20)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se recibieron imágenes' });
    }

    try {
      const db = getDb();
      const product = await db.prepare(`SELECT * FROM products WHERE id = ?`).get(req.params.id);
      if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

      const maxRow = await db.prepare(
        `SELECT MAX(sort_order) as m FROM product_images WHERE product_id = ?`
      ).get(product.id);
      let nextOrder = (maxRow?.m == null ? -1 : maxRow.m) + 1;

      for (const file of req.files) {
        const url = await uploadToCloudinary(file.buffer, `pc3/${product.slug}`);
        await db.prepare(
          `INSERT INTO product_images (product_id, filename, sort_order) VALUES (?, ?, ?)`
        ).run(product.id, url, nextOrder++);
      }

      const images = await db.prepare(
        `SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order`
      ).all(product.id);
      res.json(images);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

router.delete('/admin/products/:id/images/:imgId', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const img = await db.prepare(
      `SELECT pi.*, p.slug FROM product_images pi JOIN products p ON p.id = pi.product_id WHERE pi.id = ?`
    ).get(req.params.imgId);
    if (!img) return res.status(404).json({ error: 'Imagen no encontrada' });

    // Delete from Cloudinary if it's a cloud URL
    const pubId = cloudinaryPublicId(img.filename);
    if (pubId) {
      await cloudinary.uploader.destroy(pubId).catch(() => {});
    }

    await db.prepare(`DELETE FROM product_images WHERE id = ?`).run(req.params.imgId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// NOTE: this literal route must be registered BEFORE the /:imgId wildcard below
router.put('/admin/products/:id/images/reorder', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order requerido' });

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      for (const { id, sort_order } of order) {
        await client.query(
          'UPDATE product_images SET sort_order = $1 WHERE id = $2',
          [sort_order, id]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/admin/products/:id/images/:imgId', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const { color_name, stock } = req.body;
    const img = await db.prepare(
      `SELECT * FROM product_images WHERE id = ? AND product_id = ?`
    ).get(req.params.imgId, req.params.id);
    if (!img) return res.status(404).json({ error: 'Imagen no encontrada' });

    await db.prepare(
      `UPDATE product_images SET color_name = ?, stock = ? WHERE id = ?`
    ).run(
      color_name != null ? String(color_name).trim() : img.color_name,
      stock != null ? parseInt(stock) : img.stock,
      req.params.imgId,
    );
    res.json(await db.prepare(`SELECT * FROM product_images WHERE id = ?`).get(req.params.imgId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/products/:id/tiers', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const { section, min_quantity, percentage } = req.body;
    if (!section || !min_quantity || percentage == null) {
      return res.status(400).json({ error: 'Campos requeridos' });
    }

    const result = await db.prepare(`
      INSERT INTO discount_tiers (product_id, section, min_quantity, percentage)
      VALUES (?, ?, ?, ?)
    `).run(req.params.id, section, parseInt(min_quantity), parseFloat(percentage));
    res.json(await db.prepare(`SELECT * FROM discount_tiers WHERE id = ?`).get(result.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/admin/tiers/:tierId', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const { min_quantity, percentage } = req.body;
    await db.prepare(
      `UPDATE discount_tiers SET min_quantity = ?, percentage = ? WHERE id = ?`
    ).run(parseInt(min_quantity), parseFloat(percentage), req.params.tierId);
    res.json(await db.prepare(`SELECT * FROM discount_tiers WHERE id = ?`).get(req.params.tierId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/admin/tiers/:tierId', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    await db.prepare(`DELETE FROM discount_tiers WHERE id = ?`).run(req.params.tierId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/admin/settings', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const rows = await db.prepare(`SELECT key, value FROM settings`).all();
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/admin/settings', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'key requerido' });
    await db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`
    ).run(key, value);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/change-password', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Campos requeridos' });
    }

    const admin = await db.prepare(`SELECT * FROM admin_users WHERE id = ?`).get(req.session.adminId);
    if (!bcrypt.compareSync(current_password, admin.password_hash)) {
      return res.status(400).json({ error: 'Contraseña actual incorrecta' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    }

    const newHash = bcrypt.hashSync(new_password, 10);
    await db.prepare(`UPDATE admin_users SET password_hash = ? WHERE id = ?`).run(newHash, req.session.adminId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
