# Gestión de Pedidos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un módulo completo de gestión de pedidos al panel de administración de PC3, con creación automática desde el checkout del cliente (WhatsApp), creación manual por el admin, y flujo de confirmación/cancelación con descuento de stock al confirmar.

**Architecture:** Dos tablas PostgreSQL nuevas (`orders` + `order_items`) accedidas desde nuevos endpoints en `routes/api.js`. La UI del admin es una SPA vanilla JS que agrega una página "Pedidos" siguiendo el patrón existente del proyecto — igual que las páginas Products, Colors, Settings. La lógica de pedidos del admin vive en un archivo separado `public/js/admin-orders.js` para no crecer más `admin.js` (ya tiene 1069 líneas).

**Tech Stack:** Node.js, Express, PostgreSQL (pool `pg` con wrapper custom `database.js`), Vanilla JS, CSS existente con clases `btn`, `form-control`, `badge`, `admin-table`, `edit-panel`.

## Global Constraints

- El stock solo se descuenta en `POST /api/admin/orders/:id/confirm` — nunca al crear ni al editar.
- Pedidos con `status !== 'pending'` son inmutables: no se pueden editar ni cambiar de estado.
- Si `POST /api/orders` (público) falla desde el cliente, el flujo de WhatsApp no se bloquea (fire-and-forget).
- Usar el patrón `?`-placeholder del wrapper `database.js` para queries en `prepare().run/get/all`. Para queries con arrays o parámetros construidos dinámicamente, usar `db.query(sql, params[])` directamente con `$1, $2...`.
- Para INSERT en `orders` y `order_items`, ambas tablas deben figurar en el regex `hasSerialId` de `database.js` para que el wrapper retorne `lastInsertRowid`.
- La UI sigue el estilo CSS existente. No crear nuevas clases salvo `.order-row-pending`.
- Spec en: `docs/superpowers/specs/2026-06-29-orders-management-design.md`

---

## Mapa de archivos

| Archivo | Acción | Responsabilidad |
|---------|--------|-----------------|
| `database.js` | Modificar | Agregar tablas `orders`, `order_items` en `init()` y regex `hasSerialId` |
| `routes/api.js` | Modificar | Endpoints públicos y de admin para pedidos |
| `views/admin.html` | Modificar | Agregar "Pedidos" en sidebar + `<script>` para `admin-orders.js` |
| `public/js/admin.js` | Modificar | Agregar case `orders` en `navigate()` |
| `public/js/admin-orders.js` | Crear | Toda la lógica UI de pedidos: lista, filtros, panel de detalle/edición |
| `public/js/checkout.js` | Modificar | Llamada fire-and-forget a `POST /api/orders` antes de abrir WhatsApp |
| `public/css/admin.css` | Modificar | Agregar estilo `.order-row-pending` |

---

### Task 1: Database schema — tablas orders y order_items

**Files:**
- Modify: `database.js`

**Interfaces:**
- Produces: tablas `orders` y `order_items` en PostgreSQL; `db.prepare('INSERT INTO orders ...')` retorna `{ lastInsertRowid }` correctamente

- [ ] **Step 1: Actualizar regex `hasSerialId` en `database.js`**

En `database.js` línea 31, cambiar:
```js
const hasSerialId = /INSERT\s+INTO\s+(products|product_images|discount_tiers|admin_users|colors)\b/i.test(sql);
```
por:
```js
const hasSerialId = /INSERT\s+INTO\s+(products|product_images|discount_tiers|admin_users|colors|orders|order_items)\b/i.test(sql);
```

- [ ] **Step 2: Agregar creación de tablas en `init()` de `database.js`**

Antes de `return { prepare, getClient, query, exec, save };` al final de `init()`, agregar:

```js
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id           SERIAL PRIMARY KEY,
      status       TEXT        NOT NULL DEFAULT 'pending',
      section      TEXT        NOT NULL DEFAULT '',
      client_name  TEXT        NOT NULL DEFAULT '',
      client_phone TEXT        NOT NULL DEFAULT '',
      delivery     TEXT        NOT NULL DEFAULT 'retiro',
      address      TEXT        NOT NULL DEFAULT '',
      comprobante  TEXT        NOT NULL DEFAULT '',
      notes        TEXT        NOT NULL DEFAULT '',
      total        INTEGER     NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      confirmed_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id           SERIAL PRIMARY KEY,
      order_id     INTEGER     NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id   INTEGER     REFERENCES products(id) ON DELETE SET NULL,
      product_name TEXT        NOT NULL DEFAULT '',
      color_name   TEXT        NOT NULL DEFAULT '',
      quantity     INTEGER     NOT NULL DEFAULT 1,
      unit_price   INTEGER     NOT NULL DEFAULT 0,
      subtotal     INTEGER     NOT NULL DEFAULT 0
    )
  `);
```

- [ ] **Step 3: Verificar que el servidor arranca sin errores**

```bash
node server.js
```
Esperado: `🚀 PC3 Catálogo corriendo en http://localhost:3000` sin mensajes de error.

- [ ] **Step 4: Commit**

```bash
git add database.js
git commit -m "feat: agregar tablas orders y order_items"
```

---

### Task 2: Endpoint público POST /api/orders

**Files:**
- Modify: `routes/api.js`

**Interfaces:**
- Consumes: tablas `orders` y `order_items` (Task 1)
- Produces:
  - `createOrder(db, body) → Promise<number>` — helper interno, retorna el `id` del pedido creado
  - `getOrderFull(db, id) → Promise<order | null>` — helper interno, retorna pedido con su array `items`
  - `POST /api/orders` — ruta pública, retorna `201` con el pedido completo

- [ ] **Step 1: Agregar helpers `createOrder` y `getOrderFull` en `routes/api.js`**

Agregar después de la función `invalidateCache` (línea ~101), antes de las rutas públicas:

```js
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
```

- [ ] **Step 2: Agregar ruta `POST /api/orders` en la sección de rutas públicas**

Agregar después de `router.post('/validate-stock', ...)` y antes del comentario `// ─── ADMIN ROUTES`:

```js
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
```

- [ ] **Step 3: Probar con curl**

Con el servidor corriendo:
```bash
curl -s -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "section": "mayorista",
    "client_name": "Test Cliente",
    "client_phone": "3492123456",
    "delivery": "retiro",
    "comprobante": "Consumidor Final A",
    "items": [
      { "product_id": 1, "product_name": "Producto Test", "color_name": "Negro", "quantity": 2, "unit_price": 10000 }
    ]
  }'
```
Esperado: JSON con `"id": 1`, `"status": "pending"`, `"total": 20000`, e `"items"` con 1 elemento.

- [ ] **Step 4: Commit**

```bash
git add routes/api.js
git commit -m "feat: endpoint público POST /api/orders"
```

---

### Task 3: Endpoints admin — listar y crear pedidos

**Files:**
- Modify: `routes/api.js`

**Interfaces:**
- Consumes: helpers `createOrder`, `getOrderFull` (Task 2); middleware `requireAdmin`
- Produces:
  - `GET /api/admin/orders?status=&section=&search=&from=&to=` → array de pedidos (sin ítems)
  - `POST /api/admin/orders` → pedido completo creado (con ítems)

- [ ] **Step 1: Agregar `GET /api/admin/orders` al inicio de la sección ADMIN ROUTES**

Agregar inmediatamente después del comentario `// ─── ADMIN ROUTES`:

```js
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
```

- [ ] **Step 2: Agregar `POST /api/admin/orders`**

```js
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
```

- [ ] **Step 3: Probar en browser (requiere sesión de admin)**

Abrir DevTools en `http://localhost:3000/admin` y ejecutar:
```js
await fetch('/api/admin/orders').then(r => r.json())
```
Esperado: array con el pedido de prueba de Task 2.

```js
await fetch('/api/admin/orders?status=pending').then(r => r.json())
```
Esperado: solo pedidos con `status: "pending"`.

- [ ] **Step 4: Commit**

```bash
git add routes/api.js
git commit -m "feat: endpoints admin GET/POST /api/admin/orders"
```

---

### Task 4: Endpoints admin — detalle, edición, confirmación y cancelación

**Files:**
- Modify: `routes/api.js`

**Interfaces:**
- Consumes: helpers `getOrderFull`, `createOrder` (Task 2); tablas `orders`, `order_items`, `products`
- Produces:
  - `GET /api/admin/orders/:id` → pedido completo con ítems
  - `PUT /api/admin/orders/:id` → edita cabecera, retorna pedido actualizado
  - `PUT /api/admin/orders/:id/items` → reemplaza ítems, recalcula total, retorna pedido actualizado
  - `POST /api/admin/orders/:id/confirm` → descuenta stock, cambia status a `confirmed`
  - `POST /api/admin/orders/:id/cancel` → cambia status a `cancelled`

- [ ] **Step 1: Agregar `GET /api/admin/orders/:id`**

```js
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
```

- [ ] **Step 2: Agregar `PUT /api/admin/orders/:id` (editar cabecera)**

```js
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
```

- [ ] **Step 3: Agregar `PUT /api/admin/orders/:id/items` (reemplazar ítems)**

```js
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
```

- [ ] **Step 4: Agregar `POST /api/admin/orders/:id/confirm`**

```js
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
```

- [ ] **Step 5: Agregar `POST /api/admin/orders/:id/cancel`**

```js
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
```

- [ ] **Step 6: Probar confirm y cancel desde DevTools**

Con el servidor corriendo y sesión de admin activa:

Confirmar el pedido #1 (creado en Task 2):
```js
await fetch('/api/admin/orders/1/confirm', { method: 'POST' }).then(r => r.json())
```
Esperado: `{ "id": 1, "status": "confirmed", "confirmed_at": "..." }`.

Intentar cancelar ese mismo pedido (ya confirmado):
```js
await fetch('/api/admin/orders/1/cancel', { method: 'POST' }).then(r => r.json())
```
Esperado: error 400 `"Solo se pueden cancelar pedidos pendientes"`.

Verificar que el stock del producto se decrementó:
```js
await fetch('/api/admin/products').then(r => r.json()).then(ps => ps.find(p => p.id === 1)?.stock)
```
Esperado: stock original menos 2 (cantidad del pedido de prueba).

- [ ] **Step 7: Commit**

```bash
git add routes/api.js
git commit -m "feat: endpoints admin detalle, edición, confirmación y cancelación de pedidos"
```

---

### Task 5: Admin UI — sidebar y página lista de pedidos

**Files:**
- Modify: `views/admin.html`
- Modify: `public/js/admin.js`
- Create: `public/js/admin-orders.js`
- Modify: `public/css/admin.css`

**Interfaces:**
- Consumes: `GET /api/admin/orders` (Task 3); funciones globales `api()`, `toast()`, `fmtPrice()` de `admin.js`; objeto global `admin` de `admin.js`
- Produces:
  - Función global `renderOrdersPage()` — renderiza la página de pedidos en `#admin-content`
  - Función global `openOrderPanel(orderId)` — placeholder que se completará en Task 6
  - Objeto global `ordersState` con `orders[]` y `filters{}`

- [ ] **Step 1: Agregar "Pedidos" al sidebar en `views/admin.html`**

Encontrar (línea ~31):
```html
      <button class="nav-item active" data-page="products">
        <span class="nav-item-icon">📦</span> Productos
      </button>
      <button class="nav-item" data-page="colors">
```

Agregar el botón de Pedidos entre Productos y Colors:
```html
      <button class="nav-item active" data-page="products">
        <span class="nav-item-icon">📦</span> Productos
      </button>
      <button class="nav-item" data-page="orders">
        <span class="nav-item-icon">🛒</span> Pedidos
      </button>
      <button class="nav-item" data-page="colors">
```

- [ ] **Step 2: Agregar `<script>` para `admin-orders.js` en `views/admin.html`**

Encontrar (línea ~107):
```html
<script src="/js/admin.js"></script>
```

Reemplazar con:
```html
<script src="/js/admin-orders.js"></script>
<script src="/js/admin.js"></script>
```

(`admin-orders.js` va primero porque define funciones que `admin.js` llama.)

- [ ] **Step 3: Actualizar `navigate()` en `public/js/admin.js`**

Encontrar (línea ~63):
```js
  const titles = { products: 'Productos', colors: 'Paleta de colores', settings: 'Configuración', password: 'Cambiar Contraseña' };
  document.getElementById('page-title').textContent = titles[page] || page;

  if (page === 'products') renderProductsPage();
  else if (page === 'colors') renderColorsPage();
  else if (page === 'settings') renderSettingsPage();
  else if (page === 'password') renderPasswordPage();
```

Reemplazar con:
```js
  const titles = { products: 'Productos', orders: 'Pedidos', colors: 'Paleta de colores', settings: 'Configuración', password: 'Cambiar Contraseña' };
  document.getElementById('page-title').textContent = titles[page] || page;

  if (page === 'products') renderProductsPage();
  else if (page === 'orders') renderOrdersPage();
  else if (page === 'colors') renderColorsPage();
  else if (page === 'settings') renderSettingsPage();
  else if (page === 'password') renderPasswordPage();
```

- [ ] **Step 4: Crear `public/js/admin-orders.js` con lista de pedidos**

```js
// ─── Admin Orders ─────────────────────────────────────────────

const ordersState = {
  orders: [],
  filters: { status: '', section: '', search: '', from: '', to: '' },
};

const STATUS_LABEL = { pending: 'Pendiente', confirmed: 'Confirmado', cancelled: 'Cancelado' };
const STATUS_BADGE  = { pending: 'badge-warning', confirmed: 'badge-success', cancelled: 'badge-danger' };
const SECTION_LABEL = { profesional: 'Profesional', mayorista: 'Mayorista' };

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function renderOrdersPage() {
  const content = document.getElementById('admin-content');
  const f = ordersState.filters;

  content.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
        <input type="text" id="filter-search" class="form-control" placeholder="Buscar cliente o teléfono…" style="width:200px" value="${escapeHtml(f.search)}">
        <select id="filter-status" class="form-control" style="width:150px">
          <option value="">Todos los estados</option>
          <option value="pending"   ${f.status==='pending'   ?'selected':''}>Pendientes</option>
          <option value="confirmed" ${f.status==='confirmed' ?'selected':''}>Confirmados</option>
          <option value="cancelled" ${f.status==='cancelled' ?'selected':''}>Cancelados</option>
        </select>
        <select id="filter-section" class="form-control" style="width:150px">
          <option value="">Todas las listas</option>
          <option value="profesional" ${f.section==='profesional'?'selected':''}>Profesional</option>
          <option value="mayorista"   ${f.section==='mayorista'  ?'selected':''}>Mayorista</option>
        </select>
        <input type="date" id="filter-from" class="form-control" style="width:140px" value="${f.from}" title="Desde">
        <input type="date" id="filter-to"   class="form-control" style="width:140px" value="${f.to}"   title="Hasta">
        <button class="btn btn-ghost btn-sm" id="btn-clear-filters">Limpiar</button>
      </div>
      <button class="btn btn-primary btn-sm" id="btn-new-order">+ Nuevo pedido</button>
    </div>
    <div id="orders-table-wrap">
      <div class="loader-wrap"><div class="loader-dots"><span></span><span></span><span></span></div><span>Cargando pedidos…</span></div>
    </div>
  `;

  ['filter-search','filter-status','filter-section','filter-from','filter-to'].forEach(id => {
    document.getElementById(id)?.addEventListener('input',  debounceLoadOrders);
    document.getElementById(id)?.addEventListener('change', debounceLoadOrders);
  });
  document.getElementById('btn-clear-filters')?.addEventListener('click', () => {
    ordersState.filters = { status: '', section: '', search: '', from: '', to: '' };
    renderOrdersPage();
  });
  document.getElementById('btn-new-order')?.addEventListener('click', () => openOrderPanel(null));

  await loadOrders();
}

let _ordersDebounceTimer = null;
function debounceLoadOrders() {
  ordersState.filters.search  = document.getElementById('filter-search')?.value  || '';
  ordersState.filters.status  = document.getElementById('filter-status')?.value  || '';
  ordersState.filters.section = document.getElementById('filter-section')?.value || '';
  ordersState.filters.from    = document.getElementById('filter-from')?.value    || '';
  ordersState.filters.to      = document.getElementById('filter-to')?.value      || '';
  clearTimeout(_ordersDebounceTimer);
  _ordersDebounceTimer = setTimeout(loadOrders, 350);
}

async function loadOrders() {
  const wrap = document.getElementById('orders-table-wrap');
  if (!wrap) return;

  const params = new URLSearchParams();
  const f = ordersState.filters;
  if (f.status)  params.set('status',  f.status);
  if (f.section) params.set('section', f.section);
  if (f.search)  params.set('search',  f.search);
  if (f.from)    params.set('from',    f.from);
  if (f.to)      params.set('to',      f.to);

  try {
    ordersState.orders = await api('/admin/orders?' + params.toString());
    renderOrdersTable(wrap);
  } catch (e) {
    wrap.innerHTML = `<p style="color:var(--color-danger)">${e.message}</p>`;
  }
}

function renderOrdersTable(wrap) {
  if (!ordersState.orders.length) {
    wrap.innerHTML = `<div class="empty-state" style="padding:40px;text-align:center;color:var(--color-text-muted)">No hay pedidos con los filtros actuales.</div>`;
    return;
  }

  const rows = ordersState.orders.map(o => {
    const badgeClass  = STATUS_BADGE[o.status]  || '';
    const statusLabel = STATUS_LABEL[o.status]  || o.status;
    const sectionLabel= SECTION_LABEL[o.section]|| o.section;
    const date = new Date(o.created_at).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
    const isPending = o.status === 'pending';
    return `
      <tr class="${isPending ? 'order-row-pending' : ''}">
        <td style="font-weight:700">#${o.id}</td>
        <td>
          ${escapeHtml(o.client_name)}
          <br><small style="color:var(--color-text-muted)">${escapeHtml(o.client_phone)}</small>
        </td>
        <td>${sectionLabel}</td>
        <td style="font-weight:600">${fmtPrice(o.total)}</td>
        <td><span class="badge ${badgeClass}">${statusLabel}</span></td>
        <td>${date}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="openOrderPanel(${o.id})">Ver / Editar</button></td>
      </tr>
    `;
  }).join('');

  wrap.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table" style="width:100%">
        <thead>
          <tr>
            <th>#</th><th>Cliente</th><th>Lista</th><th>Total</th><th>Estado</th><th>Fecha</th><th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// Placeholder — se completa en Task 6
function openOrderPanel(orderId) {
  toast('Panel de pedido próximamente', 'success');
}
```

- [ ] **Step 5: Agregar estilo `.order-row-pending` al final de `public/css/admin.css`**

```css
/* ─── Orders ────────────────────────────────────────────────── */
.order-row-pending td { background: color-mix(in srgb, #f59e0b 6%, transparent); }
.order-row-pending:hover td { background: color-mix(in srgb, #f59e0b 12%, transparent); }
```

- [ ] **Step 6: Verificar en browser**

1. Reiniciar servidor e ir a `http://localhost:3000/admin`.
2. Click en "Pedidos" en el sidebar — debe mostrar la página con barra de filtros y la tabla.
3. Verificar que los filtros de estado, sección, búsqueda y fechas funcionan (recargan la tabla).
4. Verificar que "Limpiar filtros" resetea todo.
5. Verificar que "+ Nuevo pedido" llama a `openOrderPanel(null)` (muestra el toast placeholder).

- [ ] **Step 7: Commit**

```bash
git add views/admin.html public/js/admin.js public/js/admin-orders.js public/css/admin.css
git commit -m "feat: página lista de pedidos en panel admin con filtros"
```

---

### Task 6: Admin UI — panel de detalle y edición de pedidos

**Files:**
- Modify: `public/js/admin-orders.js` (reemplazar el placeholder `openOrderPanel`)

**Interfaces:**
- Consumes:
  - `GET /api/admin/orders/:id` (Task 4)
  - `GET /api/admin/products` — ya en `admin.products` si se visitó la página de productos; si no, se carga
  - `PUT /api/admin/orders/:id` (Task 4)
  - `PUT /api/admin/orders/:id/items` (Task 4)
  - `POST /api/admin/orders/:id/confirm` (Task 4)
  - `POST /api/admin/orders/:id/cancel` (Task 4)
  - `POST /api/admin/orders` (Task 3)
  - DOM: `#edit-panel`, `#edit-panel-body`, `#edit-panel-title`, `#panel-overlay`, `#save-product-btn` (existentes en `admin.html`)
  - Funciones globales: `api()`, `toast()`, `fmtPrice()`, objeto `admin` (de `admin.js`)
  - `ordersState`, `STATUS_LABEL`, `STATUS_BADGE`, `SECTION_LABEL`, `escapeHtml`, `loadOrders` (de este mismo archivo, Task 5)
- Produces: `openOrderPanel(orderId)` — abre el panel lateral con detalle completo, edición y acciones

- [ ] **Step 1: Reemplazar el placeholder `openOrderPanel` al final de `admin-orders.js`**

Eliminar:
```js
// Placeholder — se completa en Task 6
function openOrderPanel(orderId) {
  toast('Panel de pedido próximamente', 'success');
}
```

Reemplazar con todo el bloque siguiente:

```js
// ─── Order Panel ──────────────────────────────────────────────

async function openOrderPanel(orderId) {
  const panel    = document.getElementById('edit-panel');
  const body     = document.getElementById('edit-panel-body');
  const titleEl  = document.getElementById('edit-panel-title');
  const overlay  = document.getElementById('panel-overlay');
  const saveBtn  = document.getElementById('save-product-btn');

  titleEl.textContent = orderId ? `Pedido #${orderId}` : 'Nuevo pedido';
  body.innerHTML = `<div class="loader-wrap"><div class="loader-dots"><span></span><span></span><span></span></div></div>`;
  saveBtn.style.display = 'none';
  panel.classList.add('open');
  overlay.classList.add('visible');

  try {
    if (!admin.products || !admin.products.length) {
      admin.products = await api('/admin/products');
    }
    const order = orderId ? await api(`/admin/orders/${orderId}`) : null;
    renderOrderPanel(order);
  } catch (e) {
    body.innerHTML = `<p style="color:var(--color-danger)">${e.message}</p>`;
  }
}

function renderOrderPanel(order) {
  const body    = document.getElementById('edit-panel-body');
  const saveBtn = document.getElementById('save-product-btn');
  const isNew   = !order;
  const canEdit = isNew || order.status === 'pending';

  const v = {
    section:      order?.section      || 'mayorista',
    client_name:  order?.client_name  || '',
    client_phone: order?.client_phone || '',
    delivery:     order?.delivery     || 'retiro',
    address:      order?.address      || '',
    comprobante:  order?.comprobante  || 'Consumidor Final A',
    notes:        order?.notes        || '',
  };

  const statusBadge = !isNew && !canEdit
    ? `<div style="margin-bottom:12px">
         <span class="badge ${STATUS_BADGE[order.status]}" style="font-size:13px;padding:6px 12px">
           ${STATUS_LABEL[order.status]}
           ${order.confirmed_at ? ' — ' + new Date(order.confirmed_at).toLocaleDateString('es-AR') : ''}
         </span>
       </div>`
    : '';

  const disabledAttr = canEdit ? '' : 'disabled';
  const readonlyAttr = canEdit ? '' : 'readonly';

  const comprobanteOptions = ['Consumidor Final A','Monotributo A','Responsable Inscripto B','IVA Exento']
    .map(c => `<option ${v.comprobante === c ? 'selected' : ''}>${escapeHtml(c)}</option>`)
    .join('');

  const itemsHtml = (order?.items || [])
    .map((item, i) => renderItemRow(item, i, canEdit))
    .join('') || '<p style="color:var(--color-text-muted);font-size:13px;padding:8px 0">Sin ítems</p>';

  body.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;padding-bottom:16px">
      ${statusBadge}

      <div>
        <div class="form-group">
          <label class="form-label">Lista de precios</label>
          <select id="op-section" class="form-control" ${disabledAttr}>
            <option value="mayorista"   ${v.section==='mayorista'   ?'selected':''}>Mayorista</option>
            <option value="profesional" ${v.section==='profesional' ?'selected':''}>Profesional</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Nombre del cliente *</label>
          <input type="text" id="op-name" class="form-control" value="${escapeHtml(v.client_name)}" ${readonlyAttr}>
        </div>
        <div class="form-group">
          <label class="form-label">Teléfono *</label>
          <input type="text" id="op-phone" class="form-control" value="${escapeHtml(v.client_phone)}" ${readonlyAttr}>
        </div>
        <div class="form-group">
          <label class="form-label">Comprobante</label>
          <select id="op-comprobante" class="form-control" ${disabledAttr}>
            ${comprobanteOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Entrega</label>
          <select id="op-delivery" class="form-control" ${disabledAttr}>
            <option value="retiro"   ${v.delivery==='retiro'   ?'selected':''}>Retiro en sucursal</option>
            <option value="andreani" ${v.delivery==='andreani' ?'selected':''}>Andreani</option>
          </select>
        </div>
        <div class="form-group" id="op-address-group" style="display:${v.delivery==='andreani'?'block':'none'}">
          <label class="form-label">Dirección</label>
          <input type="text" id="op-address" class="form-control" value="${escapeHtml(v.address)}" ${readonlyAttr}>
        </div>
        <div class="form-group">
          <label class="form-label">Notas</label>
          <textarea id="op-notes" class="form-control" rows="2" ${readonlyAttr}>${escapeHtml(v.notes)}</textarea>
        </div>
      </div>

      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <strong>Ítems del pedido</strong>
          ${canEdit ? '<button class="btn btn-ghost btn-sm" id="btn-add-item">+ Agregar ítem</button>' : ''}
        </div>
        <div id="op-items-list">${itemsHtml}</div>
        <div style="text-align:right;margin-top:10px;font-weight:700;font-size:15px">
          Total: <span id="op-total">${fmtPrice(order?.total || 0)}</span>
        </div>
      </div>

      ${canEdit && !isNew ? `
        <div id="op-action-error" style="display:none;color:var(--color-danger);font-size:13px;padding:8px;background:rgba(239,68,68,0.08);border-radius:6px"></div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm" style="background:#16a34a;color:#fff;flex:1" id="btn-confirm-order">✓ Confirmar</button>
          <button class="btn btn-sm" style="background:var(--color-danger);color:#fff;flex:1" id="btn-cancel-order">✕ Cancelar</button>
        </div>
      ` : ''}
    </div>
  `;

  // Toggle dirección cuando cambia entrega
  document.getElementById('op-delivery')?.addEventListener('change', e => {
    document.getElementById('op-address-group').style.display =
      e.target.value === 'andreani' ? 'block' : 'none';
  });

  // Agregar ítem
  document.getElementById('btn-add-item')?.addEventListener('click', () => {
    const list = document.getElementById('op-items-list');
    const empty = list.querySelector('p');
    if (empty) empty.remove();
    const idx = list.querySelectorAll('.op-item-row').length;
    const div = document.createElement('div');
    div.innerHTML = renderItemRow({}, idx, true);
    const row = div.firstElementChild;
    list.appendChild(row);
    bindItemRow(row);
    recalcTotal();
  });

  // Bind rows existentes
  document.querySelectorAll('.op-item-row').forEach(row => bindItemRow(row));
  recalcTotal();

  // Save button
  saveBtn.style.display = canEdit ? 'inline-flex' : 'none';
  saveBtn.textContent = isNew ? 'Crear pedido' : 'Guardar cambios';
  saveBtn.onclick = () => saveOrder(order?.id || null);

  // Confirm / Cancel
  if (!isNew && canEdit) {
    document.getElementById('btn-confirm-order')?.addEventListener('click', () => confirmOrder(order.id));
    document.getElementById('btn-cancel-order')?.addEventListener('click',  () => cancelOrder(order.id));
  }
}

function renderItemRow(item, idx, editable) {
  const productOptions = (admin.products || [])
    .map(p => `<option value="${p.id}" data-price="${p.price_mayo}" ${item.product_id === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`)
    .join('');

  if (!editable) {
    return `
      <div class="op-item-row" style="display:grid;grid-template-columns:1fr auto auto auto;gap:6px;align-items:center;padding:6px 0;border-bottom:1px solid var(--color-border)">
        <span>${escapeHtml(item.product_name)}${item.color_name ? ` <small style="color:var(--color-text-muted)">(${escapeHtml(item.color_name)})</small>` : ''}</span>
        <span style="color:var(--color-text-muted)">×${item.quantity}</span>
        <span>${fmtPrice(item.unit_price)}</span>
        <span style="font-weight:600">${fmtPrice(item.subtotal)}</span>
      </div>`;
  }

  return `
    <div class="op-item-row" style="display:grid;grid-template-columns:1fr 80px 100px 80px auto;gap:6px;align-items:start;padding:6px 0;border-bottom:1px solid var(--color-border)">
      <div>
        <select class="form-control item-product" style="margin-bottom:4px">
          <option value="">— Producto —</option>
          ${productOptions}
        </select>
        <input type="text" class="form-control item-color" placeholder="Color / variante" value="${escapeHtml(item.color_name || '')}">
      </div>
      <input type="number" class="form-control item-qty"   min="1" value="${item.quantity   || 1}" style="width:100%">
      <input type="number" class="form-control item-price" min="0" value="${item.unit_price || 0}" style="width:100%">
      <span class="item-subtotal" style="font-weight:600;text-align:right;padding-top:8px">${fmtPrice((item.quantity || 1) * (item.unit_price || 0))}</span>
      <button class="btn btn-ghost btn-sm btn-remove-item" style="padding:4px 8px" title="Quitar">✕</button>
    </div>`;
}

function bindItemRow(row) {
  row.querySelector('.item-product')?.addEventListener('change', e => {
    const price = parseInt(e.target.selectedOptions[0]?.dataset?.price) || 0;
    row.querySelector('.item-price').value = price;
    recalcTotal();
  });
  row.querySelector('.item-qty')  ?.addEventListener('input', recalcTotal);
  row.querySelector('.item-price')?.addEventListener('input', recalcTotal);
  row.querySelector('.btn-remove-item')?.addEventListener('click', () => {
    row.remove();
    recalcTotal();
  });
}

function recalcTotal() {
  let total = 0;
  document.querySelectorAll('.op-item-row').forEach(row => {
    const qty   = parseInt(row.querySelector('.item-qty')  ?.value) || 0;
    const price = parseInt(row.querySelector('.item-price')?.value) || 0;
    const sub   = qty * price;
    total += sub;
    const subEl = row.querySelector('.item-subtotal');
    if (subEl) subEl.textContent = fmtPrice(sub);
  });
  const totalEl = document.getElementById('op-total');
  if (totalEl) totalEl.textContent = fmtPrice(total);
}

function collectOrderData() {
  const items = [];
  document.querySelectorAll('.op-item-row').forEach(row => {
    const productSelect = row.querySelector('.item-product');
    if (!productSelect) return; // fila de solo lectura
    const productId   = parseInt(productSelect.value) || null;
    const productName = productSelect.selectedOptions[0]?.text?.replace('— Producto —', '').trim() || '';
    const colorName   = row.querySelector('.item-color') ?.value?.trim() || '';
    const quantity    = parseInt(row.querySelector('.item-qty')  ?.value) || 1;
    const unitPrice   = parseInt(row.querySelector('.item-price')?.value) || 0;
    if (!productId && !productName) return;
    items.push({ product_id: productId, product_name: productName, color_name: colorName, quantity, unit_price: unitPrice });
  });

  return {
    section:      document.getElementById('op-section')     ?.value?.trim() || 'mayorista',
    client_name:  document.getElementById('op-name')        ?.value?.trim() || '',
    client_phone: document.getElementById('op-phone')       ?.value?.trim() || '',
    delivery:     document.getElementById('op-delivery')    ?.value         || 'retiro',
    address:      document.getElementById('op-address')     ?.value?.trim() || '',
    comprobante:  document.getElementById('op-comprobante') ?.value         || '',
    notes:        document.getElementById('op-notes')       ?.value?.trim() || '',
    items,
  };
}

async function saveOrder(orderId) {
  const data = collectOrderData();
  if (!data.client_name)   { toast('Ingresá el nombre del cliente', 'error'); return; }
  if (!data.items.length)  { toast('Agregá al menos un ítem al pedido', 'error'); return; }

  try {
    if (orderId) {
      await api(`/admin/orders/${orderId}`,       { method: 'PUT', body: data });
      await api(`/admin/orders/${orderId}/items`, { method: 'PUT', body: { items: data.items } });
      toast('Pedido actualizado');
    } else {
      const created = await api('/admin/orders', { method: 'POST', body: data });
      toast('Pedido creado');
      await openOrderPanel(created.id);
    }
    await loadOrders();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function confirmOrder(orderId) {
  const errEl = document.getElementById('op-action-error');
  if (errEl) errEl.style.display = 'none';

  try {
    // Guardar cambios pendientes antes de confirmar
    const data = collectOrderData();
    if (data.items.length) {
      await api(`/admin/orders/${orderId}`,       { method: 'PUT', body: data });
      await api(`/admin/orders/${orderId}/items`, { method: 'PUT', body: { items: data.items } });
    }
    await api(`/admin/orders/${orderId}/confirm`, { method: 'POST' });
    toast('Pedido confirmado ✓', 'success');
    document.getElementById('edit-panel') ?.classList.remove('open');
    document.getElementById('panel-overlay')?.classList.remove('visible');
    await loadOrders();
  } catch (e) {
    if (errEl) {
      errEl.textContent = e.message.includes('Stock insuficiente')
        ? 'Stock insuficiente en uno o más productos — editá las cantidades antes de confirmar.'
        : e.message;
      errEl.style.display = 'block';
    } else {
      toast(e.message, 'error');
    }
  }
}

async function cancelOrder(orderId) {
  if (!confirm('¿Cancelar este pedido?')) return;
  try {
    await api(`/admin/orders/${orderId}/cancel`, { method: 'POST' });
    toast('Pedido cancelado');
    document.getElementById('edit-panel')   ?.classList.remove('open');
    document.getElementById('panel-overlay')?.classList.remove('visible');
    await loadOrders();
  } catch (e) {
    toast(e.message, 'error');
  }
}
```

- [ ] **Step 2: Verificar en browser — flujo completo**

1. Ir a `http://localhost:3000/admin` → Pedidos.
2. Click "+ Nuevo pedido": debe abrirse el panel, seleccionar un producto del dropdown, completar nombre y teléfono, click "Crear pedido" → aparece en la tabla.
3. Click "Ver / Editar" en el pedido recién creado: verificar que los datos y los ítems se cargan correctamente.
4. Editar una cantidad o agregar un ítem, click "Guardar cambios" → verificar actualización.
5. Click "Confirmar" → el panel se cierra, el pedido aparece con badge verde en la tabla.
6. Abrir el pedido confirmado → verificar que está en modo solo lectura (sin botones de acción).
7. Crear un pedido nuevo y click "Cancelar" → verificar badge rojo.

- [ ] **Step 3: Commit**

```bash
git add public/js/admin-orders.js
git commit -m "feat: panel de detalle y edición de pedidos en admin"
```

---

### Task 7: Integración checkout — guardar pedido al enviar por WhatsApp

**Files:**
- Modify: `public/js/checkout.js`

**Interfaces:**
- Consumes: `POST /api/orders` (Task 2); variables globales `state.carts`, `state.products` y función `getEffectivePrice` definidas en `catalog.js`/`products.js`
- Produces: función `saveOrderToBackend(section, name, phone, delivery, address, comprobante)` — fire-and-forget; llamada en `sendWhatsApp()` antes de `window.open`

- [ ] **Step 1: Agregar `saveOrderToBackend()` al inicio de `checkout.js`**

Después de la primera línea del archivo (`// ─── Checkout ─────...`), agregar:

```js
async function saveOrderToBackend(section, name, phone, delivery, address, comprobante) {
  const items = Object.values(state.carts[section] || {});
  const orderItems = items.map(item => {
    const product = state.products.find(p => p.id === item.productId);
    if (!product) return null;
    const { price } = getEffectivePrice(product, section, item.quantity);
    return {
      product_id:   product.id,
      product_name: product.name,
      color_name:   item.colorName || '',
      quantity:     item.quantity,
      unit_price:   price,
    };
  }).filter(Boolean);

  if (!orderItems.length) return;

  try {
    await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        section,
        client_name:  name,
        client_phone: phone,
        delivery,
        address:      address || '',
        comprobante:  comprobante || 'Consumidor Final A',
        items:        orderItems,
      }),
    });
  } catch (_) {
    // best-effort: si falla, el flujo de WhatsApp continúa igual
  }
}
```

- [ ] **Step 2: Llamar `saveOrderToBackend` en `sendWhatsApp()` antes de `window.open`**

En la función `sendWhatsApp()`, encontrar:
```js
  const url = `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`;

  window.open(url, '_blank');
```

Reemplazar con:
```js
  const url = `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`;

  // Guardar pedido en backend — best-effort, no bloquea si falla
  saveOrderToBackend(section, name, phone, delivery, address, comprobante);

  window.open(url, '_blank');
```

- [ ] **Step 3: Verificar flujo completo en browser**

1. Abrir `http://localhost:3000` (catálogo público).
2. Agregar un producto al carrito y hacer checkout.
3. Completar nombre, teléfono, tipo de entrega y hacer click en "Enviar pedido por WhatsApp".
4. Verificar que WhatsApp se abre normalmente.
5. En el panel admin (`/admin` → Pedidos), verificar que apareció el pedido con los datos correctos y status "Pendiente".

- [ ] **Step 4: Commit**

```bash
git add public/js/checkout.js
git commit -m "feat: guardar pedido en backend al enviar por WhatsApp"
```
