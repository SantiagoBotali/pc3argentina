# Dashboard de Métricas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar una página "Dashboard" al panel admin de PC3 con métricas de pedidos y productos filtradas por período de tiempo.

**Architecture:** Un solo endpoint `GET /api/admin/dashboard?from=&to=` ejecuta 9 queries en paralelo con Promise.all y devuelve un JSON con todas las métricas. El frontend es una función `renderDashboard()` en el SPA vanilla JS existente, igual que `renderProductsPage()` y `renderOrdersPage()`.

**Tech Stack:** Node.js + Express, PostgreSQL (via `global.__db`), vanilla JS, CSS custom properties.

## Global Constraints

- No se agregan librerías externas (ni frontend ni backend)
- Usar `var(--color-*)` del design system existente (`public/css/main.css`) — no hardcodear colores
- El endpoint requiere `requireAdmin` middleware
- Todos los precios en centavos enteros (INTEGER en DB). `fmtPrice()` ya existe en `admin.js`
- `active = 1` en productos (columna INTEGER, no BOOLEAN)
- La variable del color de advertencia en CSS es `--color-warning` (no `--color-warn`)

---

### Task 1: Backend endpoint `/api/admin/dashboard`

**Files:**
- Modify: `routes/api.js` — agregar el endpoint antes de `module.exports = router`

**Interfaces:**
- Consumes: `global.__db` (via `getDb()`), `requireAdmin` (ya importado)
- Produces: `GET /api/admin/dashboard?from=&to=` → JSON con keys: `kpis`, `by_section`, `by_delivery`, `top_clients`, `top_localidades`, `top_products`, `low_products`, `top_variants`, `top_pairs`

- [ ] **Step 1: Agregar el endpoint al final de `routes/api.js`, antes de `module.exports = router`**

Insertar este bloque en `routes/api.js` justo antes de la línea `module.exports = router;`:

```javascript
// ─── Dashboard ──────────────────────────────────────────────────

router.get('/admin/dashboard', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const { from, to } = req.query;

    // Adjust 'to' to include the full selected day
    const fromParam = from || null;
    const toParam   = to
      ? new Date(new Date(to).getTime() + 86_400_000).toISOString()
      : null;

    const [
      kpisRows, bySection, byDelivery,
      topClients, topLocalidades,
      topProducts, lowProducts,
      topVariants, topPairs,
    ] = await Promise.all([

      db.query(`
        SELECT
          COUNT(*)                                              AS total_orders,
          COUNT(*) FILTER (WHERE status = 'confirmed')         AS confirmed_orders,
          COUNT(*) FILTER (WHERE status = 'pending')           AS pending_orders,
          COUNT(*) FILTER (WHERE status = 'cancelled')         AS cancelled_orders,
          COALESCE(SUM(total) FILTER (WHERE status = 'confirmed'), 0) AS confirmed_revenue
        FROM orders
        WHERE ($1::timestamptz IS NULL OR created_at >= $1)
          AND ($2::timestamptz IS NULL OR created_at <  $2)
      `, [fromParam, toParam]),

      db.query(`
        SELECT section, COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue
        FROM orders
        WHERE status = 'confirmed'
          AND ($1::timestamptz IS NULL OR created_at >= $1)
          AND ($2::timestamptz IS NULL OR created_at <  $2)
        GROUP BY section
        ORDER BY orders DESC
      `, [fromParam, toParam]),

      db.query(`
        SELECT delivery, COUNT(*) AS orders
        FROM orders
        WHERE status = 'confirmed'
          AND ($1::timestamptz IS NULL OR created_at >= $1)
          AND ($2::timestamptz IS NULL OR created_at <  $2)
        GROUP BY delivery
        ORDER BY orders DESC
      `, [fromParam, toParam]),

      db.query(`
        SELECT client_name, client_phone, section,
               COUNT(*) AS orders, SUM(total) AS total
        FROM orders
        WHERE status = 'confirmed'
          AND ($1::timestamptz IS NULL OR created_at >= $1)
          AND ($2::timestamptz IS NULL OR created_at <  $2)
        GROUP BY client_name, client_phone, section
        ORDER BY orders DESC, total DESC
        LIMIT 10
      `, [fromParam, toParam]),

      db.query(`
        SELECT client_localidad, COUNT(*) AS orders, SUM(total) AS total
        FROM orders
        WHERE status = 'confirmed'
          AND client_localidad != ''
          AND ($1::timestamptz IS NULL OR created_at >= $1)
          AND ($2::timestamptz IS NULL OR created_at <  $2)
        GROUP BY client_localidad
        ORDER BY orders DESC
        LIMIT 10
      `, [fromParam, toParam]),

      db.query(`
        SELECT oi.product_name,
               SUM(oi.quantity) AS units,
               SUM(oi.subtotal) AS revenue
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.status = 'confirmed'
          AND ($1::timestamptz IS NULL OR o.created_at >= $1)
          AND ($2::timestamptz IS NULL OR o.created_at <  $2)
        GROUP BY oi.product_name
        ORDER BY units DESC
        LIMIT 10
      `, [fromParam, toParam]),

      db.query(`
        SELECT p.id AS product_id, p.name AS product_name, p.stock,
               COALESCE(SUM(oi.quantity), 0) AS units
        FROM products p
        LEFT JOIN order_items oi ON oi.product_id = p.id
        LEFT JOIN orders o
          ON  o.id = oi.order_id
          AND o.status = 'confirmed'
          AND ($1::timestamptz IS NULL OR o.created_at >= $1)
          AND ($2::timestamptz IS NULL OR o.created_at <  $2)
        WHERE p.active = 1
        GROUP BY p.id, p.name, p.stock
        ORDER BY units ASC
        LIMIT 5
      `, [fromParam, toParam]),

      db.query(`
        SELECT oi.product_name, oi.color_name, SUM(oi.quantity) AS units
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.status = 'confirmed'
          AND oi.color_name != ''
          AND ($1::timestamptz IS NULL OR o.created_at >= $1)
          AND ($2::timestamptz IS NULL OR o.created_at <  $2)
        GROUP BY oi.product_name, oi.color_name
        ORDER BY units DESC
        LIMIT 10
      `, [fromParam, toParam]),

      db.query(`
        SELECT a.product_name AS product_a,
               b.product_name AS product_b,
               COUNT(*)       AS count
        FROM order_items a
        JOIN order_items b
          ON  a.order_id = b.order_id
          AND a.product_name < b.product_name
        JOIN orders o ON o.id = a.order_id
        WHERE o.status = 'confirmed'
          AND ($1::timestamptz IS NULL OR o.created_at >= $1)
          AND ($2::timestamptz IS NULL OR o.created_at <  $2)
        GROUP BY a.product_name, b.product_name
        ORDER BY count DESC
        LIMIT 10
      `, [fromParam, toParam]),
    ]);

    const k = kpisRows[0];
    const confirmedOrders  = parseInt(k.confirmed_orders)  || 0;
    const confirmedRevenue = parseInt(k.confirmed_revenue) || 0;

    res.json({
      kpis: {
        total_orders:      parseInt(k.total_orders)     || 0,
        confirmed_orders:  confirmedOrders,
        pending_orders:    parseInt(k.pending_orders)   || 0,
        cancelled_orders:  parseInt(k.cancelled_orders) || 0,
        confirmed_revenue: confirmedRevenue,
        avg_ticket: confirmedOrders > 0
          ? Math.round(confirmedRevenue / confirmedOrders)
          : 0,
      },
      by_section:      bySection,
      by_delivery:     byDelivery,
      top_clients:     topClients,
      top_localidades: topLocalidades,
      top_products:    topProducts,
      low_products:    lowProducts,
      top_variants:    topVariants,
      top_pairs:       topPairs,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 2: Verificar el endpoint con el servidor corriendo**

Con el servidor en `http://localhost:3000` y una sesión admin activa, abrir en el browser o con curl:

```
http://localhost:3000/api/admin/dashboard
```

Resultado esperado: JSON con las 9 keys (`kpis`, `by_section`, `by_delivery`, `top_clients`, `top_localidades`, `top_products`, `low_products`, `top_variants`, `top_pairs`). Sin datos reales devolverá arrays vacíos y kpis en 0.

Probar también con filtros:
```
http://localhost:3000/api/admin/dashboard?from=2026-01-01&to=2026-07-27
```

- [ ] **Step 3: Commit**

```bash
git add routes/api.js
git commit -m "feat: add GET /api/admin/dashboard endpoint with 9 parallel queries"
```

---

### Task 2: Sidebar nav button + wiring en `navigate()`

**Files:**
- Modify: `views/admin.html` — agregar botón Dashboard en la sidebar
- Modify: `public/js/admin.js` — agregar `dashboard` al objeto `titles` y al dispatcher `navigate()`

**Interfaces:**
- Consumes: sistema de navegación existente (`data-page` attribute, `navigate()` function)
- Produces: botón Dashboard visible en sidebar que navega a la página correcta

- [ ] **Step 1: Agregar el botón Dashboard en `views/admin.html`**

Localizar el bloque de la sidebar-nav (línea ~30). Insertar el botón Dashboard como primer ítem, ANTES del botón de Productos:

Cambiar esto:
```html
      <div class="nav-section-label">Catálogo</div>
      <button class="nav-item active" data-page="products">
```

Por esto:
```html
      <div class="nav-section-label">Catálogo</div>
      <button class="nav-item" data-page="dashboard">
        <span class="nav-item-icon">📊</span> Dashboard
      </button>
      <button class="nav-item active" data-page="products">
```

- [ ] **Step 2: Actualizar `navigate()` en `public/js/admin.js`**

Localizar el objeto `titles` (línea ~63). Cambiar esto:

```javascript
  const titles = { products: 'Productos', orders: 'Pedidos', colors: 'Paleta de colores', settings: 'Configuración', password: 'Cambiar Contraseña' };
```

Por esto:

```javascript
  const titles = { dashboard: 'Dashboard', products: 'Productos', orders: 'Pedidos', colors: 'Paleta de colores', settings: 'Configuración', password: 'Cambiar Contraseña' };
```

Luego localizar el dispatcher (líneas ~66-71). Cambiar esto:

```javascript
  if (page === 'products') renderProductsPage();
  else if (page === 'orders') renderOrdersPage();
  else if (page === 'colors') renderColorsPage();
  else if (page === 'settings') renderSettingsPage();
  else if (page === 'password') renderPasswordPage();
```

Por esto:

```javascript
  if (page === 'dashboard') renderDashboard();
  else if (page === 'products') renderProductsPage();
  else if (page === 'orders') renderOrdersPage();
  else if (page === 'colors') renderColorsPage();
  else if (page === 'settings') renderSettingsPage();
  else if (page === 'password') renderPasswordPage();
```

- [ ] **Step 3: Verificar en browser**

Abrir `http://localhost:3000/admin`. El botón "📊 Dashboard" debe aparecer en la sidebar. Al hacer click debe mostrar el `admin-content` con un mensaje de error tipo "renderDashboard is not defined" (eso está bien — la función se agrega en Task 3).

- [ ] **Step 4: Commit**

```bash
git add views/admin.html public/js/admin.js
git commit -m "feat: add Dashboard nav button and navigate() wiring"
```

---

### Task 3: Implementar `renderDashboard()` en `admin.js`

**Files:**
- Modify: `public/js/admin.js` — agregar las funciones `renderDashboard`, `presetRange`, `loadDashboard`, `buildDashHTML`, `kpiCard` al final del archivo (antes del último `}`  si hay uno, o simplemente al final)

**Interfaces:**
- Consumes: `api()` helper (ya definido en admin.js), `fmtPrice()` (ya definido), endpoint `GET /api/admin/dashboard`
- Produces: funciones `renderDashboard()`, `presetRange(preset)`, `loadDashboard()`, `buildDashHTML(data)`, `kpiCard(label, value, badgeClass)`

- [ ] **Step 1: Agregar las funciones al final de `public/js/admin.js`**

Agregar este bloque completo al final del archivo:

```javascript
// ─── Dashboard Page ───────────────────────────────────────────
let dashFilters = { preset: 'all', from: '', to: '' };

async function renderDashboard() {
  const content = document.getElementById('admin-content');

  const presets = [
    { key: 'today',  label: 'Hoy' },
    { key: '7d',     label: '7 días' },
    { key: '30d',    label: '30 días' },
    { key: 'month',  label: 'Este mes' },
    { key: 'all',    label: 'Todo' },
  ];

  content.innerHTML = `
    <div id="dash-filters" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:24px">
      ${presets.map(p => `
        <button class="btn btn-sm ${dashFilters.preset === p.key ? 'btn-primary' : 'btn-ghost'}"
                data-preset="${p.key}">${p.label}</button>
      `).join('')}
      <span style="margin:0 6px;color:var(--color-text-faint)">|</span>
      <input type="date" id="dash-from" class="form-control" style="width:140px"
             value="${dashFilters.from}" placeholder="Desde">
      <input type="date" id="dash-to" class="form-control" style="width:140px"
             value="${dashFilters.to}" placeholder="Hasta">
      <button class="btn btn-sm btn-ghost" id="dash-apply">Aplicar</button>
    </div>
    <div id="dash-body">
      <div class="loader-wrap">
        <div class="loader-dots"><span></span><span></span><span></span></div>
        <span>Cargando métricas...</span>
      </div>
    </div>
  `;

  content.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      dashFilters.preset = btn.dataset.preset;
      const range = presetRange(dashFilters.preset);
      dashFilters.from = range.from;
      dashFilters.to   = range.to;
      document.getElementById('dash-from').value = range.from;
      document.getElementById('dash-to').value   = range.to;
      loadDashboard();
    });
  });

  content.querySelector('#dash-apply')?.addEventListener('click', () => {
    dashFilters.preset = 'custom';
    dashFilters.from = document.getElementById('dash-from').value;
    dashFilters.to   = document.getElementById('dash-to').value;
    loadDashboard();
  });

  loadDashboard();
}

function presetRange(preset) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = fmt(now);
  if (preset === 'today') return { from: today, to: today };
  if (preset === '7d') {
    const d = new Date(now); d.setDate(d.getDate() - 6);
    return { from: fmt(d), to: today };
  }
  if (preset === '30d') {
    const d = new Date(now); d.setDate(d.getDate() - 29);
    return { from: fmt(d), to: today };
  }
  if (preset === 'month') {
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: fmt(d), to: today };
  }
  return { from: '', to: '' }; // 'all'
}

async function loadDashboard() {
  const body = document.getElementById('dash-body');
  if (!body) return;
  body.innerHTML = `
    <div class="loader-wrap">
      <div class="loader-dots"><span></span><span></span><span></span></div>
      <span>Cargando métricas...</span>
    </div>
  `;
  try {
    const params = new URLSearchParams();
    if (dashFilters.from) params.set('from', dashFilters.from);
    if (dashFilters.to)   params.set('to',   dashFilters.to);
    const qs = params.toString();
    const data = await api(`/admin/dashboard${qs ? '?' + qs : ''}`);
    body.innerHTML = buildDashHTML(data);
  } catch (e) {
    body.innerHTML = `<p style="color:var(--color-danger);padding:20px 0">${e.message}</p>`;
  }
}

function kpiCard(label, value, badgeClass) {
  return `
    <div class="dash-kpi-card">
      <div class="dash-kpi-label">${label}</div>
      <div class="dash-kpi-val${badgeClass ? ' ' + badgeClass : ''}">${value}</div>
    </div>
  `;
}

function buildDashHTML(d) {
  const { kpis, by_section, by_delivery, top_clients, top_localidades,
          top_products, low_products, top_variants, top_pairs } = d;

  // Section distribution
  const sectionMap = {};
  by_section.forEach(s => { sectionMap[s.section] = s; });
  const proOrders = parseInt(sectionMap.profesional?.orders || 0);
  const mayOrders = parseInt(sectionMap.mayorista?.orders  || 0);
  const proRev    = parseInt(sectionMap.profesional?.revenue || 0);
  const mayRev    = parseInt(sectionMap.mayorista?.revenue  || 0);

  // Delivery distribution
  const delivMap = {};
  by_delivery.forEach(s => { delivMap[s.delivery] = parseInt(s.orders); });
  const totalDeliv = (delivMap.retiro || 0) + (delivMap.envio || 0);
  const pctRetiro  = totalDeliv ? Math.round((delivMap.retiro || 0) / totalDeliv * 100) : 0;
  const pctEnvio   = totalDeliv ? Math.round((delivMap.envio  || 0) / totalDeliv * 100) : 0;

  // Total units for % in top products
  const totalUnits = top_products.reduce((s, p) => s + parseInt(p.units), 0);

  const noData = '<p class="dash-empty">Sin datos en este período</p>';

  return `
    <div class="dash-kpi-grid">
      ${kpiCard('Total pedidos',        kpis.total_orders,                '')}
      ${kpiCard('Ingresos confirmados', fmtPrice(kpis.confirmed_revenue), '')}
      ${kpiCard('Ticket promedio',      fmtPrice(kpis.avg_ticket),        '')}
      ${kpiCard('Pendientes',           kpis.pending_orders,              'badge-warn')}
      ${kpiCard('Confirmados',          kpis.confirmed_orders,            'badge-ok')}
      ${kpiCard('Cancelados',           kpis.cancelled_orders,            'badge-err')}
    </div>

    <div class="dash-dist-grid">
      <div class="dash-dist-card">
        <div class="dash-dist-label">Profesional</div>
        <div class="dash-dist-val">${proOrders} pedidos</div>
        <div class="dash-dist-sub">${fmtPrice(proRev)}</div>
      </div>
      <div class="dash-dist-card">
        <div class="dash-dist-label">Mayorista</div>
        <div class="dash-dist-val">${mayOrders} pedidos</div>
        <div class="dash-dist-sub">${fmtPrice(mayRev)}</div>
      </div>
      <div class="dash-dist-card">
        <div class="dash-dist-label">Retiro en local</div>
        <div class="dash-dist-val">${delivMap.retiro || 0} pedidos</div>
        <div class="dash-dist-sub">${pctRetiro}% del total</div>
      </div>
      <div class="dash-dist-card">
        <div class="dash-dist-label">Envío a domicilio</div>
        <div class="dash-dist-val">${delivMap.envio || 0} pedidos</div>
        <div class="dash-dist-sub">${pctEnvio}% del total</div>
      </div>
    </div>

    <div class="dash-tables-grid">
      <div class="dash-table-card">
        <h4 class="dash-table-title">Clientes más frecuentes</h4>
        ${top_clients.length === 0 ? noData : `
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead><tr><th>Cliente</th><th>Teléfono</th><th>Sección</th><th>Pedidos</th><th>Total</th></tr></thead>
              <tbody>${top_clients.map(c => `
                <tr>
                  <td>${c.client_name || '—'}</td>
                  <td style="font-size:12px;color:var(--color-text-muted)">${c.client_phone || '—'}</td>
                  <td><span class="dash-badge">${c.section || '—'}</span></td>
                  <td>${c.orders}</td>
                  <td>${fmtPrice(c.total)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>`}
      </div>
      <div class="dash-table-card">
        <h4 class="dash-table-title">Por localidad</h4>
        ${top_localidades.length === 0 ? noData : `
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead><tr><th>Localidad</th><th>Pedidos</th><th>Total</th></tr></thead>
              <tbody>${top_localidades.map(l => `
                <tr>
                  <td>${l.client_localidad || '—'}</td>
                  <td>${l.orders}</td>
                  <td>${fmtPrice(l.total)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>`}
      </div>
    </div>

    <div class="dash-tables-grid">
      <div class="dash-table-card">
        <h4 class="dash-table-title">Productos más vendidos</h4>
        ${top_products.length === 0 ? noData : `
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead><tr><th>Producto</th><th>Unidades</th><th>Ingresos</th><th>%</th></tr></thead>
              <tbody>${top_products.map(p => `
                <tr>
                  <td>${p.product_name}</td>
                  <td>${p.units}</td>
                  <td>${fmtPrice(p.revenue)}</td>
                  <td style="color:var(--color-text-muted)">${totalUnits > 0 ? Math.round(parseInt(p.units) / totalUnits * 100) : 0}%</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>`}
      </div>
      <div class="dash-table-card">
        <h4 class="dash-table-title">Productos menos vendidos</h4>
        ${low_products.length === 0 ? noData : `
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead><tr><th>Producto</th><th>Unidades vendidas</th><th>Stock actual</th></tr></thead>
              <tbody>${low_products.map(p => `
                <tr>
                  <td>${p.product_name}</td>
                  <td>${p.units}</td>
                  <td>${p.stock}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>`}
      </div>
    </div>

    <div class="dash-tables-grid">
      <div class="dash-table-card">
        <h4 class="dash-table-title">Variantes más pedidas</h4>
        ${top_variants.length === 0 ? noData : `
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead><tr><th>Producto</th><th>Color</th><th>Unidades</th></tr></thead>
              <tbody>${top_variants.map(v => `
                <tr>
                  <td>${v.product_name}</td>
                  <td>${v.color_name}</td>
                  <td>${v.units}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>`}
      </div>
      <div class="dash-table-card">
        <h4 class="dash-table-title">Pares más frecuentes</h4>
        ${top_pairs.length === 0 ? noData : `
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead><tr><th>Producto A</th><th>Producto B</th><th>Veces juntos</th></tr></thead>
              <tbody>${top_pairs.map(p => `
                <tr>
                  <td>${p.product_a}</td>
                  <td>${p.product_b}</td>
                  <td>${p.count}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>`}
      </div>
    </div>
  `;
}
```

- [ ] **Step 2: Verificar en browser**

Abrir `http://localhost:3000/admin` y hacer click en "📊 Dashboard". Debe:
1. Mostrar la barra de filtros (botones Hoy / 7 días / 30 días / Este mes / Todo)
2. Mostrar las 6 KPI cards con valores (0 si no hay pedidos confirmados)
3. Mostrar las 4 cards de distribución (Profesional / Mayorista / Retiro / Envío)
4. Mostrar las 6 tablas con "Sin datos en este período" si no hay pedidos confirmados

Probar los botones de preset: cada uno debe recargar las métricas.

- [ ] **Step 3: Commit**

```bash
git add public/js/admin.js
git commit -m "feat: implement renderDashboard() with filters, KPI cards and data tables"
```

---

### Task 4: CSS para el Dashboard

**Files:**
- Modify: `public/css/admin.css` — agregar estilos del dashboard al final del archivo

**Interfaces:**
- Consumes: variables CSS del design system (`--color-surface`, `--color-border`, `--color-text`, `--color-text-muted`, `--color-text-faint`, `--color-warning`, `--color-success`, `--color-danger`, `--radius-lg`, definidas en `public/css/main.css`)
- Produces: clases CSS `.dash-kpi-grid`, `.dash-kpi-card`, `.dash-kpi-label`, `.dash-kpi-val`, `.badge-warn`, `.badge-ok`, `.badge-err`, `.dash-dist-grid`, `.dash-dist-card`, `.dash-dist-label`, `.dash-dist-val`, `.dash-dist-sub`, `.dash-tables-grid`, `.dash-table-card`, `.dash-table-title`, `.dash-empty`, `.dash-badge`

- [ ] **Step 1: Agregar los estilos al final de `public/css/admin.css`**

```css
/* ─── Dashboard ──────────────────────────────────────────────── */
.dash-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 14px;
  margin-bottom: 20px;
}

.dash-kpi-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 18px 20px;
}

.dash-kpi-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  margin-bottom: 8px;
}

.dash-kpi-val {
  font-size: 26px;
  font-weight: 700;
  color: var(--color-text);
  line-height: 1;
}

.dash-kpi-val.badge-warn { color: var(--color-warning); }
.dash-kpi-val.badge-ok   { color: var(--color-success); }
.dash-kpi-val.badge-err  { color: var(--color-danger);  }

.dash-dist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 14px;
  margin-bottom: 20px;
}

.dash-dist-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 16px 18px;
}

.dash-dist-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  margin-bottom: 6px;
}

.dash-dist-val {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text);
  margin-bottom: 3px;
}

.dash-dist-sub {
  font-size: 12px;
  color: var(--color-text-faint);
}

.dash-tables-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 20px;
}

@media (max-width: 900px) {
  .dash-tables-grid { grid-template-columns: 1fr; }
}

.dash-table-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 16px;
  overflow: hidden;
  min-width: 0;
}

.dash-table-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text);
  margin: 0 0 12px;
}

.dash-empty {
  color: var(--color-text-faint);
  font-size: 13px;
  text-align: center;
  padding: 24px 0;
  margin: 0;
}

.dash-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 100px;
  font-size: 11px;
  font-weight: 600;
  background: var(--color-surface2);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  text-transform: capitalize;
}
```

- [ ] **Step 2: Verificar visualmente en browser**

Abrir `http://localhost:3000/admin` → Dashboard. Verificar:
1. Las 6 KPI cards se distribuyen en grilla responsive
2. Los valores de Pendientes / Confirmados / Cancelados se muestran en amarillo / verde / rojo
3. Las 4 cards de distribución se muestran en fila
4. Las tablas se muestran en dos columnas en desktop y en una columna en pantallas < 900px (reducir el browser para probarlo)
5. El tema claro/oscuro (si aplica) mantiene el contraste correcto con las variables CSS

- [ ] **Step 3: Commit**

```bash
git add public/css/admin.css
git commit -m "feat: add dashboard CSS styles"
```

---

## Self-Review

**Cobertura del spec:**
- ✅ Filtros por período (Hoy, 7d, 30d, Este mes, Todo + rango custom) → Task 3 `renderDashboard()`
- ✅ 6 KPI cards → Task 3 `buildDashHTML()`
- ✅ Distribución por sección (Profesional/Mayorista) + entrega (Retiro/Envío) → Task 3
- ✅ Tabla clientes más frecuentes → Task 3
- ✅ Tabla por localidad → Task 3
- ✅ Top 10 productos más vendidos → Task 3
- ✅ Top 5 productos menos vendidos → Task 3
- ✅ Top variantes (producto + color) → Task 3
- ✅ Top pares de productos → Task 3
- ✅ Un solo endpoint `/api/admin/dashboard` → Task 1
- ✅ Sin librerías externas → todo el plan

**Consistencia de nombres:**
- `renderDashboard()` definida en Task 3, llamada desde `navigate()` en Task 2 ✅
- `loadDashboard()`, `presetRange()`, `buildDashHTML()`, `kpiCard()` todas definidas en Task 3 ✅
- Clases CSS definidas en Task 4, usadas en `buildDashHTML()` en Task 3 ✅
- `dashFilters` definido en Task 3 como variable de módulo ✅
- `--color-warning` (no `--color-warn`) — corregido en Task 4 ✅

**Sin placeholders:** Todo el código está completo. ✅
