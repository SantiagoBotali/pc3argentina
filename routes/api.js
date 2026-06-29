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

/**
 * Fetch a single product with images and tiers (3 queries).
 * Used for single-product responses (create, update).
 */
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

/**
 * Fetch a list of products with images and tiers in exactly 3 queries total,
 * regardless of how many products there are (no N+1).
 */
async function getProductList(products) {
  if (!products.length) return [];
  const db = getDb();
  const ids = products.map(p => p.id);

  const [images, tiers] = await Promise.all([
    db.query(`SELECT * FROM product_images WHERE product_id = ANY($1) ORDER BY sort_order`, [ids]),
    db.query(`SELECT * FROM discount_tiers WHERE product_id = ANY($1) ORDER BY section, min_quantity`, [ids]),
  ]);

  const imagesByProduct = {};
  const tiersByProduct = {};
  for (const img of images) {
    (imagesByProduct[img.product_id] = imagesByProduct[img.product_id] || []).push(img);
  }
  for (const t of tiers) {
    (tiersByProduct[t.product_id] = tiersByProduct[t.product_id] || []).push(t);
  }

  return products.map(p => ({
    ...p,
    images: imagesByProduct[p.id] || [],
    discount_tiers: tiersByProduct[p.id] || [],
  }));
}

// ─── Simple in-memory cache for the public catalog ───────────────
// Survives across warm requests on the same Vercel instance.
// Invalidated whenever a product is created, updated, or deleted.
const catalogCache = { data: null, expiresAt: 0 };
const CACHE_TTL_MS = 30_000; // 30 seconds

function invalidateCache() { catalogCache.data = null; catalogCache.expiresAt = 0; }

// ─── Order helpers ──────────────────────────────────────────────

async function createOrder(db, body) {
  const {
    section      = '',
    client_name  = '',
    client_phone = '',
    delivery     = 'retiro',
    address      = '',
    comprobante  = '',
    notes        = '',
    items        = [],
  } = body;

  const safeItems = items
    .map(i => ({
      product_id:   parseInt(i.product_id) || null,
      product_name: String(i.product_name || '').trim(),
      color_name:   String(i.color_name   || '').trim(),
      quantity:     Math.max(1, parseInt(i.quantity)   || 1),
      unit_price:   Math.max(0, parseInt(i.unit_price) || 0),
    }))
    .filter(i => i.product_name || i.product_id);

  const total = safeItems.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const orderRes = await client.query(
      `INSERT INTO orders (status, section, client_name, client_phone, delivery, address, comprobante, notes, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      ['pending', section, client_name, client_phone, delivery, address, comprobante, notes, total]
    );
    const orderId = orderRes.rows[0].id;

    for (const item of safeItems) {
      const subtotal = item.unit_price * item.quantity;
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, color_name, quantity, unit_price, subtotal)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [orderId, item.product_id, item.product_name, item.color_name, item.quantity, item.unit_price, subtotal]
      );
    }

    await client.query('COMMIT');
    return orderId;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function getOrderFull(db, id) {
  const order = await db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);
  if (!order) return null;
  order.items = await db.prepare(
    `SELECT * FROM order_items WHERE order_id = ? ORDER BY id`
  ).all(id);
  return order;
}

// ─── PUBLIC ROUTES ──────────────────────────────────────────────

router.get('/products', async (req, res) => {
  try {
    const now = Date.now();
    if (catalogCache.data && now < catalogCache.expiresAt) {
      return res.json(catalogCache.data);
    }
    const db = getDb();
    const products = await db.prepare(
      `SELECT * FROM products WHERE active = 1 ORDER BY sort_order, id`
    ).all();
    const result = await getProductList(products);
    catalogCache.data = result;
    catalogCache.expiresAt = now + CACHE_TTL_MS;
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

router.post('/orders', async (req, res) => {
  try {
    const db = getDb();
    const { items = [] } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items requerido' });
    }
    const orderId = await createOrder(db, req.body);
    res.status(201).json(await getOrderFull(db, orderId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── ADMIN ROUTES ───────────────────────────────────────────────

// ─── Orders admin ───────────────────────────────────────────────

router.get('/admin/orders', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const { status, section, search, from, to } = req.query;

    const where = [];
    const params = [];

    if (status && ['pending', 'confirmed', 'cancelled'].includes(status)) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (section && ['profesional', 'mayorista'].includes(section)) {
      params.push(section);
      where.push(`section = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      const n = params.length;
      where.push(`(client_name ILIKE $${n} OR client_phone ILIKE $${n})`);
    }
    if (from) {
      params.push(from);
      where.push(`created_at >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      where.push(`created_at <= $${params.length}`);
    }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const orders = await db.query(
      `SELECT * FROM orders ${whereClause}
       ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC`,
      params
    );

    res.json(orders);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/orders', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const { items = [] } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items requerido' });
    }
    const orderId = await createOrder(db, req.body);
    res.status(201).json(await getOrderFull(db, orderId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/admin/orders/:id', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const order = await getOrderFull(db, req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json(order);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/admin/orders/:id', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const order = await db.prepare(`SELECT * FROM orders WHERE id = ?`).get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (order.status !== 'pending') {
      return res.status(400).json({ error: 'Solo se pueden editar pedidos pendientes' });
    }

    const {
      section      = order.section,
      client_name  = order.client_name,
      client_phone = order.client_phone,
      delivery     = order.delivery,
      address      = order.address,
      comprobante  = order.comprobante,
      notes        = order.notes,
    } = req.body;

    await db.prepare(`
      UPDATE orders SET
        section = ?, client_name = ?, client_phone = ?,
        delivery = ?, address = ?, comprobante = ?, notes = ?
      WHERE id = ?
    `).run(section, client_name, client_phone, delivery, address, comprobante, notes, req.params.id);

    res.json(await getOrderFull(db, req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/admin/orders/:id/items', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const order = await db.prepare(`SELECT * FROM orders WHERE id = ?`).get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (order.status !== 'pending') {
      return res.status(400).json({ error: 'Solo se pueden editar pedidos pendientes' });
    }

    const { items = [] } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items requerido' });
    }

    const safeItems = items
      .map(i => ({
        product_id:   parseInt(i.product_id) || null,
        product_name: String(i.product_name || '').trim(),
        color_name:   String(i.color_name   || '').trim(),
        quantity:     Math.max(1, parseInt(i.quantity)   || 1),
        unit_price:   Math.max(0, parseInt(i.unit_price) || 0),
      }))
      .filter(i => i.product_name || i.product_id);

    const total = safeItems.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM order_items WHERE order_id = $1`, [req.params.id]);
      for (const item of safeItems) {
        const subtotal = item.unit_price * item.quantity;
        await client.query(
          `INSERT INTO order_items (order_id, product_id, product_name, color_name, quantity, unit_price, subtotal)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [req.params.id, item.product_id, item.product_name, item.color_name, item.quantity, item.unit_price, subtotal]
        );
      }
      await client.query(`UPDATE orders SET total = $1 WHERE id = $2`, [total, req.params.id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.json(await getOrderFull(db, req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/orders/:id/confirm', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const order = await getOrderFull(db, req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (order.status !== 'pending') {
      return res.status(400).json({ error: 'Solo se pueden confirmar pedidos pendientes' });
    }

    // Verificar stock para todos los ítems con product_id
    const stockErrors = [];
    for (const item of order.items) {
      if (!item.product_id) continue;
      const product = await db.prepare(
        `SELECT id, name, stock FROM products WHERE id = ?`
      ).get(item.product_id);
      if (!product) continue;
      if (product.stock < item.quantity) {
        stockErrors.push({
          product_name: item.product_name,
          requested:    item.quantity,
          available:    product.stock,
        });
      }
    }

    if (stockErrors.length > 0) {
      return res.status(400).json({ error: 'Stock insuficiente', stock_errors: stockErrors });
    }

    // Descontar stock y confirmar en una transacción
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      for (const item of order.items) {
        if (!item.product_id) continue;
        await client.query(
          `UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2`,
          [item.quantity, item.product_id]
        );
      }
      await client.query(
        `UPDATE orders SET status = 'confirmed', confirmed_at = NOW() WHERE id = $1`,
        [req.params.id]
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    invalidateCache();
    res.json(await getOrderFull(db, req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/orders/:id/cancel', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const order = await db.prepare(`SELECT * FROM orders WHERE id = ?`).get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (order.status !== 'pending') {
      return res.status(400).json({ error: 'Solo se pueden cancelar pedidos pendientes' });
    }
    await db.prepare(
      `UPDATE orders SET status = 'cancelled', confirmed_at = NOW() WHERE id = ?`
    ).run(req.params.id);
    res.json(await getOrderFull(db, req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/admin/products', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const products = await db.prepare(
      `SELECT * FROM products ORDER BY sort_order, id`
    ).all();
    const result = await getProductList(products);
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
    invalidateCache();
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
    invalidateCache();
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
    invalidateCache();
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

router.put('/admin/products/:id/images/:imgId/file', requireAdmin, (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });
    try {
      const db = getDb();
      const img = await db.prepare(
        `SELECT pi.*, p.slug FROM product_images pi JOIN products p ON p.id = pi.product_id WHERE pi.id = ? AND pi.product_id = ?`
      ).get(req.params.imgId, req.params.id);
      if (!img) return res.status(404).json({ error: 'Imagen no encontrada' });

      const pubId = cloudinaryPublicId(img.filename);
      if (pubId) await cloudinary.uploader.destroy(pubId).catch(() => {});

      const url = await uploadToCloudinary(req.file.buffer, `pc3/${img.slug}`);
      await db.prepare(`UPDATE product_images SET filename = ? WHERE id = ?`).run(url, req.params.imgId);

      invalidateCache();
      res.json(await db.prepare(`SELECT * FROM product_images WHERE id = ?`).get(req.params.imgId));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

router.put('/admin/products/:id/images/:imgId', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const { color_name, color_hex, stock } = req.body;
    const img = await db.prepare(
      `SELECT * FROM product_images WHERE id = ? AND product_id = ?`
    ).get(req.params.imgId, req.params.id);
    if (!img) return res.status(404).json({ error: 'Imagen no encontrada' });

    await db.prepare(
      `UPDATE product_images SET color_name = ?, color_hex = ?, stock = ? WHERE id = ?`
    ).run(
      color_name != null ? String(color_name).trim() : img.color_name,
      color_hex  != null ? String(color_hex).trim()  : img.color_hex,
      stock      != null ? parseInt(stock)            : img.stock,
      req.params.imgId,
    );
    invalidateCache();
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

// ─── Colors ─────────────────────────────────────────────────────

router.get('/colors', async (req, res) => {
  try {
    const db = getDb();
    const colors = await db.prepare(`SELECT * FROM colors ORDER BY sort_order, id`).all();
    res.json(colors);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/admin/colors', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const colors = await db.prepare(`SELECT * FROM colors ORDER BY sort_order, id`).all();
    res.json(colors);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/colors', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const { name, hex } = req.body;
    if (!name || !hex) return res.status(400).json({ error: 'name y hex requeridos' });
    const maxOrder = await db.prepare(`SELECT MAX(sort_order) AS m FROM colors`).get();
    const nextOrder = (maxOrder?.m ?? -1) + 1;
    const result = await db.prepare(
      `INSERT INTO colors (name, hex, sort_order) VALUES (?, ?, ?)`
    ).run(name.trim(), hex.trim(), nextOrder);
    res.json(await db.prepare(`SELECT * FROM colors WHERE id = ?`).get(result.lastInsertRowid));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/admin/colors/:id', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const { name, hex } = req.body;
    const existing = await db.prepare(`SELECT * FROM colors WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Color no encontrado' });
    await db.prepare(`UPDATE colors SET name = ?, hex = ? WHERE id = ?`).run(
      name != null ? name.trim() : existing.name,
      hex  != null ? hex.trim()  : existing.hex,
      req.params.id
    );
    res.json(await db.prepare(`SELECT * FROM colors WHERE id = ?`).get(req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/admin/colors/:id', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    await db.prepare(`DELETE FROM colors WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
