require('dotenv').config();
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

async function seed() {
  const { init } = require('./database');
  const db = await init();

  console.log('Iniciando seed...');

  // Admin user
  const hash = bcrypt.hashSync('pablocomini123', 10);
  try {
    db.prepare(`INSERT INTO admin_users (username, password_hash) VALUES (?, ?)`).run('pc3argentina', hash);
    console.log('✓ Usuario admin creado');
  } catch (e) {
    if (e.message.includes('UNIQUE')) console.log('  (usuario admin ya existe, saltando)');
    else throw e;
  }

  // Settings
  const settings = [
    ['min_purchase_pro', '550000'],
    ['min_purchase_mayo', '950000'],
    ['whatsapp_number', '5493492310744'],
  ];
  for (const [k, v] of settings) {
    try {
      db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run(k, v);
    } catch (e) { /* already exists */ }
  }
  console.log('✓ Configuración inicial cargada');

  // Products
  const SEED_PRODUCTS = [
    { slug: 'cinta-cohesiva-5-cm',   name: 'Cinta Cohesiva 5 CM',   price_pro: 3500,  price_mayo: 1450, stock: 100, sort_order: 1 },
    { slug: 'cinta-cohesiva-7.5-cm', name: 'Cinta Cohesiva 7.5 CM', price_pro: 4000,  price_mayo: 2100, stock: 100, sort_order: 2 },
    { slug: 'cinta-cohesiva-10-cm',  name: 'Cinta Cohesiva 10 CM',  price_pro: 4500,  price_mayo: 2600, stock: 100, sort_order: 3 },
    { slug: 'kinesiology-tape-5-cm', name: 'Kinesiology Tape 5 CM', price_pro: 16000, price_mayo: 6600, stock: 100, sort_order: 4 },
    { slug: 'sport-tape-3.8-cm',     name: 'Sport Tape 3.8 CM',     price_pro: 12500, price_mayo: 6000, stock: 100, sort_order: 5 },
    { slug: 'sport-tape-5-cm',       name: 'Sport Tape 5 CM',       price_pro: 15000, price_mayo: 7000, stock: 100, sort_order: 6 },
    { slug: 'tenso-pc3-7.5-cm',      name: 'Tenso PC3 7.5 CM',      price_pro: 8000,  price_mayo: 6000, stock: 100, sort_order: 7 },
    { slug: 'pre-vendaje-7-cm',      name: 'Pre Vendaje 7 CM',      price_pro: 10000, price_mayo: 5000, stock: 100, sort_order: 8 },
  ];

  for (const p of SEED_PRODUCTS) {
    const descFile = path.join(__dirname, 'productos', p.slug, 'description.txt');
    let contents = '';
    let description = '';

    if (fs.existsSync(descFile)) {
      const lines = fs.readFileSync(descFile, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
      contents = lines[0] || '';
      description = lines.slice(1).join(' ');
    }

    // Skip if already exists
    const existing = db.prepare(`SELECT id FROM products WHERE slug = ?`).get(p.slug);
    if (existing) {
      console.log(`  (producto ${p.slug} ya existe, saltando)`);
      continue;
    }

    db.prepare(`
      INSERT INTO products (slug, name, description, contents, price_pro, price_mayo, stock, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(p.slug, p.name, description, contents, p.price_pro, p.price_mayo, p.stock, p.sort_order);

    const row = db.prepare(`SELECT id FROM products WHERE slug = ?`).get(p.slug);
    if (!row) continue;
    const productId = row.id;

    // Images
    const imgDir = path.join(__dirname, 'productos', p.slug);
    if (fs.existsSync(imgDir)) {
      const imgs = fs.readdirSync(imgDir)
        .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
        .sort((a, b) => {
          const na = parseInt(a.replace(/\D/g, '')) || 0;
          const nb = parseInt(b.replace(/\D/g, '')) || 0;
          return na - nb;
        });
      imgs.forEach((filename, idx) => {
        db.prepare(`INSERT INTO product_images (product_id, filename, sort_order) VALUES (?, ?, ?)`).run(productId, filename, idx);
      });
    }

    // Default discount tiers (profesional section only)
    db.prepare(`INSERT INTO discount_tiers (product_id, section, min_quantity, percentage) VALUES (?, ?, ?, ?)`).run(productId, 'profesional', 30, 20);
    db.prepare(`INSERT INTO discount_tiers (product_id, section, min_quantity, percentage) VALUES (?, ?, ?, ?)`).run(productId, 'profesional', 48, 37);

    console.log(`✓ Producto: ${p.name}`);
  }

  console.log('\n✅ Seed completado. Ejecutá: node server.js');
  process.exit(0);
}

seed().catch(err => {
  console.error('Error en seed:', err);
  process.exit(1);
});
