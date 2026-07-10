# Variantes por botón + Fotos de contexto + Reordenamiento — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar column `image_type` a `product_images`, cambiar el admin para crear variantes via botón y agregar fotos de contexto por separado, permitir reordenar todo con drag & drop + flechas, y actualizar el catálogo para distinguir ambos tipos.

**Architecture:** Un único campo `image_type TEXT DEFAULT 'variant'` en la tabla existente diferencia variantes de fotos de contexto. El panel admin reemplaza la upload zone genérica con dos subsecciones (Variantes / Fotos de contexto) más una tercera sección de orden unificada. El catálogo filtra variantes para swatches y muestra todas las imágenes en el gallery.

**Tech Stack:** Node.js + Express, better-sqlite3 / PostgreSQL (`database.js`), vanilla JS, HTML5 Drag & Drop API, Cloudinary (upload sin cambios).

## Global Constraints

- Sin breaking changes: `image_type DEFAULT 'variant'` preserva todos los datos existentes
- No agregar dependencias externas (no librerías de drag & drop)
- Mantener el endpoint de reorder existente (`PUT /admin/products/:id/images/reorder`) sin cambios
- La función `getVariantStock(product, variantIdx)` vive en `public/js/cart.js` y es consumida por `catalog.js` y `products.js`
- `selectedVariantIdx` y las claves de carrito (`${productId}_${variantIdx}`) usan el índice dentro del array COMPLETO `product.images[]`, no del subconjunto de variantes

---

## Mapa de archivos

| Archivo | Cambio |
|---|---|
| `database.js` | Agregar `ALTER TABLE` para `image_type` en migrations batch |
| `routes/api.js` | POST `/admin/products/:id/images`: leer y almacenar `image_type` |
| `public/js/admin.js` | Reemplazar sección imágenes de `buildEditForm`, `setupEditFormEvents`, `uploadImages`; actualizar `openStockModal` |
| `public/js/products.js` | Filtrar swatches y out-of-stock logic a variantes solamente |
| `public/js/cart.js` | `getVariantStock`: retornar `product.stock` para imágenes de tipo `context` |

---

## Task 1: Migración de base de datos — columna `image_type`

**Files:**
- Modify: `database.js:161-171` (bloque de migrations idempotentes)

**Interfaces:**
- Produces: columna `image_type TEXT NOT NULL DEFAULT 'variant'` en `product_images`; todos los `SELECT *` de la tabla devuelven el campo automáticamente

- [ ] **Step 1: Agregar la línea de migration en `database.js`**

Buscar el bloque que empieza en la línea ~161:
```js
await pool.query(`
  ALTER TABLE products      ADD COLUMN IF NOT EXISTS price_public     INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE product_images ADD COLUMN IF NOT EXISTS color_name      TEXT    NOT NULL DEFAULT '';
  ALTER TABLE product_images ADD COLUMN IF NOT EXISTS stock           INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE product_images ADD COLUMN IF NOT EXISTS color_hex       TEXT    NOT NULL DEFAULT '';
  ...
`);
```

Agregar **al final del bloque**, antes del cierre de backtick:
```sql
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS image_type TEXT NOT NULL DEFAULT 'variant';
```

El bloque completo queda:
```js
  await pool.query(`
    ALTER TABLE products      ADD COLUMN IF NOT EXISTS price_public     INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE product_images ADD COLUMN IF NOT EXISTS color_name      TEXT    NOT NULL DEFAULT '';
    ALTER TABLE product_images ADD COLUMN IF NOT EXISTS stock           INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE product_images ADD COLUMN IF NOT EXISTS color_hex       TEXT    NOT NULL DEFAULT '';
    ALTER TABLE orders         ADD COLUMN IF NOT EXISTS client_club     TEXT    NOT NULL DEFAULT '';
    ALTER TABLE orders         ADD COLUMN IF NOT EXISTS client_dni      TEXT    NOT NULL DEFAULT '';
    ALTER TABLE orders         ADD COLUMN IF NOT EXISTS client_cuit     TEXT    NOT NULL DEFAULT '';
    ALTER TABLE orders         ADD COLUMN IF NOT EXISTS client_localidad TEXT   NOT NULL DEFAULT '';
    ALTER TABLE orders         ADD COLUMN IF NOT EXISTS client_email    TEXT    NOT NULL DEFAULT '';
    ALTER TABLE product_images ADD COLUMN IF NOT EXISTS image_type      TEXT    NOT NULL DEFAULT 'variant';
  `);
```

- [ ] **Step 2: Verificar**

Iniciar el servidor (`npm start`) y verificar en los logs que no hay errores de DB.
Abrir `http://localhost:3000/api/admin/products` (en sesión admin) y confirmar que los objetos `images[]` ahora incluyen `"image_type": "variant"` en cada entrada.

- [ ] **Step 3: Commit**

```bash
git add database.js
git commit -m "feat: add image_type column to product_images (default: variant)"
```

---

## Task 2: API — POST `/admin/products/:id/images` acepta `image_type`

**Files:**
- Modify: `routes/api.js:603-635` (handler POST images)

**Interfaces:**
- Consumes: `image_type` en `req.body` del form multipart (campo de texto, no archivo)
- Produces: registros insertados con el valor correcto de `image_type`; el response JSON incluye `image_type` en cada imagen

- [ ] **Step 1: Modificar el handler POST de imágenes**

Localizar la función en `routes/api.js` que empieza con:
```js
router.post('/admin/products/:id/images', requireAdmin, (req, res) => {
  upload.array('images', 20)(req, res, async (err) => {
```

Dentro del `try`, antes del loop `for (const file of req.files)`, agregar la lectura de `image_type`:

```js
const imageType = req.body.image_type === 'context' ? 'context' : 'variant';
```

Luego modificar el `INSERT` dentro del loop de:
```js
await db.prepare(
  `INSERT INTO product_images (product_id, filename, sort_order) VALUES (?, ?, ?)`
).run(product.id, url, nextOrder++);
```

a:
```js
await db.prepare(
  `INSERT INTO product_images (product_id, filename, sort_order, image_type) VALUES (?, ?, ?, ?)`
).run(product.id, url, nextOrder++, imageType);
```

El bloque completo del try queda:
```js
try {
  const db = getDb();
  const product = await db.prepare(`SELECT * FROM products WHERE id = ?`).get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

  const maxRow = await db.prepare(
    `SELECT MAX(sort_order) as m FROM product_images WHERE product_id = ?`
  ).get(product.id);
  let nextOrder = (maxRow?.m == null ? -1 : maxRow.m) + 1;

  const imageType = req.body.image_type === 'context' ? 'context' : 'variant';

  for (const file of req.files) {
    const url = await uploadToCloudinary(file.buffer, `pc3/${product.slug}`);
    await db.prepare(
      `INSERT INTO product_images (product_id, filename, sort_order, image_type) VALUES (?, ?, ?, ?)`
    ).run(product.id, url, nextOrder++, imageType);
  }

  const images = await db.prepare(
    `SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order`
  ).all(product.id);
  res.json(images);
} catch (e) {
  res.status(500).json({ error: e.message });
}
```

- [ ] **Step 2: Verificar**

Con el servidor corriendo, hacer un POST manual con curl o desde el admin (temporariamente) y confirmar que el campo `image_type` aparece en la respuesta con el valor correcto.

```bash
# Ejemplo: subir una imagen de contexto (reemplazar PRODUCT_ID y SESSION_COOKIE)
curl -X POST http://localhost:3000/api/admin/products/PRODUCT_ID/images \
  -H "Cookie: SESSION_COOKIE" \
  -F "images=@/path/to/foto.jpg" \
  -F "image_type=context"
```

La respuesta debe incluir `"image_type": "context"` en la imagen creada.

- [ ] **Step 3: Commit**

```bash
git add routes/api.js
git commit -m "feat: POST /images endpoint accepts image_type field"
```

---

## Task 3: Admin UI — Sección imágenes con variantes, fotos de contexto y orden

**Files:**
- Modify: `public/js/admin.js` — múltiples secciones

**Interfaces:**
- Consumes: `p.images[]` con campo `image_type` (de Task 1+2); endpoint `PUT /admin/products/:id/images/reorder` existente
- Produces: UI de tres subsecciones (Variantes / Fotos de contexto / Orden); funciones `uploadSingleImage(productId, file, imageType)`, `saveNewOrder(productId)`, `setupOrderDragDrop(productId)`

### Step 1: Reemplazar la sección de imágenes en `buildEditForm`

- [ ] **Step 1a: Agregar funciones helper antes de `buildEditForm`**

Buscar la función `buildEditForm` (que empieza con `function buildEditForm(p) {`) y agregar las siguientes funciones auxiliares **justo antes** de ella:

```js
// ─── Image section helpers ────────────────────────────────────
function buildVariantRow(p, img) {
  const hex = img.color_hex || '#cccccc';
  const libSwatches = admin.colors.map(c =>
    `<button type="button" class="lib-color-swatch" data-hex="${c.hex}" data-name="${c.name}"
      title="${c.name}"
      style="width:20px;height:20px;border-radius:50%;background:${c.hex};border:2px solid transparent;cursor:pointer;flex-shrink:0;transition:transform 0.12s,outline 0.12s;outline:2px solid transparent;outline-offset:1px">
    </button>`
  ).join('');

  return `
  <div class="img-color-row" data-img-id="${img.id}" style="display:flex;align-items:flex-start;gap:10px;padding:10px;background:var(--color-surface2);border-radius:8px">
    <div class="img-edit-thumb" title="Click para cambiar la foto"
      style="width:52px;height:52px;flex-shrink:0;position:relative;border-radius:6px;overflow:hidden">
      <img src="${productImgSrc(p.slug, img.filename)}" alt="${img.filename}"
        style="width:52px;height:52px;object-fit:cover;display:block">
      <div class="edit-thumb-hint" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
        <svg class="edit-thumb-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </div>
      <input type="file" class="img-replace-file" accept="image/*"
        data-img-id="${img.id}" data-product-id="${p.id}"
        style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%">
    </div>

    <div style="display:flex;flex-direction:column;gap:7px;flex:1;min-width:0">
      <input type="text" class="form-control img-color-name" data-img-id="${img.id}" data-product-id="${p.id}"
        value="${(img.color_name || '').replace(/"/g, '&quot;')}"
        placeholder="Nombre del color (ej: Rojo)" style="font-size:13px;padding:5px 8px">

      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:6px">
          <div class="img-color-preview" style="width:28px;height:28px;border-radius:50%;background:${hex};border:1.5px solid rgba(255,255,255,0.2);box-shadow:0 1px 4px rgba(0,0,0,0.3);flex-shrink:0"></div>
          <button type="button" class="img-eyedropper-btn" title="Tomar color de la foto"
            style="width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;padding:0;color:var(--color-text-muted)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/>
              <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>
            </svg>
          </button>
          <input type="text" class="form-control img-color-hex-text" data-img-id="${img.id}" data-product-id="${p.id}"
            value="${hex}" maxlength="7" placeholder="#rrggbb"
            style="width:80px;font-size:12px;padding:4px 6px;font-family:monospace">
        </div>
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">${libSwatches}</div>
      </div>

      <div style="display:flex;align-items:center;gap:6px">
        <label style="font-size:11px;color:var(--color-text-muted);white-space:nowrap">Stock:</label>
        <input type="number" class="form-control img-color-stock" data-img-id="${img.id}" data-product-id="${p.id}"
          value="${img.stock || 0}" min="0" style="width:80px;font-size:13px;padding:5px 8px">
      </div>
    </div>

    <button class="btn btn-danger btn-sm img-thumb-del" data-img-id="${img.id}" data-product-id="${p.id}"
      title="Eliminar variante" style="flex-shrink:0">✕</button>
  </div>`;
}

function buildPendingVariantRow() {
  return `
  <div class="img-color-row img-pending-row"
    style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--color-surface2);border-radius:8px;border:2px dashed var(--color-border,rgba(255,255,255,0.1))">
    <label style="width:52px;height:52px;flex-shrink:0;border-radius:6px;background:var(--color-surface3,rgba(255,255,255,0.05));display:flex;align-items:center;justify-content:center;cursor:pointer;flex-direction:column;gap:4px">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      <input type="file" class="pending-file-input" accept="image/*" style="display:none">
    </label>
    <span style="font-size:13px;color:var(--color-text-muted)">Seleccioná una foto para la nueva variante</span>
  </div>`;
}

function buildContextRow(p, img) {
  return `
  <div class="img-context-row" data-img-id="${img.id}"
    style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--color-surface2);border-radius:8px">
    <img src="${productImgSrc(p.slug, img.filename)}" alt="${img.filename}"
      style="width:52px;height:52px;object-fit:cover;border-radius:6px;flex-shrink:0">
    <span style="flex:1;font-size:13px;color:var(--color-text-muted)">Foto de contexto</span>
    <button class="btn btn-danger btn-sm img-thumb-del" data-img-id="${img.id}" data-product-id="${p.id}"
      title="Eliminar foto" style="flex-shrink:0">✕</button>
  </div>`;
}

function buildOrderList(p) {
  const images = p.images || [];
  if (!images.length) return '<p style="font-size:13px;color:var(--color-text-muted)">Aún no hay imágenes.</p>';
  return images.map((img) => `
    <div class="order-row" data-img-id="${img.id}" draggable="true"
      style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--color-surface2);border-radius:6px;cursor:default;user-select:none">
      <span class="drag-handle" style="cursor:grab;color:var(--color-text-muted);font-size:18px;line-height:1;flex-shrink:0">⠿</span>
      <img src="${productImgSrc(p.slug, img.filename)}" alt=""
        style="width:36px;height:36px;object-fit:cover;border-radius:4px;flex-shrink:0">
      <span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${img.image_type === 'context'
          ? '📷 Foto de contexto'
          : `🎨 Variante${img.color_name ? ' — ' + img.color_name : ''}`}
      </span>
      <button type="button" class="btn btn-ghost btn-sm order-up-btn" data-img-id="${img.id}" style="padding:3px 7px">↑</button>
      <button type="button" class="btn btn-ghost btn-sm order-down-btn" data-img-id="${img.id}" style="padding:3px 7px">↓</button>
    </div>`).join('');
}
```

- [ ] **Step 1b: Reemplazar la sección de imágenes dentro de `buildEditForm`**

Dentro de `buildEditForm(p)`, localizar el bloque que empieza con:
```js
    <!-- Images -->
    ${p ? `
    <div class="section-divider" style="margin-top:16px">Imágenes y colores</div>

    <div id="img-color-list" ...>
      ${(p.images || []).map((img) => { ... }).join('')}
    </div>

    <div class="upload-zone" id="upload-zone">
      ...
    </div>
    <input type="file" id="img-file-input" accept="image/*" multiple style="display:none">
    ` : ''}
```

Reemplazar **todo ese bloque** (desde el comentario `<!-- Images -->` hasta el cierre del template literal `\` : ''}`) por:

```js
    <!-- Images -->
    ${p ? `
    <div class="section-divider" style="margin-top:16px">🎨 Variantes de color</div>

    <div id="variant-list" style="display:flex;flex-direction:column;gap:10px;margin-bottom:10px">
      ${(p.images || []).filter(img => img.image_type !== 'context').map(img => buildVariantRow(p, img)).join('')}
    </div>
    <button type="button" class="btn btn-secondary btn-sm" id="btn-add-variant">＋ Nueva variante</button>

    <div class="section-divider" style="margin-top:20px">📷 Fotos de contexto</div>

    <div id="context-list" style="display:flex;flex-direction:column;gap:10px;margin-bottom:10px">
      ${(p.images || []).filter(img => img.image_type === 'context').map(img => buildContextRow(p, img)).join('')}
    </div>
    <input type="file" id="ctx-file-input" accept="image/*" multiple style="display:none">
    <button type="button" class="btn btn-secondary btn-sm" id="btn-add-context">＋ Agregar foto de contexto</button>

    <div class="section-divider" style="margin-top:20px">🔀 Orden de visualización</div>
    <p style="font-size:12px;color:var(--color-text-muted);margin:0 0 8px">Arrastrá o usá las flechas para definir el orden en que aparecen en el catálogo.</p>
    <div id="order-list" style="display:flex;flex-direction:column;gap:6px">
      ${buildOrderList(p)}
    </div>
    ` : ''}
```

- [ ] **Step 1c: Actualizar la condición del campo "Stock disponible" en `buildEditForm`**

Localizar el bloque (líneas ~287-296):
```js
        ${p && p.images && p.images.length > 0
          ? `<button type="button" class="btn btn-secondary btn-sm" id="btn-manage-stock" ...>`
          : `<input type="number" class="form-control" id="ef-stock" ...>`
        }
```

Reemplazar la condición `p.images.length > 0` por `p.images && p.images.some(img => img.image_type !== 'context')`:

```js
        ${p && p.images && p.images.some(img => img.image_type !== 'context')
          ? `<button type="button" class="btn btn-secondary btn-sm" id="btn-manage-stock" style="margin-top:2px">
               📦 Gestionar stock por color
             </button>`
          : `<input type="number" class="form-control" id="ef-stock" value="${p?.stock ?? ''}" placeholder="100" min="0">`
        }
```

Y la etiqueta de la label de Stock (líneas ~287-289):
```js
        ${p && p.images && p.images.some(img => img.image_type !== 'context')
          ? '<span style="font-size:11px;color:var(--color-text-muted)"> (por color)</span>'
          : ''}
```

### Step 2: Reemplazar los event handlers de imágenes en `setupEditFormEvents`

- [ ] **Step 2a: Reemplazar bloque de Image upload/events**

Dentro de `setupEditFormEvents(product)`, localizar el bloque que comienza con:
```js
    // Image delete
    document.getElementById('img-color-list')?.addEventListener('click', async (e) => {
```

y termina con:
```js
    fileInput?.addEventListener('change', () => uploadImages(product.id, fileInput.files));
  }
}
```

Reemplazar **todo ese bloque interno** (desde `// Image delete` hasta el último `}` del `if (product)`) con:

```js
  if (product) {
    // ── Delete (variantes y contexto) ───────────────────────────
    document.getElementById('edit-panel-body')?.addEventListener('click', async (e) => {
      if (!e.target.classList.contains('img-thumb-del')) return;
      const label = e.target.closest('.img-context-row') ? 'foto de contexto' : 'variante';
      if (!confirm(`¿Eliminar esta ${label}? Se borrará la imagen permanentemente.`)) return;
      const imgId     = e.target.dataset.imgId;
      const productId = e.target.dataset.productId;
      try {
        await api(`/admin/products/${productId}/images/${imgId}`, { method: 'DELETE' });
        e.target.closest('.img-color-row, .img-context-row')?.remove();
        // Rebuild order list from in-memory data
        const prod = admin.products.find(p => p.id === parseInt(productId));
        if (prod) {
          prod.images = prod.images.filter(i => i.id !== parseInt(imgId));
          const orderEl = document.getElementById('order-list');
          if (orderEl) orderEl.innerHTML = buildOrderList(prod);
          setupOrderDragDrop(parseInt(productId));
        }
        toast('Imagen eliminada');
      } catch (err) { toast(err.message, 'error'); }
    });

    // ── Eyedropper ──────────────────────────────────────────────
    document.getElementById('variant-list')?.addEventListener('click', (e) => {
      if (e.target.closest('.img-eyedropper-btn')) {
        const row   = e.target.closest('.img-color-row');
        const imgEl = row?.querySelector('.img-edit-thumb img');
        if (!imgEl) return;
        openEyedropper(imgEl.src, (hex) => {
          const preview = row.querySelector('.img-color-preview');
          const hexText = row.querySelector('.img-color-hex-text');
          if (preview) preview.style.background = hex;
          if (hexText) { hexText.value = hex; hexText.dispatchEvent(new Event('change', { bubbles: true })); }
        });
      }
      // Library swatch click
      if (e.target.classList.contains('lib-color-swatch')) {
        const hex       = e.target.dataset.hex;
        const name      = e.target.dataset.name;
        const row       = e.target.closest('.img-color-row');
        if (!row) return;
        const preview   = row.querySelector('.img-color-preview');
        const hexText   = row.querySelector('.img-color-hex-text');
        const nameInput = row.querySelector('.img-color-name');
        if (preview)   preview.style.background = hex;
        if (hexText)   hexText.value = hex;
        if (nameInput && !nameInput.value.trim()) nameInput.value = name;
        row.querySelector('.img-color-hex-text').dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    // ── Autosave color name / hex / stock ────────────────────────
    document.getElementById('variant-list')?.addEventListener('change', async (e) => {
      const isColorName = e.target.classList.contains('img-color-name');
      const isStock     = e.target.classList.contains('img-color-stock');
      const isHexText   = e.target.classList.contains('img-color-hex-text');
      if (!isColorName && !isStock && !isHexText) return;

      const imgId     = e.target.dataset.imgId;
      const productId = e.target.dataset.productId;
      const row       = e.target.closest('.img-color-row');
      if (!row || row.classList.contains('img-pending-row')) return;

      if (isHexText) {
        const val = e.target.value.trim();
        if (/^#[0-9a-f]{6}$/i.test(val)) {
          const preview = row.querySelector('.img-color-preview');
          if (preview) preview.style.background = val;
        }
      }

      const colorName = row.querySelector('.img-color-name').value.trim();
      const colorHex  = row.querySelector('.img-color-hex-text').value.trim();
      const stock     = parseInt(row.querySelector('.img-color-stock').value) || 0;

      try {
        await api(`/admin/products/${productId}/images/${imgId}`, {
          method: 'PUT',
          body: { color_name: colorName, color_hex: colorHex, stock }
        });
        const prod = admin.products.find(p => p.id === parseInt(productId));
        if (prod) {
          const img = (prod.images || []).find(i => i.id === parseInt(imgId));
          if (img) { img.color_name = colorName; img.color_hex = colorHex; img.stock = stock; }
          // Refresh order list labels
          const orderEl = document.getElementById('order-list');
          if (orderEl) orderEl.innerHTML = buildOrderList(prod);
          setupOrderDragDrop(parseInt(productId));
        }
      } catch (err) { toast(err.message, 'error'); }
    });

    // ── Variant photo replacement ────────────────────────────────
    document.getElementById('variant-list')?.addEventListener('change', async (e) => {
      if (!e.target.classList.contains('img-replace-file')) return;
      const file      = e.target.files[0];
      if (!file) return;
      const imgId     = e.target.dataset.imgId;
      const productId = e.target.dataset.productId;
      const row       = e.target.closest('.img-color-row');
      const thumbImg  = row?.querySelector('.img-edit-thumb img');
      const originalSrc = thumbImg?.src;
      if (thumbImg) thumbImg.src = URL.createObjectURL(file);
      const formData = new FormData();
      formData.append('image', file);
      try {
        const res = await fetch(`/api/admin/products/${productId}/images/${imgId}/file`, {
          method: 'PUT',
          body: formData,
        });
        if (!res.ok) throw new Error('Error subiendo imagen');
        invalidateCache();
        toast('Foto actualizada');
      } catch (err) {
        if (thumbImg && originalSrc) thumbImg.src = originalSrc;
        toast(err.message, 'error');
      }
      e.target.value = '';
    });

    // ── Nueva variante (pending row) ─────────────────────────────
    document.getElementById('btn-add-variant')?.addEventListener('click', () => {
      const list = document.getElementById('variant-list');
      if (!list || list.querySelector('.img-pending-row')) return;
      list.insertAdjacentHTML('beforeend', buildPendingVariantRow());
      list.querySelector('.img-pending-row .pending-file-input')?.click();
    });

    // Pending file input → upload variant
    document.getElementById('variant-list')?.addEventListener('change', async (e) => {
      if (!e.target.classList.contains('pending-file-input')) return;
      const file = e.target.files[0];
      if (!file) return;
      await uploadSingleImage(product.id, file, 'variant');
    });

    // ── Agregar foto de contexto ─────────────────────────────────
    document.getElementById('btn-add-context')?.addEventListener('click', () => {
      document.getElementById('ctx-file-input')?.click();
    });

    document.getElementById('ctx-file-input')?.addEventListener('change', async (e) => {
      const files = e.target.files;
      if (!files || !files.length) return;
      for (const file of Array.from(files)) {
        await uploadSingleImage(product.id, file, 'context');
      }
      e.target.value = '';
    });

    // ── Orden: flechas y drag & drop ────────────────────────────
    setupOrderDragDrop(product.id);

    document.getElementById('order-list')?.addEventListener('click', async (e) => {
      const upBtn   = e.target.closest('.order-up-btn');
      const downBtn = e.target.closest('.order-down-btn');
      if (!upBtn && !downBtn) return;

      const list = document.getElementById('order-list');
      const row  = (upBtn || downBtn).closest('.order-row');
      const rows = [...list.querySelectorAll('.order-row')];
      const idx  = rows.indexOf(row);

      if (upBtn && idx > 0) {
        list.insertBefore(row, rows[idx - 1]);
        await saveNewOrder(product.id);
      } else if (downBtn && idx < rows.length - 1) {
        list.insertBefore(rows[idx + 1], row);
        await saveNewOrder(product.id);
      }
    });
  }
}
```

### Step 3: Reemplazar `uploadImages` y agregar nuevas funciones

- [ ] **Step 3a: Reemplazar la función `uploadImages`**

Localizar:
```js
async function uploadImages(productId, files) {
  if (!files || !files.length) return;
  ...
}
```

Reemplazar por:
```js
async function uploadSingleImage(productId, file, imageType) {
  const formData = new FormData();
  formData.append('images', file);
  formData.append('image_type', imageType);
  try {
    const res = await fetch(`/api/admin/products/${productId}/images`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error subiendo imagen');
    }
    toast('Imagen subida');
    const products = await api('/admin/products');
    admin.products = products;
    openEditPanel(productId);
  } catch (e) {
    toast(e.message, 'error');
  }
}
```

- [ ] **Step 3b: Agregar `saveNewOrder` y `setupOrderDragDrop` después de `uploadSingleImage`**

```js
async function saveNewOrder(productId) {
  const list = document.getElementById('order-list');
  if (!list) return;
  const rows  = [...list.querySelectorAll('.order-row')];
  const order = rows.map((row, i) => ({ id: parseInt(row.dataset.imgId), sort_order: i }));
  try {
    await api(`/admin/products/${productId}/images/reorder`, { method: 'PUT', body: { order } });
    // Sync in-memory sort_order
    const prod = admin.products.find(p => p.id === productId);
    if (prod && prod.images) {
      const byId = {};
      prod.images.forEach(img => { byId[img.id] = img; });
      prod.images = order.map(o => byId[o.id]).filter(Boolean);
      prod.images.forEach((img, i) => { img.sort_order = i; });
    }
  } catch (err) {
    toast('Error guardando orden: ' + err.message, 'error');
  }
}

function setupOrderDragDrop(productId) {
  const list = document.getElementById('order-list');
  if (!list) return;
  let dragSrc = null;

  list.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.order-row');
    if (!row) return;
    dragSrc = row;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => { if (dragSrc) dragSrc.style.opacity = '0.4'; }, 0);
  });

  list.addEventListener('dragend', () => {
    if (dragSrc) { dragSrc.style.opacity = '1'; dragSrc = null; }
    list.querySelectorAll('.order-row').forEach(r => r.classList.remove('drag-over'));
  });

  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const row = e.target.closest('.order-row');
    list.querySelectorAll('.order-row').forEach(r => r.classList.remove('drag-over'));
    if (row && row !== dragSrc) row.classList.add('drag-over');
  });

  list.addEventListener('dragleave', (e) => {
    if (!list.contains(e.relatedTarget)) {
      list.querySelectorAll('.order-row').forEach(r => r.classList.remove('drag-over'));
    }
  });

  list.addEventListener('drop', async (e) => {
    e.preventDefault();
    const targetRow = e.target.closest('.order-row');
    list.querySelectorAll('.order-row').forEach(r => r.classList.remove('drag-over'));
    if (!targetRow || !dragSrc || targetRow === dragSrc) return;

    const rows   = [...list.querySelectorAll('.order-row')];
    const srcIdx = rows.indexOf(dragSrc);
    const tgtIdx = rows.indexOf(targetRow);
    if (srcIdx < tgtIdx) {
      list.insertBefore(dragSrc, targetRow.nextSibling);
    } else {
      list.insertBefore(dragSrc, targetRow);
    }
    await saveNewOrder(productId);
  });
}
```

### Step 4: Actualizar `openStockModal` para ignorar fotos de contexto

- [ ] **Step 4a: Filtrar imágenes de contexto en el stock modal**

Localizar en `openStockModal` (línea ~679):
```js
const hasVariants = product.images && product.images.length > 0;

if (hasVariants) {
  body.innerHTML = product.images.map(img => `
```

Cambiar a:
```js
const variantImages = (product.images || []).filter(img => img.image_type !== 'context');
const hasVariants   = variantImages.length > 0;

if (hasVariants) {
  body.innerHTML = variantImages.map(img => `
```

El resto del bloque del stock modal permanece igual, ya que ahora itera `variantImages` en lugar de `product.images`.

### Step 5: Agregar estilo drag-over en CSS

- [ ] **Step 5a: Agregar clase `.drag-over` al CSS del admin**

Buscar `public/css/admin.css` y agregar al final:

```css
/* ─── Order drag & drop ─────────────────────── */
.order-row.drag-over {
  outline: 2px solid var(--color-primary, #6366f1);
  background: var(--color-surface3, rgba(255,255,255,0.08)) !important;
}
```

### Step 6: Verificación manual

- [ ] **Step 6a: Probar "Nueva variante"**

1. Abrir `http://localhost:3000/admin`
2. Editar cualquier producto
3. Click en "＋ Nueva variante" → debe aparecer una fila con placeholder y abrirse el selector de archivo
4. Seleccionar una imagen → debe subirse y el panel debe re-renderizarse con la nueva variante
5. La sección "Orden de visualización" debe mostrar la nueva variante

- [ ] **Step 6b: Probar "Agregar foto de contexto"**

1. En el mismo panel de edición, click en "＋ Agregar foto de contexto"
2. Seleccionar una imagen → debe aparecer en la subsección "Fotos de contexto"
3. La sección "Orden" debe mostrarla con el label "📷 Foto de contexto"

- [ ] **Step 6c: Probar reordenamiento**

1. En la sección "Orden de visualización", usar las flechas ↑↓ para mover ítems
2. Cerrar y reabrir el panel → el orden debe persistir
3. Probar drag & drop arrastrando un ítem

- [ ] **Step 6d: Verificar que el delete funciona**

1. Eliminar una variante con ✕ → debe desaparecer de variantes y de la sección de orden
2. Eliminar una foto de contexto → mismo comportamiento

- [ ] **Step 7: Commit**

```bash
git add public/js/admin.js public/css/admin.css
git commit -m "feat: admin UI — variants via button, context photos, drag&drop reorder"
```

---

## Task 4: Catálogo — filtrar swatches solo a variantes

**Files:**
- Modify: `public/js/products.js:63-191` (función `buildProductRow`) y `public/js/products.js:194-345` (función `setupRowInteractions`)

**Interfaces:**
- Consumes: `product.images[]` con campo `image_type`
- Produces: swatches y lógica out-of-stock basados solo en `image_type === 'variant'`; `data-swatch-idx` sigue siendo índice en el array completo `product.images[]`

- [ ] **Step 1: Actualizar `buildProductRow` para filtrar variantes**

En `public/js/products.js`, dentro de `buildProductRow(product, section, rowNum)`, localizar:

```js
  // Helper: effective stock for an image entry
  const imgStock = (img) => img.stock != null ? img.stock : (product.stock || 0);

  // Fully out of stock = every variant (or product itself if no variants) has 0 stock
  const isFullyOutOfStock = images.length
    ? images.every(img => imgStock(img) === 0)
    : (product.stock || 0) === 0;

  // First index with stock > 0; fall back to 0 if all are out of stock
  const firstStockIdx = images.length
    ? images.findIndex(img => imgStock(img) > 0)
    : -1;
  const activeIdx = firstStockIdx >= 0 ? firstStockIdx : 0;
```

Reemplazar por:

```js
  // Helper: effective stock for an image entry
  const imgStock = (img) => img.stock != null ? img.stock : (product.stock || 0);

  // Only variant-type images drive swatches and out-of-stock logic
  const variants = images.filter(img => img.image_type !== 'context');

  // Fully out of stock = every variant (or product.stock if no variants) has 0 stock
  const isFullyOutOfStock = variants.length
    ? variants.every(img => imgStock(img) === 0)
    : (product.stock || 0) === 0;

  // First index (in full images[]) of a variant with stock > 0; fall back to 0
  const firstStockIdx = images.findIndex(img => img.image_type !== 'context' && imgStock(img) > 0);
  const activeIdx = firstStockIdx >= 0 ? firstStockIdx : 0;
```

- [ ] **Step 2: Actualizar swatchesHtml para solo renderizar variantes**

En la misma función, localizar:

```js
  // Color swatches — always shown if product has images
  const activeLabel = images[activeIdx]?.color_name || variantLabel(images[activeIdx]?.filename, activeIdx);
  const swatchesHtml = images.length > 0
    ? `<div class="row-swatches">
        <span class="row-swatches-label">COLOR</span>
        <div class="row-swatch-circles">
          ${images.map((img, i) => {
```

Reemplazar por:

```js
  // Color swatches — only shown when product has variant-type images
  const activeImg   = images[activeIdx];
  const activeLabel = (activeImg && activeImg.image_type !== 'context' && activeImg.color_name)
    ? activeImg.color_name
    : variantLabel(activeImg?.filename, activeIdx);

  const swatchesHtml = variants.length > 0
    ? `<div class="row-swatches">
        <span class="row-swatches-label">COLOR</span>
        <div class="row-swatch-circles">
          ${images.map((img, i) => {
            if (img.image_type === 'context') return '';  // skip context photos
```

El resto del `.map` callback (la parte que construye el `<button class="row-swatch ...">`) permanece igual.

- [ ] **Step 3: Actualizar `setupRowInteractions` para ignorar fotos de contexto en stock inicial**

En `setupRowInteractions(row)`, localizar:

```js
  const images = product.images || [];
  const imgStockFn = (img) => img.stock != null ? img.stock : (product.stock || 0);
  const firstStockIdx = images.findIndex(img => imgStockFn(img) > 0);
  let selectedVariantIdx = firstStockIdx >= 0 ? firstStockIdx : 0;
```

Reemplazar por:

```js
  const images = product.images || [];
  const imgStockFn = (img) => img.stock != null ? img.stock : (product.stock || 0);
  // Only pick variants as initial selection (context photos don't have per-variant stock)
  const firstStockIdx = images.findIndex(img => img.image_type !== 'context' && imgStockFn(img) > 0);
  let selectedVariantIdx = firstStockIdx >= 0 ? firstStockIdx : 0;
```

- [ ] **Step 4: Verificación manual**

1. Abrir el catálogo: los swatches de un producto con fotos de contexto deben mostrar SOLO las variantes (no las fotos de contexto)
2. El contador "N colores" debe contar solo variantes
3. Un producto sin variantes (solo fotos de contexto) no debe mostrar swatches

- [ ] **Step 5: Commit**

```bash
git add public/js/products.js
git commit -m "feat: catalog swatches and stock logic filter to variant images only"
```

---

## Task 5: Cart y preview modal — stock correcto para fotos de contexto

**Files:**
- Modify: `public/js/cart.js:9-14` (función `getVariantStock`)
- Modify: `public/js/cart.js:22-25` (función `addToCart`, campo `colorName`)

**Interfaces:**
- Consumes: `product.images[variantIdx].image_type` (disponible tras Task 1)
- Produces: `getVariantStock` retorna `product.stock` para slides de tipo `context`; `addToCart` no asigna nombre de color a compras desde fotos de contexto

- [ ] **Step 1: Actualizar `getVariantStock` en `cart.js`**

Localizar en `public/js/cart.js`:

```js
function getVariantStock(product, variantIdx) {
  const image = product.images && product.images[variantIdx];
  // null stock means "not set" → use product.stock; 0 or positive means explicit value
  if (image && image.stock != null) return image.stock;
  return product.stock || 0;
}
```

Reemplazar por:

```js
function getVariantStock(product, variantIdx) {
  const image = product.images && product.images[variantIdx];
  if (!image) return product.stock || 0;
  // Context photos don't have per-variant stock — fall back to product.stock
  if (image.image_type === 'context') return product.stock || 0;
  // null stock means "not set" → use product.stock; 0 or positive means explicit value
  if (image.stock != null) return image.stock;
  return product.stock || 0;
}
```

- [ ] **Step 2: Actualizar `colorName` en `addToCart` para fotos de contexto**

En la misma función `addToCart`:

```js
  const image = product.images && product.images[idx];
  const colorName = (image && image.color_name)
    ? image.color_name
    : (image ? (`Var. ${idx + 1}`) : '');
```

Reemplazar por:

```js
  const image = product.images && product.images[idx];
  const isContext = image && image.image_type === 'context';
  const colorName = isContext
    ? ''
    : ((image && image.color_name) ? image.color_name : (image ? `Var. ${idx + 1}` : ''));
```

- [ ] **Step 3: Verificación manual**

1. En el catálogo, abrir el detalle de un producto que tenga fotos de contexto mezcladas con variantes
2. Navegar hasta un slide que sea foto de contexto → el stock mostrado debe ser el stock general del producto (no 0)
3. Agregar al carrito desde ese slide → en el carrito no debe aparecer nombre de color
4. Navegar a un slide de variante → el stock correcto de esa variante

- [ ] **Step 4: Commit**

```bash
git add public/js/cart.js
git commit -m "feat: getVariantStock and addToCart handle context image type"
```

---

## Self-Review

### Cobertura del spec

| Requerimiento | Task |
|---|---|
| Columna `image_type` en DB con default `'variant'` | Task 1 |
| POST images acepta `image_type` | Task 2 |
| Variantes via botón "＋ Nueva variante" → fila vacía → subir foto | Task 3, Step 2 |
| Fotos de contexto via botón → file picker directo | Task 3, Step 2 |
| Drag & drop para reordenar | Task 3, Steps 3b + 5 |
| Botones ↑↓ para reordenar | Task 3, Step 2 |
| Sección unificada de orden | Task 3, Steps 1b + 3a |
| Labels diferenciados en sección orden | Task 3, Step 1a (`buildOrderList`) |
| Swatches solo variantes en lista de productos | Task 4 |
| Gallery muestra todas las imágenes en preview modal | Sin cambio necesario — ya muestra `product.images[]` completo |
| Stock efectivo para slides de contexto = product.stock | Task 5 |
| colorName vacío al agregar desde contexto | Task 5, Step 2 |
| `openStockModal` filtra contexto | Task 3, Step 4a |
| Compatibilidad con datos existentes | Task 1 (DEFAULT 'variant') |

### Tipo consistency

- `image_type`: siempre string `'variant'` o `'context'`
- `data-img-id` en `.order-row`: id numérico del registro; `saveNewOrder` usa `parseInt(row.dataset.imgId)`
- `selectedVariantIdx`: índice en `product.images[]` completo — consistente entre `products.js`, `cart.js` y `catalog.js`
- `buildOrderList` recibe el objeto producto `p` completo (no solo `p.images`) para poder acceder a `p.slug`

### Placeholders

Ninguno — cada step contiene el código completo.
