require('dotenv').config();
const bcrypt = require('bcryptjs');

async function seed() {
  const { init } = require('./database');
  const db = await init();

  console.log('Iniciando seed...');

  // Admin user
  const hash = bcrypt.hashSync('pablocomini123', 10);
  try {
    await db.prepare(`INSERT INTO admin_users (username, password_hash) VALUES (?, ?)`).run('pc3argentina', hash);
    console.log('✓ Usuario admin creado');
  } catch (e) {
    if (e.message.includes('unique') || e.message.includes('duplicate')) {
      console.log('  (usuario admin ya existe, saltando)');
    } else throw e;
  }

  // Settings
  const settings = [
    ['min_purchase_pro',  '550000'],
    ['min_purchase_mayo', '950000'],
    ['whatsapp_number',   '5493492310744'],
  ];
  for (const [k, v] of settings) {
    try {
      await db.prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`
      ).run(k, v);
    } catch (e) { /* already exists */ }
  }
  console.log('✓ Configuración inicial cargada');

  // Default products (no images — upload via admin panel)
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
    const existing = await db.prepare(`SELECT id FROM products WHERE slug = ?`).get(p.slug);
    if (existing) {
      console.log(`  (producto ${p.slug} ya existe, saltando)`);
      continue;
    }

    const result = await db.prepare(`
      INSERT INTO products (slug, name, description, contents, price_pro, price_mayo, stock, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(p.slug, p.name, '', '', p.price_pro, p.price_mayo, p.stock, p.sort_order);

    const productId = result.lastInsertRowid;

    // Default discount tiers (profesional section)
    await db.prepare(
      `INSERT INTO discount_tiers (product_id, section, min_quantity, percentage) VALUES (?, ?, ?, ?)`
    ).run(productId, 'profesional', 30, 20);
    await db.prepare(
      `INSERT INTO discount_tiers (product_id, section, min_quantity, percentage) VALUES (?, ?, ?, ?)`
    ).run(productId, 'profesional', 48, 37);

    console.log(`✓ Producto: ${p.name}`);
  }

  console.log('\n✅ Seed completado.');
  process.exit(0);
}

seed().catch(err => {
  console.error('Error en seed:', err);
  process.exit(1);
});
