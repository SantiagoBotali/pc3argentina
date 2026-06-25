/**
 * migrate-images.js
 * Lee las imágenes locales de /productos, las sube a Cloudinary
 * e inserta (o actualiza) los registros en la base de datos Neon.
 *
 * Correr una sola vez: node migrate-images.js
 */

require('dotenv').config();
const { v2: cloudinary } = require('cloudinary');
const fs = require('fs');
const path = require('path');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const PRODUCTOS_DIR = path.join(__dirname, 'productos');
const IMAGE_EXTS = /\.(png|jpe?g|webp|gif)$/i;

async function migrate() {
  const { init } = require('./database');
  const db = await init();

  if (!fs.existsSync(PRODUCTOS_DIR)) {
    console.log('⚠  No existe la carpeta /productos. Nada para migrar.');
    process.exit(0);
  }

  const slugFolders = fs.readdirSync(PRODUCTOS_DIR).filter(name => {
    return fs.statSync(path.join(PRODUCTOS_DIR, name)).isDirectory();
  });

  if (slugFolders.length === 0) {
    console.log('⚠  La carpeta /productos está vacía.');
    process.exit(0);
  }

  console.log(`Encontradas ${slugFolders.length} carpetas de productos.\n`);

  let totalOk = 0;
  let totalFail = 0;

  for (const slug of slugFolders) {
    // Find the product in Neon by slug
    const product = await db.prepare(`SELECT id FROM products WHERE slug = ?`).get(slug);
    if (!product) {
      console.log(`  ⚠  Producto "${slug}" no existe en la BD — saltando`);
      continue;
    }

    const folder = path.join(PRODUCTOS_DIR, slug);
    const files = fs.readdirSync(folder)
      .filter(f => IMAGE_EXTS.test(f))
      .sort((a, b) => {
        const na = parseInt(a.replace(/\D/g, '')) || 0;
        const nb = parseInt(b.replace(/\D/g, '')) || 0;
        return na - nb;
      });

    if (files.length === 0) {
      console.log(`  —  ${slug}: sin imágenes`);
      continue;
    }

    console.log(`  📦 ${slug} (${files.length} imágenes)`);

    for (let i = 0; i < files.length; i++) {
      const filename = files[i];
      const localPath = path.join(folder, filename);

      try {
        const result = await cloudinary.uploader.upload(localPath, {
          folder: `pc3/${slug}`,
          transformation: [{ quality: 'auto', fetch_format: 'auto' }],
        });

        // Upsert: update if already exists for this product+sort_order, else insert
        const existing = await db.prepare(
          `SELECT id FROM product_images WHERE product_id = ? AND sort_order = ?`
        ).get(product.id, i);

        if (existing) {
          await db.prepare(`UPDATE product_images SET filename = ? WHERE id = ?`)
            .run(result.secure_url, existing.id);
        } else {
          await db.prepare(
            `INSERT INTO product_images (product_id, filename, sort_order) VALUES (?, ?, ?)`
          ).run(product.id, result.secure_url, i);
        }

        console.log(`     ✓ ${filename}`);
        totalOk++;
      } catch (e) {
        console.log(`     ✗ ${filename}: ${e.message}`);
        totalFail++;
      }
    }
  }

  console.log(`\n✅ Migración completada: ${totalOk} imágenes subidas, ${totalFail} errores.`);
  process.exit(0);
}

migrate().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
