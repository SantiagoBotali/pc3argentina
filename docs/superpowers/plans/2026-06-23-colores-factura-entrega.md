# Colores por ítem, facturación y entrega — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar stock y nombre por color en productos, distinguir colores en el carrito como ítems separados, tipo de comprobante en checkout, tipos de entrega Andreani/Retiro, y edición manual de cantidad en el carrito.

**Architecture:** Migración de DB en `database.js` agrega `color_name` + `stock` a `product_images`. El carrito cambia su clave de `productId` a `"productId_variantIdx"`. El checkout recibe dos campos nuevos (comprobante + tipo entrega). El admin recibe un editor inline de color/stock por imagen.

**Tech Stack:** Node.js/Express, sql.js (SQLite), vanilla JS, HTML/CSS sin frameworks.

## Global Constraints

- Sin librerías nuevas — todo vanilla JS y las dependencias ya instaladas.
- La DB se persiste en `db/pc3.sqlite` mediante `database.save()` tras cada escritura.
- Todo HTML de admin y catálogo se genera como strings JS (no hay motor de plantillas para vistas parciales).
- El admin usa `api()` (helper fetch en `admin.js`) para todas las llamadas.
- El catálogo usa `fetch` directo con `state.products` ya cargado en memoria.
- No crear archivos nuevos salvo lo indicado.

---

## File Map

| Archivo | Cambios |
|---|---|
| `database.js` | Migración: ALTER TABLE product_images ADD COLUMN color_name, stock |
| `routes/api.js` | Nuevo PUT /admin/products/:id/images/:imgId; actualizar validate-stock |
| `public/js/cart.js` | Clave compuesta; qty editable; actualizar event listeners |
| `public/js/catalog.js` | Migración de localStorage al cargar |
| `public/js/checkout.js` | Campo comprobante; opción Andreani; mensaje WhatsApp |
| `public/js/admin.js` | Editor color_name/stock por imagen; deshabilitar stock general cuando hay imágenes |

---

## Task 1: Migración de DB — color_name y stock en product_images

**Files:**
- Modify: `database.js:36-89`

**Interfaces:**
- Produces: columnas `color_name TEXT DEFAULT ''` y `stock INTEGER DEFAULT 0` en `product_images`; todas las queries existentes siguen funcionando sin cambio.

- [ ] **Step 1: Agregar migración en `database.js` dentro de `init()`, justo después del bloque que crea `product_images`**

Localizar la línea que hace `save()` al final del bloque de CREATE TABLE (línea ~88) e insertar el siguiente bloque justo antes:

```javascript
  // Migrate: add color_name and stock to product_images if not present
  const piCols = sqlDb.exec('PRAGMA table_info(product_images)');
  if (piCols.length > 0) {
    const existingCols = piCols[0].values.map(row => row[1]);
    if (!existingCols.includes('color_name')) {
      sqlDb.run("ALTER TABLE product_images ADD COLUMN color_name TEXT NOT NULL DEFAULT ''");
    }
    if (!existingCols.includes('stock')) {
      sqlDb.run("ALTER TABLE product_images ADD COLUMN stock INTEGER NOT NULL DEFAULT 0");
    }
  }
```

El bloque queda entre el último `sqlDb.run(\`CREATE TABLE IF NOT EXISTS settings...\`)` y el `save()` final.

- [ ] **Step 2: Verificar manualmente**

```bash
cd "C:/Users/santi/OneDrive/Desktop/PC3"
node -e "
const {init} = require('./database');
init().then(db => {
  const cols = db.prepare('PRAGMA table_info(product_images)').all();
  console.log(cols.map(c => c.name));
  process.exit(0);
});
"
```

Resultado esperado: array que incluye `'color_name'` y `'stock'`.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/santi/OneDrive/Desktop/PC3" add database.js
git -C "C:/Users/santi/OneDrive/Desktop/PC3" commit -m "feat: add color_name and stock columns to product_images"
```

---

## Task 2: API — endpoint de imagen y validate-stock por color

**Files:**
- Modify: `routes/api.js:70-84` (validate-stock), agregar endpoint después de línea ~211 (router.put images/reorder)

**Interfaces:**
- Produces:
  - `PUT /api/admin/products/:id/images/:imgId` — body: `{ color_name: string, stock: number }`, devuelve la imagen actualizada.
  - `POST /api/validate-stock` — ahora acepta `variant_idx` en cada ítem; valida contra `product_images.stock` cuando está disponible.

- [ ] **Step 1: Agregar endpoint `PUT /admin/products/:id/images/:imgId`**

Insertar después del bloque `router.put('/admin/products/:id/images/reorder', ...)` (línea ~211 de `routes/api.js`):

```javascript
router.put('/admin/products/:id/images/:imgId', requireAdmin, (req, res) => {
  const db = getDb();
  const { color_name, stock } = req.body;
  const img = db.prepare(
    `SELECT * FROM product_images WHERE id = ? AND product_id = ?`
  ).get(req.params.imgId, req.params.id);
  if (!img) return res.status(404).json({ error: 'Imagen no encontrada' });

  db.prepare(
    `UPDATE product_images SET color_name = ?, stock = ? WHERE id = ?`
  ).run(
    color_name != null ? String(color_name).trim() : img.color_name,
    stock != null ? parseInt(stock) : img.stock,
    req.params.imgId
  );
  res.json(db.prepare(`SELECT * FROM product_images WHERE id = ?`).get(req.params.imgId));
});
```

- [ ] **Step 2: Actualizar `POST /api/validate-stock` (línea ~70-84)**

Reemplazar el bloque completo `router.post('/validate-stock', ...)` con:

```javascript
router.post('/validate-stock', (req, res) => {
  const db = getDb();
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items requerido' });

  const issues = [];
  for (const item of items) {
    const product = db.prepare(`SELECT id, name, stock FROM products WHERE id = ?`).get(item.product_id);
    if (!product) continue;

    // Use per-color stock when variant_idx is provided and the image has stock > 0
    let availableStock = product.stock;
    if (item.variant_idx != null) {
      const img = db.prepare(
        `SELECT stock FROM product_images WHERE product_id = ? AND sort_order = ?`
      ).get(item.product_id, item.variant_idx);
      if (img && img.stock > 0) availableStock = img.stock;
    }

    if (item.quantity > availableStock) {
      issues.push({
        product_id: product.id,
        name: product.name,
        available: availableStock,
        requested: item.quantity
      });
    }
  }
  res.json({ valid: issues.length === 0, issues });
});
```

- [ ] **Step 3: Verificar manualmente**

Iniciar servidor (`npm start`) y hacer:

```bash
curl -s -X PUT http://localhost:3000/api/admin/products/1/images/1 \
  -H "Content-Type: application/json" \
  -d '{"color_name":"Rojo","stock":10}' \
  -b "connect.sid=<sesion_admin>"
```

Esperado: JSON con la imagen actualizada incluyendo `color_name: "Rojo"` y `stock: 10`.

Si no tenés sesión admin disponible, verificar desde el browser en `/admin` tras implementar Task 5.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/santi/OneDrive/Desktop/PC3" add routes/api.js
git -C "C:/Users/santi/OneDrive/Desktop/PC3" commit -m "feat: add image color/stock endpoint and per-color validate-stock"
```

---

## Task 3: Carrito con clave compuesta + cantidad editable

**Files:**
- Modify: `public/js/cart.js` (completo)
- Modify: `public/js/catalog.js:423-428` (loadCartFromStorage)
- Modify: `public/js/products.js:256-269` (syncCart — usa removeFromCart con clave compuesta)

**Interfaces:**
- Consumes: `state.carts[section]` — objeto con claves `"productId_variantIdx"`; cada ítem: `{ productId, variantIdx, colorName, quantity, stockIssue }`
- Produces:
  - `window.addToCart(productId, quantity, section, variantIdx, silent)` — igual firma, ahora usa clave compuesta
  - `window.removeFromCart(key, section)` — `key` es `"productId_variantIdx"`
  - `window.updateCartQty(key, quantity, section)` — `key` es `"productId_variantIdx"`
  - `window.renderCartSidebar(section)` — sin cambio en firma

- [ ] **Step 1: Reemplazar `window.addToCart` en `cart.js` (líneas 2-19)**

```javascript
window.addToCart = function(productId, quantity, section, variantIdx, silent) {
  const s = section || state.activeSection;
  const product = state.products.find(p => p.id === productId);
  if (!product) return;

  const idx = variantIdx != null ? variantIdx : 0;
  const image = product.images && product.images[idx];
  const colorName = (image && image.color_name) ? image.color_name : '';
  const imageStock = (image && image.stock > 0) ? image.stock : product.stock;
  const stockIssue = quantity > imageStock;
  const key = `${productId}_${idx}`;

  state.carts[s][key] = { productId, quantity, stockIssue, variantIdx: idx, colorName };
  saveCartToStorage();
  updateCartUI();
  if (!silent) {
    const colorSuffix = colorName ? ` (${colorName})` : '';
    showToast(`${product.name}${colorSuffix} agregado al carrito`, 'success');
  }
};
```

- [ ] **Step 2: Reemplazar `window.removeFromCart` (líneas 21-26)**

```javascript
window.removeFromCart = function(key, section) {
  const s = section || state.activeSection;
  delete state.carts[s][key];
  saveCartToStorage();
  updateCartUI();
};
```

- [ ] **Step 3: Reemplazar `window.updateCartQty` (líneas 28-38)**

```javascript
window.updateCartQty = function(key, quantity, section) {
  const s = section || state.activeSection;
  if (quantity < 1) return removeFromCart(key, s);
  const existing = state.carts[s][key];
  if (!existing) return;
  const product = state.products.find(p => p.id === existing.productId);
  if (!product) return;
  const image = product.images && product.images[existing.variantIdx];
  const imageStock = (image && image.stock > 0) ? image.stock : product.stock;
  const stockIssue = quantity > imageStock;
  state.carts[s][key] = { ...existing, quantity, stockIssue };
  saveCartToStorage();
  updateCartUI();
};
```

- [ ] **Step 4: Reemplazar `buildCartItemHTML` (líneas 186-218)**

```javascript
function buildCartItemHTML(item, section) {
  const product = state.products.find(p => p.id === item.productId);
  if (!product) return '';

  const key = `${item.productId}_${item.variantIdx}`;
  const { price, tier } = getEffectivePrice(product, section, item.quantity);
  const subtotal = price * item.quantity;
  const variantIdx = item.variantIdx || 0;
  const firstImg = product.images && product.images[variantIdx];
  const imgSrc = firstImg ? `/productos/${product.slug}/${firstImg.filename}` : '';
  const colorLabel = item.colorName ? ` — ${item.colorName}` : '';

  return `
  <div class="cart-item ${item.stockIssue ? 'has-stock-issue' : ''}">
    <div class="cart-item-img">
      ${imgSrc ? `<img src="${imgSrc}" alt="${product.name}">` : ''}
    </div>
    <div class="cart-item-info">
      <div class="cart-item-name">${product.name}${colorLabel}</div>
      ${tier ? `<div class="cart-item-discount">✓ ${tier.percentage}% OFF aplicado</div>` : ''}
      ${item.stockIssue ? `<div class="cart-stock-warning">⚠ Stock insuficiente</div>` : ''}
      <div class="cart-item-qty-row">
        <button class="cart-qty-btn cart-qty-minus" data-key="${key}">−</button>
        <input type="number" class="cart-qty-btn cart-item-qty-input" data-key="${key}" value="${item.quantity}" min="1"
          style="width:48px;text-align:center;border:1px solid var(--color-border);border-radius:4px;background:var(--color-surface2);color:var(--color-text);padding:2px 4px;font-size:13px">
        <button class="cart-qty-btn cart-qty-plus" data-key="${key}">+</button>
        <span class="cart-item-subtotal">${fmt(subtotal)}</span>
      </div>
    </div>
    <button class="cart-item-remove" data-key="${key}" aria-label="Eliminar">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  </div>`;
}
```

- [ ] **Step 5: Actualizar los event listeners en `renderCartSidebar` (líneas 127-149)**

Reemplazar el bloque de `querySelectorAll` dentro del `else` de `items.length === 0`:

```javascript
      itemsEl.innerHTML = items.map(item => buildCartItemHTML(item, section)).join('');

      itemsEl.querySelectorAll('.cart-qty-minus').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.key;
          const item = state.carts[section][key];
          if (item) updateCartQty(key, item.quantity - 1, section);
        });
      });

      itemsEl.querySelectorAll('.cart-qty-plus').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.key;
          const item = state.carts[section][key];
          if (item) updateCartQty(key, item.quantity + 1, section);
        });
      });

      itemsEl.querySelectorAll('.cart-item-qty-input').forEach(input => {
        input.addEventListener('change', () => {
          const key = input.dataset.key;
          const qty = parseInt(input.value) || 1;
          updateCartQty(key, Math.max(1, qty), section);
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') input.blur();
        });
      });

      itemsEl.querySelectorAll('.cart-item-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.key;
          removeFromCart(key, section);
        });
      });
```

- [ ] **Step 6: Actualizar `syncCart` en `products.js` (líneas 256-269) para usar clave compuesta al remover**

Reemplazar el bloque `const syncCart = (qty, immediate = false) => { ... }`:

```javascript
  const syncCart = (qty, immediate = false) => {
    clearTimeout(autoAddTimer);
    const key = `${productId}_${selectedVariantIdx}`;
    if (qty === 0) {
      if (state.carts[section][key]) window.removeFromCart(key, section);
    } else if (product.stock > 0) {
      if (immediate) {
        window.addToCart(productId, qty, section, selectedVariantIdx, true);
      } else {
        autoAddTimer = setTimeout(() => {
          window.addToCart(productId, qty, section, selectedVariantIdx, true);
        }, 380);
      }
    }
  };
```

- [ ] **Step 8: Migrar formato viejo de localStorage en `catalog.js` — reemplazar `loadCartFromStorage` (líneas 423-428)**

```javascript
function loadCartFromStorage() {
  try {
    const saved = localStorage.getItem('pc3_carts');
    if (!saved) return;
    const parsed = JSON.parse(saved);

    const migrate = (cart) => {
      if (!cart) return {};
      const migrated = {};
      for (const [key, item] of Object.entries(cart)) {
        // Old format: key is a plain number (productId). New: "productId_variantIdx"
        const newKey = String(key).includes('_') ? key : `${key}_${item.variantIdx || 0}`;
        migrated[newKey] = {
          ...item,
          variantIdx: item.variantIdx || 0,
          colorName: item.colorName || ''
        };
      }
      return migrated;
    };

    state.carts = {
      profesional: migrate(parsed.profesional),
      mayorista: migrate(parsed.mayorista)
    };
  } catch (e) { /* ignore corrupt storage */ }
}
```

- [ ] **Step 9: Verificar manualmente**

1. `npm start`
2. Abrir `http://localhost:3000`
3. En un producto con múltiples colores, seleccionar color 1 y agregar al carrito, luego seleccionar color 2 del mismo producto y agregar
4. Abrir el carrito → deben aparecer **dos líneas separadas** con el mismo producto pero distinto color
5. Editar la cantidad en el input numérico del carrito → debe cambiar el subtotal
6. Verificar que el ✕ elimina solo ese color

- [ ] **Step 10: Commit**

```bash
git -C "C:/Users/santi/OneDrive/Desktop/PC3" add public/js/cart.js public/js/catalog.js public/js/products.js
git -C "C:/Users/santi/OneDrive/Desktop/PC3" commit -m "feat: cart items distinguished by color, editable quantity in sidebar"
```

---

## Task 4: Checkout — comprobante, Andreani, WhatsApp actualizado

**Files:**
- Modify: `public/js/checkout.js` (completo)

**Interfaces:**
- Consumes: `state.carts[section]` — ítems con `colorName` y `variantIdx`
- Produces: modal de checkout con campo comprobante + Andreani; mensaje WhatsApp con color, comprobante y tipo de envío correcto

- [ ] **Step 1: Actualizar la llamada a `validate-stock` en `openCheckout` (línea 12)**

Reemplazar:
```javascript
body: JSON.stringify({ items: items.map(i => ({ product_id: i.productId, quantity: i.quantity })) })
```
Con:
```javascript
body: JSON.stringify({ items: items.map(i => ({ product_id: i.productId, variant_idx: i.variantIdx, quantity: i.quantity })) })
```

- [ ] **Step 2: Agregar campo comprobante y actualizar delivery en `renderCheckoutModal`**

Localizar el bloque `<!-- Tus datos -->` (línea ~83) y **antes** de él insertar la sección de comprobante. También reemplazar el bloque de `delivery-options`.

El HTML completo del `modal.innerHTML` (sección `modal-body`) debe quedar así — reemplazar desde `<div class="modal-body">` hasta `</div><!-- fin modal-body -->`:

```javascript
      <div class="modal-body">

        <div class="checkout-section-header">
          <h4>Resumen del pedido</h4>
        </div>

        <div class="order-summary">
          ${summaryItems}
          <hr class="divider" style="margin:6px 0">
          ${totalSavings > 0 ? `<div class="order-summary-item"><span style="color:var(--color-success)">🎉 Total ahorrado</span><span style="color:var(--color-success);font-weight:700">${fmt(totalSavings)}</span></div>` : ''}
          <div class="order-summary-item" style="font-weight:800;font-size:15px">
            <span>TOTAL</span><span style="color:var(--color-accent)">${fmt(total)}</span>
          </div>
        </div>

        ${stockWarningHtml}

        <div class="checkout-section-header" style="margin-top:16px">
          <h4>Tipo de comprobante</h4>
        </div>

        <div class="form-group">
          <div class="delivery-options" style="flex-wrap:wrap;gap:6px">
            <label class="delivery-option selected" id="opt-cf">
              <input type="radio" name="comprobante" value="Consumidor Final A" checked>
              <span class="delivery-option-label">Consumidor Final A</span>
            </label>
            <label class="delivery-option" id="opt-mono">
              <input type="radio" name="comprobante" value="Monotributo A">
              <span class="delivery-option-label">Monotributo A</span>
            </label>
            <label class="delivery-option" id="opt-ri">
              <input type="radio" name="comprobante" value="Responsable Inscripto B">
              <span class="delivery-option-label">Responsable Inscripto B</span>
            </label>
            <label class="delivery-option" id="opt-iva">
              <input type="radio" name="comprobante" value="IVA Exento">
              <span class="delivery-option-label">IVA Exento</span>
            </label>
          </div>
        </div>

        <div class="checkout-section-header" style="margin-top:16px">
          <h4>Tus datos</h4>
        </div>

        <div class="form-group">
          <label class="form-label">Nombre y apellido *</label>
          <input type="text" id="checkout-name" class="form-control" placeholder="Ej: Juan Pérez" required>
        </div>

        <div class="form-group">
          <label class="form-label">Teléfono *</label>
          <input type="tel" id="checkout-phone" class="form-control" placeholder="Ej: 3492 123456">
        </div>

        <div class="form-group">
          <label class="form-label">Tipo de entrega *</label>
          <div class="delivery-options">
            <label class="delivery-option selected" id="opt-retiro">
              <input type="radio" name="delivery" value="retiro" checked>
              <span class="delivery-option-icon">🏪</span>
              <span class="delivery-option-label">Retiro en sucursal</span>
              <span class="delivery-option-desc">Pasás a buscar</span>
            </label>
            <label class="delivery-option" id="opt-andreani">
              <input type="radio" name="delivery" value="andreani">
              <span class="delivery-option-icon">📦</span>
              <span class="delivery-option-label">Andreani</span>
              <span class="delivery-option-desc">Envío a domicilio</span>
            </label>
          </div>
        </div>

        <div class="form-group" id="address-group" style="display:none">
          <label class="form-label">Dirección de envío *</label>
          <input type="text" id="checkout-address" class="form-control" placeholder="Calle, número, ciudad">
        </div>

        <div id="checkout-form-error" class="form-error" style="display:none;margin-bottom:12px"></div>

      </div>
```

Nota: la opción por defecto ahora es `retiro` (sin campo dirección), por eso `address-group` arranca con `display:none`.

- [ ] **Step 3: Actualizar el toggle de delivery options (línea ~136)**

Reemplazar el bloque del listener de `.delivery-option`:

```javascript
  // Comprobante option toggle
  modal.querySelectorAll('#opt-cf, #opt-mono, #opt-ri, #opt-iva').forEach(opt => {
    opt.addEventListener('click', () => {
      modal.querySelectorAll('[name="comprobante"]').forEach(r => r.closest('.delivery-option').classList.remove('selected'));
      opt.classList.add('selected');
      opt.querySelector('input').checked = true;
    });
  });

  // Delivery option toggle
  modal.querySelectorAll('.delivery-option').forEach(opt => {
    const radio = opt.querySelector('input[name="delivery"]');
    if (!radio) return;
    opt.addEventListener('click', () => {
      modal.querySelectorAll('input[name="delivery"]').forEach(r => r.closest('.delivery-option').classList.remove('selected'));
      opt.classList.add('selected');
      radio.checked = true;
      const isAndreani = radio.value === 'andreani';
      document.getElementById('address-group').style.display = isAndreani ? 'block' : 'none';
    });
  });
```

- [ ] **Step 4: Actualizar el resumen `summaryItems` para mostrar color (línea ~29)**

Reemplazar el `map` que genera `summaryItems`:

```javascript
  const summaryItems = items.map(item => {
    const product = state.products.find(p => p.id === item.productId);
    if (!product) return '';
    const { price, tier } = getEffectivePrice(product, section, item.quantity);
    const subtotal = price * item.quantity;
    const colorSuffix = item.colorName ? ` (${item.colorName})` : '';
    return `
      <div class="order-summary-item">
        <span class="order-summary-name">${product.name}${colorSuffix}</span>
        <span class="order-summary-qty">× ${item.quantity}</span>
        <span class="order-summary-price">${fmt(subtotal)}</span>
      </div>
      ${tier ? `<div style="font-size:11px;color:var(--color-success);margin-top:-4px;margin-bottom:2px">  ✓ ${tier.percentage}% OFF</div>` : ''}
    `;
  }).join('');
```

- [ ] **Step 5: Actualizar `sendWhatsApp` — validación y mensaje**

Reemplazar la función completa `sendWhatsApp` (líneas 158-230):

```javascript
function sendWhatsApp(section, stockIssues) {
  const name = document.getElementById('checkout-name')?.value.trim();
  const phone = document.getElementById('checkout-phone')?.value.trim();
  const deliveryEl = document.querySelector('input[name="delivery"]:checked');
  const delivery = deliveryEl?.value;
  const address = document.getElementById('checkout-address')?.value.trim();
  const comprobanteEl = document.querySelector('input[name="comprobante"]:checked');
  const comprobante = comprobanteEl?.value || 'Consumidor Final A';

  const errorEl = document.getElementById('checkout-form-error');

  if (!name) { showError(errorEl, 'Ingresá tu nombre y apellido'); return; }
  if (!phone) { showError(errorEl, 'Ingresá tu teléfono'); return; }
  if (delivery === 'andreani' && !address) { showError(errorEl, 'Ingresá la dirección de envío'); return; }

  errorEl.style.display = 'none';

  const items = Object.values(state.carts[section] || {});
  const sectionLabel = section === 'profesional' ? 'Profesional' : 'Mayorista';
  let lines = [];

  lines.push(`*Pedido PC3 Argentina*`);
  lines.push(`_Lista: ${sectionLabel}_`);
  lines.push('');

  let total = 0;
  let totalSavings = 0;

  for (const item of items) {
    const product = state.products.find(p => p.id === item.productId);
    if (!product) continue;
    const { price, tier, savings } = getEffectivePrice(product, section, item.quantity);
    const subtotal = price * item.quantity;
    total += subtotal;
    totalSavings += savings;

    const colorSuffix = item.colorName ? ` (${item.colorName})` : '';
    lines.push(`• ${product.name}${colorSuffix} × ${item.quantity} un = ${fmt(subtotal)}`);
    if (tier) lines.push(`  ✅ Precio con ${tier.percentage}% OFF (x${tier.min_quantity}+ unidades)`);
  }

  lines.push('');
  if (totalSavings > 0) lines.push(`💰 Total ahorrado con descuentos: ${fmt(totalSavings)}`);
  lines.push(`*TOTAL: ${fmt(total)}*`);
  lines.push('');

  lines.push(`🧾 Comprobante: ${comprobante}`);
  lines.push(`👤 Nombre: ${name}`);
  lines.push(`📱 Teléfono: ${phone}`);

  if (delivery === 'andreani') {
    lines.push(`📦 Envío Andreani a: ${address}`);
  } else {
    lines.push(`🏪 Retiro en sucursal`);
  }

  if (stockIssues && stockIssues.length > 0) {
    lines.push('');
    lines.push(`⚠️ *NOTA DE STOCK:*`);
    for (const issue of stockIssues) {
      lines.push(`  - ${issue.name}: pedido ${issue.requested} un, disponibles ${issue.available} — consultar si ingresa pronto`);
    }
  }

  const message = lines.join('\n');
  const waNumber = state.settings.whatsapp_number || '5493492310744';
  const url = `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`;

  window.open(url, '_blank');

  setTimeout(() => {
    document.getElementById('checkout-modal')?.remove();
    showClearCartPrompt(section);
  }, 500);
}
```

- [ ] **Step 6: Verificar manualmente**

1. `npm start`, abrir `http://localhost:3000`
2. Agregar productos al carrito
3. Abrir checkout → verificar que aparecen las 4 opciones de comprobante y las 2 de entrega (Retiro/Andreani)
4. Seleccionar Andreani → verificar que aparece campo dirección
5. Seleccionar Retiro → verificar que desaparece el campo
6. Completar el formulario y enviar → verificar que el mensaje de WhatsApp incluye el tipo de comprobante y la entrega correcta
7. Verificar que el nombre del color aparece en el resumen si el ítem tiene colorName

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/santi/OneDrive/Desktop/PC3" add public/js/checkout.js
git -C "C:/Users/santi/OneDrive/Desktop/PC3" commit -m "feat: add billing type, Andreani delivery, color in checkout summary"
```

---

## Task 5: Admin — editor de color y stock por imagen

**Files:**
- Modify: `public/js/admin.js:201-297` (buildEditForm), `public/js/admin.js:317-377` (setupEditFormEvents)

**Interfaces:**
- Consumes: `PUT /api/admin/products/:id/images/:imgId` (definido en Task 2)
- Produces: en el panel de edición de producto, cada imagen tiene campos editables de `color_name` y `stock`; el campo `stock` del producto se deshabilita cuando hay imágenes.

- [ ] **Step 1: Reemplazar la sección de imágenes en `buildEditForm` (líneas 275-293)**

Reemplazar desde el comentario `<!-- Images -->` hasta el cierre `${p ? \`...\` : ''}` de esa sección:

```javascript
    <!-- Images -->
    ${p ? `
    <div class="section-divider" style="margin-top:16px">Imágenes y colores</div>

    <div id="img-color-list" style="display:flex;flex-direction:column;gap:10px;margin-bottom:12px">
      ${(p.images || []).map((img) => `
        <div class="img-color-row" data-img-id="${img.id}" style="display:flex;align-items:center;gap:10px;padding:8px;background:var(--color-surface2);border-radius:8px">
          <img src="/productos/${p.slug}/${img.filename}" alt="${img.filename}"
            style="width:56px;height:56px;object-fit:cover;border-radius:6px;flex-shrink:0">
          <div style="display:flex;flex-direction:column;gap:6px;flex:1;min-width:0">
            <input type="text"
              class="form-control img-color-name"
              data-img-id="${img.id}"
              data-product-id="${p.id}"
              value="${(img.color_name || '').replace(/"/g, '&quot;')}"
              placeholder="Nombre del color (ej: Rojo)"
              style="font-size:13px;padding:5px 8px">
            <div style="display:flex;align-items:center;gap:6px">
              <label style="font-size:11px;color:var(--color-text-muted);white-space:nowrap">Stock:</label>
              <input type="number"
                class="form-control img-color-stock"
                data-img-id="${img.id}"
                data-product-id="${p.id}"
                value="${img.stock || 0}"
                min="0"
                style="width:80px;font-size:13px;padding:5px 8px">
            </div>
          </div>
          <button class="btn btn-danger btn-sm img-thumb-del"
            data-img-id="${img.id}"
            data-product-id="${p.id}"
            title="Eliminar imagen"
            style="flex-shrink:0">✕</button>
        </div>
      `).join('')}
    </div>

    <div class="upload-zone" id="upload-zone">
      <div style="font-size:24px;margin-bottom:6px">📁</div>
      <div>Arrastrá imágenes aquí o <strong>hacé click para seleccionar</strong></div>
      <div class="text-xs text-muted mt-1">PNG, JPG, WEBP — máx. 5MB cada una</div>
    </div>
    <input type="file" id="img-file-input" accept="image/*" multiple style="display:none">
    ` : ''}
```

- [ ] **Step 2: Actualizar el campo `ef-stock` en `buildEditForm` para deshabilitarlo cuando hay imágenes (línea ~244-248)**

Reemplazar el bloque del `<div class="form-group">` de stock:

```javascript
      <div class="form-group">
        <label class="form-label">Stock disponible
          ${p && p.images && p.images.length > 0
            ? '<span style="font-size:11px;color:var(--color-text-muted)"> (gestionado por color)</span>'
            : ''}
        </label>
        <input type="number" class="form-control" id="ef-stock" value="${p?.stock ?? ''}" placeholder="100" min="0"
          ${p && p.images && p.images.length > 0 ? 'disabled style="opacity:0.5"' : ''}>
        ${p && p.images && p.images.length > 0
          ? '<div style="font-size:11px;color:var(--color-text-muted);margin-top:4px">El stock se gestiona por color en la sección de imágenes.</div>'
          : ''}
      </div>
```

- [ ] **Step 3: Agregar listener de autosave para color/stock en `setupEditFormEvents` (después del listener de image delete, línea ~352-362)**

Dentro del bloque `if (product) { ... }` en `setupEditFormEvents`, agregar después del bloque `// Image delete`:

```javascript
    // Color name and stock autosave
    document.getElementById('img-color-list')?.addEventListener('change', async (e) => {
      const isColorName = e.target.classList.contains('img-color-name');
      const isStock = e.target.classList.contains('img-color-stock');
      if (!isColorName && !isStock) return;

      const imgId = e.target.dataset.imgId;
      const productId = e.target.dataset.productId;
      const row = e.target.closest('.img-color-row');
      if (!row) return;

      const colorName = row.querySelector('.img-color-name').value.trim();
      const stock = parseInt(row.querySelector('.img-color-stock').value) || 0;

      try {
        await api(`/admin/products/${productId}/images/${imgId}`, {
          method: 'PUT',
          body: { color_name: colorName, stock }
        });
        toast('Color/stock actualizado');
        // Update in-memory data
        const prod = admin.products.find(p => p.id === parseInt(productId));
        if (prod) {
          const img = (prod.images || []).find(i => i.id === parseInt(imgId));
          if (img) { img.color_name = colorName; img.stock = stock; }
        }
      } catch (err) { toast(err.message, 'error'); }
    });
```

- [ ] **Step 4: Verificar manualmente**

1. `npm start`, abrir `http://localhost:3000/admin`
2. Editar un producto que tenga imágenes
3. Verificar que cada imagen muestra un campo "Nombre del color" y un campo "Stock"
4. Escribir un nombre de color (ej: "Rojo") en la primera imagen y hacer click fuera → debe aparecer toast "Color/stock actualizado"
5. Escribir un stock (ej: 10) y hacer click fuera → toast de confirmación
6. Verificar que el campo `ef-stock` está deshabilitado y muestra la nota "(gestionado por color)"
7. Recargar la página y volver a editar el mismo producto → los valores guardados deben persistir
8. En el catálogo, agregar ese producto en color "Rojo" al carrito → el ítem debe mostrar " — Rojo"

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/santi/OneDrive/Desktop/PC3" add public/js/admin.js
git -C "C:/Users/santi/OneDrive/Desktop/PC3" commit -m "feat: admin image editor with color name and per-color stock"
```

---

## Verificación final integral

- [ ] Iniciar servidor y recorrer el flujo completo:
  1. En admin: cargar un producto con imágenes, asignar nombres de color ("Rojo", "Azul") y stocks (10, 5)
  2. En catálogo: seleccionar color Rojo y agregar 3 unidades → verificar carrito muestra "Producto — Rojo × 3"
  3. Seleccionar color Azul del mismo producto y agregar 1 → carrito muestra ambas líneas
  4. Editar cantidad en el input del carrito manualmente → subtotal actualiza
  5. Abrir checkout → aparecen 4 opciones de comprobante (Consumidor Final A seleccionado por defecto)
  6. Seleccionar "Andreani" → aparece campo dirección
  7. Completar y enviar → mensaje WhatsApp contiene: colores, comprobante, "Envío Andreani a: ..."
  8. Repetir con "Retiro en sucursal" → mensaje dice "Retiro en sucursal", sin dirección
