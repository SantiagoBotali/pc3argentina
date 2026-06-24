/**
 * migrate-images.js
 * Sube todas las imágenes locales de /productos a Cloudinary
 * y actualiza las URLs en la base de datos Neon.
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

async function migrate() {
  const { init } = require('./database');
  const db = await init();

  // Only migrate images that are still local paths (not already Cloudinary URLs)
  const images = await db.prepare(`
    SELECT pi.id, pi.filename, pi.sort_order, p.slug
    FROM product_images pi
    JOIN products p ON p.id = pi.product_id
    WHERE pi.filename NOT LIKE 'http%'
    ORDER BY p.slug, pi.sort_order
  `).all();

  if (images.length === 0) {
    console.log('✅ No hay imágenes locales para migrar.');
    process.exit(0);
  }

  console.log(`Encontradas ${images.length} imágenes para subir a Cloudinary...\n`);

  let ok = 0;
  let fail = 0;

  for (const img of images) {
    const localPath = path.join(__dirname, 'productos', img.slug, img.filename);

    if (!fs.existsSync(localPath)) {
      console.log(`  ⚠  No encontrado: productos/${img.slug}/${img.filename}`);
      fail++;
      continue;
    }

    try {
      const result = await cloudinary.uploader.upload(localPath, {
        folder: `pc3/${img.slug}`,
        transformation: [{ quality: 'auto', fetch_format: 'auto' }],
      });

      await db.prepare(`UPDATE product_images SET filename = ? WHERE id = ?`)
        .run(result.secure_url, img.id);

      console.log(`  ✓  ${img.slug}/${img.filename}`);
      ok++;
    } catch (e) {
      console.log(`  ✗  ${img.slug}/${img.filename}: ${e.message}`);
      fail++;
    }
  }

  console.log(`\n✅ Migración completada: ${ok} subidas, ${fail} errores.`);
  process.exit(0);
}

migrate().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
