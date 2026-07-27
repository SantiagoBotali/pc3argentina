# Dashboard Charts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar gráficos interactivos (Chart.js) al dashboard existente con tabs Gráfico/Tabla por sección y una nueva sección de evolución temporal.

**Architecture:** Chart.js 4.x cargado lazy vía CDN la primera vez que el usuario navega al Dashboard. Un registry `dashCharts` rastrea instancias activas y las destruye antes de cada recarga. Cada sección del dashboard tiene tabs "Gráfico / Tabla"; los charts se inicializan lazy al mostrar el tab Gráfico. La única nueva query de backend agrupa pedidos confirmados por día o mes según el rango seleccionado.

**Tech Stack:** Node.js/Express, PostgreSQL, Chart.js 4 (CDN), vanilla JS, CSS custom properties.

## Global Constraints

- Chart.js CDN: `https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js` — exactamente esta URL
- Color primario de charts: `#00B3E9` (accent del design system)
- Color secundario línea de ingresos: `#22c55e`
- Color alerta (low products): `#f59e0b`
- Color neutro donut: `#555`
- Truncado de etiquetas largas: máximo 22 caracteres + `…`
- Tab default activo: "Gráfico" (no "Tabla")
- `esc()` helper ya existe en admin.js — no redefinir
- `fmtPrice()` ya existe en admin.js — no redefinir
- `dashFilters`, `renderDashboard`, `loadDashboard`, `kpiCard`, `buildDashHTML`, `presetRange` ya existen — modificar/reemplazar según cada task
- No agregar otras librerías externas
- Sólo modificar los 3 archivos listados abajo

---

### Task 1: Backend — `orders_over_time` en `/api/admin/dashboard`

**Files:**
- Modify: `routes/api.js` líneas 897–1059 (el endpoint `/admin/dashboard`)

**Interfaces:**
- Consumes: `fromParam`, `toParam` ya calculados en el endpoint
- Produces: dos campos nuevos en el JSON de respuesta: `orders_over_time: [{date, orders, revenue}]` y `time_granularity: 'day' | 'month'`

- [ ] **Step 1: Agregar la lógica de granularidad y la 10ª query en `routes/api.js`**

Localizar la sección del dashboard (línea ~897). Hacer estos tres cambios:

**Cambio A** — después de la línea `const toParam = to ? ...` (línea ~906), insertar:

```javascript
    // Determine time grouping granularity (≤60 days → by day, else → by month)
    const diffDays = fromParam && toParam
      ? Math.round((new Date(toParam) - new Date(fromParam)) / 86_400_000)
      : null;
    const byDay = diffDays !== null && diffDays <= 60;
    const timeGroupExpr = byDay
      ? `DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')`
      : `TO_CHAR(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM')`;
```

**Cambio B** — en el destructuring del Promise.all (línea ~908), agregar `ordersOverTime` al final:

Cambiar:
```javascript
    const [
      kpisRows, bySection, byDelivery,
      topClients, topLocalidades,
      topProducts, lowProducts,
      topVariants, topPairs,
    ] = await Promise.all([
```
Por:
```javascript
    const [
      kpisRows, bySection, byDelivery,
      topClients, topLocalidades,
      topProducts, lowProducts,
      topVariants, topPairs,
      ordersOverTime,
    ] = await Promise.all([
```

**Cambio C** — al final del array de Promise.all, antes del `]);` de cierre (línea ~1030), agregar la 10ª query:

```javascript
      db.query(
        `SELECT ${timeGroupExpr} AS date,
                COUNT(*) AS orders,
                COALESCE(SUM(total), 0) AS revenue
         FROM orders
         WHERE status = 'confirmed'
           AND ($1::timestamptz IS NULL OR created_at >= $1)
           AND ($2::timestamptz IS NULL OR created_at <  $2)
         GROUP BY ${timeGroupExpr}
         ORDER BY date ASC`,
        [fromParam, toParam]
      ),
```

**Cambio D** — en `res.json(...)` (línea ~1036), agregar los 2 campos nuevos al final del objeto (antes del `}`):

```javascript
      top_pairs:        topPairs,
      orders_over_time: ordersOverTime,
      time_granularity: byDay ? 'day' : 'month',
```

- [ ] **Step 2: Verificar el endpoint**

Con el servidor corriendo en `http://localhost:3000`, navegar a:
```
http://localhost:3000/api/admin/dashboard?from=2026-07-01&to=2026-07-27
```
(requiere sesión admin activa — usar el browser con sesión iniciada)

Resultado esperado: el JSON incluye los campos `orders_over_time` (array, puede estar vacío) y `time_granularity: "day"`.

Verificar sin fechas:
```
http://localhost:3000/api/admin/dashboard
```
Resultado esperado: `time_granularity: "month"`.

- [ ] **Step 3: Commit**

```bash
git add routes/api.js
git commit -m "feat: add orders_over_time time-series to dashboard endpoint"
```

---

### Task 2: CSS — sistema de tabs y estilos del dashboard con gráficos

**Files:**
- Modify: `public/css/admin.css` — agregar al final del archivo

**Interfaces:**
- Produces: clases `.dash-card-header`, `.dash-tabs`, `.dash-tab`, `.dash-tab.active`, `.dash-tab-pane`, `.dash-tab-pane.hidden`, `.dash-dist-mini`, `.dash-granularity`

- [ ] **Step 1: Agregar los estilos al final de `public/css/admin.css`**

```css
/* ─── Dashboard Tabs ──────────────────────────────────────────── */
.dash-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  gap: 8px;
}

.dash-card-header .dash-table-title { margin: 0; }

.dash-tabs {
  display: flex;
  gap: 3px;
  background: var(--color-surface2);
  border-radius: var(--radius);
  padding: 3px;
  flex-shrink: 0;
}

.dash-tab {
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: calc(var(--radius) - 2px);
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all var(--transition);
  white-space: nowrap;
}

.dash-tab.active {
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
}

.dash-tab-pane.hidden { display: none; }

/* ─── Distribution mini-cards inside tab pane ────────────────── */
.dash-dist-mini {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 4px 0;
}

/* ─── Granularity label next to chart title ──────────────────── */
.dash-granularity {
  font-size: 11px;
  color: var(--color-text-faint);
}
```

- [ ] **Step 2: Verificar clases**

Abrir `http://localhost:3000/admin` y navegar a Dashboard (que actualmente NO tiene tabs todavía — OK). Confirmar que el CSS se cargó sin errores de consola y que el archivo no tiene syntax errors (DevTools → Sources → admin.css).

- [ ] **Step 3: Commit**

```bash
git add public/css/admin.css
git commit -m "feat: add dashboard tab system CSS"
```

---

### Task 3: Infraestructura Chart.js — lazy load, registry, destroy, wiring

**Files:**
- Modify: `public/js/admin.js`
  - Agregar `let dashCharts = {}` antes de `let dashFilters`
  - Agregar `loadChartJs()` function
  - Agregar `destroyDashCharts()` function
  - Modificar `renderDashboard()` para await loadChartJs()
  - Modificar `loadDashboard()` para llamar destroyDashCharts() + initVisibleCharts() + setupTabDelegation()

**Interfaces:**
- Produces:
  - `let dashCharts` — registro de instancias Chart activas (objeto vacío al inicio)
  - `loadChartJs()` — `async function`, retorna Promise, inyecta CDN si no existe
  - `destroyDashCharts()` — destruye todas las instancias en `dashCharts`, resetea el objeto
  - `renderDashboard()` modificada — hace `await loadChartJs()` antes de `loadDashboard()`
  - `loadDashboard()` modificada — llama `destroyDashCharts()` al inicio, y después de `body.innerHTML = buildDashHTML(data)` llama `initVisibleCharts(data)` y `setupTabDelegation(body, data)`
- Consumes: `window.Chart` (Chart.js global tras CDN load), `initVisibleCharts` y `setupTabDelegation` (se definen en Task 4 — en este task solo se llaman)

- [ ] **Step 1: Agregar `let dashCharts = {}` en `public/js/admin.js`**

Localizar la línea (actual ~1240):
```javascript
let dashFilters = { preset: 'all', from: '', to: '' };
```

Cambiar a:
```javascript
let dashCharts  = {};
let dashFilters = { preset: 'all', from: '', to: '' };
```

- [ ] **Step 2: Agregar `loadChartJs()` y `destroyDashCharts()` después de `let dashFilters`**

Insertar estas dos funciones inmediatamente después de las líneas `let dashCharts` / `let dashFilters`:

```javascript
async function loadChartJs() {
  if (window.Chart) return;
  return new Promise((resolve, reject) => {
    if (document.getElementById('chartjs-cdn')) {
      // Script tag exists but Chart not yet ready — wait for load
      document.getElementById('chartjs-cdn').addEventListener('load', () => {
        applyChartDefaults();
        resolve();
      });
      return;
    }
    const s = document.createElement('script');
    s.id  = 'chartjs-cdn';
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
    s.onload  = () => { applyChartDefaults(); resolve(); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function applyChartDefaults() {
  if (!window.Chart) return;
  const style = getComputedStyle(document.documentElement);
  Chart.defaults.color       = style.getPropertyValue('--color-text-muted').trim() || '#888';
  Chart.defaults.borderColor = style.getPropertyValue('--color-border').trim()     || '#2a2a2a';
  Chart.defaults.font.family = style.getPropertyValue('font-family')               || 'inherit';
}

function destroyDashCharts() {
  Object.values(dashCharts).forEach(c => { try { c.destroy(); } catch (_) {} });
  dashCharts = {};
}
```

- [ ] **Step 3: Modificar `renderDashboard()` para awaitar Chart.js**

Localizar `async function renderDashboard()` (línea ~1242). La primera línea del cuerpo es:
```javascript
  const content = document.getElementById('admin-content');
```

Agregar `await loadChartJs();` ANTES de esa línea:
```javascript
async function renderDashboard() {
  await loadChartJs();
  const content = document.getElementById('admin-content');
  // ... resto sin cambios
```

- [ ] **Step 4: Modificar `loadDashboard()` para destroy + initVisibleCharts + setupTabDelegation**

Localizar `async function loadDashboard()` (línea ~1322). Reemplazar la función completa:

```javascript
async function loadDashboard() {
  const body = document.getElementById('dash-body');
  if (!body) return;
  destroyDashCharts();
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
    initVisibleCharts(data);
    setupTabDelegation(body, data);
  } catch (e) {
    body.innerHTML = '';
    const errP = document.createElement('p');
    errP.style.cssText = 'color:var(--color-danger);padding:20px 0';
    errP.textContent = e.message;
    body.appendChild(errP);
  }
}
```

- [ ] **Step 5: Verificar en browser**

Abrir DevTools → Console. Navegar a Dashboard. Confirmar:
- No hay errores de JavaScript
- El script de Chart.js se carga (Network tab → buscar `chart.umd.min.js` con status 200)
- `window.Chart` existe en la consola después de cargar

- [ ] **Step 6: Commit**

```bash
git add public/js/admin.js
git commit -m "feat: add Chart.js lazy-load, dashCharts registry and destroy wiring"
```

---

### Task 4: Charts UI — reescribir `buildDashHTML` + todas las funciones de gráficos

**Files:**
- Modify: `public/js/admin.js`
  - Reemplazar `buildDashHTML()` completa (líneas 1356–1521)
  - Agregar al final del archivo: `setupTabDelegation`, `initVisibleCharts`, `initDashChart`, `truncLabel`, y 9 funciones `initChart*`

**Interfaces:**
- Consumes: `dashCharts` (de Task 3), `window.Chart` (de Task 3 lazy-load), `esc()`, `fmtPrice()`, `kpiCard()`
- Produces:
  - `buildDashHTML(d)` — retorna HTML string con estructura de tabs y canvases
  - `setupTabDelegation(body, data)` — instala event listener delegado en `body` para tab clicks
  - `initVisibleCharts(data)` — inicializa todos los charts visibles (tab "Gráfico" activo por defecto)
  - `initDashChart(id, data)` — dispatcher que llama al `initChart*` correcto según `id`
  - `truncLabel(s, max)` — trunca string a `max` caracteres (default 22) con `…`
  - `initChartTimeline(canvas, data)` — línea doble: pedidos (eje izq) + ingresos (eje der)
  - `initChartSection(canvas, data)` — donut: Profesional vs Mayorista
  - `initChartDelivery(canvas, data)` — donut: Retiro vs Envío
  - `initChartClients(canvas, data)` — barras horiz: clientes por pedidos
  - `initChartLocalidades(canvas, data)` — barras horiz: localidades por pedidos
  - `initChartTopProducts(canvas, data)` — barras horiz: productos por unidades
  - `initChartLowProducts(canvas, data)` — barras horiz: productos menos vendidos (color amber)
  - `initChartVariants(canvas, data)` — barras horiz: variantes producto·color
  - `initChartPairs(canvas, data)` — barras horiz: pares de productos

- [ ] **Step 1: Reemplazar `buildDashHTML()` en `public/js/admin.js`**

Localizar la función `buildDashHTML` completa (línea 1356 hasta el final del archivo, línea 1522). Reemplazarla con:

```javascript
function buildDashHTML(d) {
  const { kpis, by_section, by_delivery, top_clients, top_localidades,
          top_products, low_products, top_variants, top_pairs,
          orders_over_time = [], time_granularity = 'day' } = d;

  const sectionMap = {};
  by_section.forEach(s => { sectionMap[s.section] = s; });
  const proOrders = parseInt(sectionMap.profesional?.orders  || 0);
  const mayOrders = parseInt(sectionMap.mayorista?.orders    || 0);
  const proRev    = parseInt(sectionMap.profesional?.revenue || 0);
  const mayRev    = parseInt(sectionMap.mayorista?.revenue   || 0);

  const delivMap  = {};
  by_delivery.forEach(s => { delivMap[s.delivery] = parseInt(s.orders); });
  const totalDeliv = (delivMap.retiro || 0) + (delivMap.envio || 0);
  const pctRetiro  = totalDeliv ? Math.round((delivMap.retiro || 0) / totalDeliv * 100) : 0;
  const pctEnvio   = totalDeliv ? Math.round((delivMap.envio  || 0) / totalDeliv * 100) : 0;

  const totalUnits = top_products.reduce((s, p) => s + parseInt(p.units), 0);
  const noData     = '<p class="dash-empty">Sin datos en este período</p>';

  // Helper: card with Gráfico/Tabla tabs
  function tabCard(title, cardId, chartH, hasNoData, tableHtml) {
    const chartPane = hasNoData
      ? noData
      : `<div style="position:relative;height:${chartH}px"><canvas id="chart-${cardId}"></canvas></div>`;
    return `
      <div class="dash-table-card">
        <div class="dash-card-header">
          <h4 class="dash-table-title">${title}</h4>
          <div class="dash-tabs">
            <button class="dash-tab active" data-tab="chart" data-card="${cardId}">Gráfico</button>
            <button class="dash-tab" data-tab="table" data-card="${cardId}">Tabla</button>
          </div>
        </div>
        <div class="dash-tab-pane" data-pane="chart" data-card="${cardId}">${chartPane}</div>
        <div class="dash-tab-pane hidden" data-pane="table" data-card="${cardId}">${tableHtml}</div>
      </div>`;
  }

  // Helper: dynamic height for horizontal bar charts
  function barH(n) { return Math.max(180, n * 34 + 40); }

  return `
    <!-- KPI Cards -->
    <div class="dash-kpi-grid">
      ${kpiCard('Total pedidos',        kpis.total_orders,                '')}
      ${kpiCard('Ingresos confirmados', fmtPrice(kpis.confirmed_revenue), '')}
      ${kpiCard('Ticket promedio',      fmtPrice(kpis.avg_ticket),        '')}
      ${kpiCard('Pendientes',           kpis.pending_orders,              'badge-warn')}
      ${kpiCard('Confirmados',          kpis.confirmed_orders,            'badge-ok')}
      ${kpiCard('Cancelados',           kpis.cancelled_orders,            'badge-err')}
    </div>

    <!-- Evolución temporal (no table tab — chart only) -->
    <div class="dash-table-card" style="margin-bottom:20px">
      <div class="dash-card-header">
        <h4 class="dash-table-title">Evolución temporal</h4>
        ${orders_over_time.length > 0
          ? `<span class="dash-granularity">${time_granularity === 'day' ? 'por día' : 'por mes'}</span>`
          : ''}
      </div>
      ${orders_over_time.length === 0
        ? '<p class="dash-empty">Sin pedidos confirmados en este período</p>'
        : '<div style="position:relative;height:280px"><canvas id="chart-timeline"></canvas></div>'}
    </div>

    <!-- Distribution: section + delivery -->
    <div class="dash-tables-grid">
      ${tabCard(
        'Por tipo de cliente', 'section', 220,
        proOrders === 0 && mayOrders === 0,
        `<div class="dash-dist-mini">
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
        </div>`
      )}
      ${tabCard(
        'Por tipo de entrega', 'delivery', 220,
        totalDeliv === 0,
        `<div class="dash-dist-mini">
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
        </div>`
      )}
    </div>

    <!-- Clients + Localidades -->
    <div class="dash-tables-grid">
      ${tabCard(
        'Clientes más frecuentes', 'clients', barH(top_clients.length),
        top_clients.length === 0,
        top_clients.length === 0 ? noData : `
          <div class="admin-table-wrap"><table class="admin-table">
            <thead><tr><th>Cliente</th><th>Teléfono</th><th>Sección</th><th>Pedidos</th><th>Total</th></tr></thead>
            <tbody>${top_clients.map(c => `
              <tr>
                <td>${esc(c.client_name) || '—'}</td>
                <td style="font-size:12px;color:var(--color-text-muted)">${esc(c.client_phone) || '—'}</td>
                <td><span class="dash-badge">${esc(c.section) || '—'}</span></td>
                <td>${c.orders}</td>
                <td>${fmtPrice(c.total)}</td>
              </tr>`).join('')}
            </tbody>
          </table></div>`
      )}
      ${tabCard(
        'Por localidad', 'localidades', barH(top_localidades.length),
        top_localidades.length === 0,
        top_localidades.length === 0 ? noData : `
          <div class="admin-table-wrap"><table class="admin-table">
            <thead><tr><th>Localidad</th><th>Pedidos</th><th>Total</th></tr></thead>
            <tbody>${top_localidades.map(l => `
              <tr>
                <td>${esc(l.client_localidad) || '—'}</td>
                <td>${l.orders}</td>
                <td>${fmtPrice(l.total)}</td>
              </tr>`).join('')}
            </tbody>
          </table></div>`
      )}
    </div>

    <!-- Top / Low products -->
    <div class="dash-tables-grid">
      ${tabCard(
        'Productos más vendidos', 'top-products', barH(top_products.length),
        top_products.length === 0,
        top_products.length === 0 ? noData : `
          <div class="admin-table-wrap"><table class="admin-table">
            <thead><tr><th>Producto</th><th>Unidades</th><th>Ingresos</th><th>%</th></tr></thead>
            <tbody>${top_products.map(p => `
              <tr>
                <td>${esc(p.product_name)}</td>
                <td>${p.units}</td>
                <td>${fmtPrice(p.revenue)}</td>
                <td style="color:var(--color-text-muted)">${totalUnits > 0 ? Math.round(parseInt(p.units) / totalUnits * 100) : 0}%</td>
              </tr>`).join('')}
            </tbody>
          </table></div>`
      )}
      ${tabCard(
        'Productos menos vendidos', 'low-products', barH(low_products.length),
        low_products.length === 0,
        low_products.length === 0 ? noData : `
          <div class="admin-table-wrap"><table class="admin-table">
            <thead><tr><th>Producto</th><th>Unidades vendidas</th><th>Stock actual</th></tr></thead>
            <tbody>${low_products.map(p => `
              <tr>
                <td>${esc(p.product_name)}</td>
                <td>${p.units}</td>
                <td>${p.stock}</td>
              </tr>`).join('')}
            </tbody>
          </table></div>`
      )}
    </div>

    <!-- Variants + Pairs -->
    <div class="dash-tables-grid">
      ${tabCard(
        'Variantes más pedidas', 'variants', barH(top_variants.length),
        top_variants.length === 0,
        top_variants.length === 0 ? noData : `
          <div class="admin-table-wrap"><table class="admin-table">
            <thead><tr><th>Producto</th><th>Color</th><th>Unidades</th></tr></thead>
            <tbody>${top_variants.map(v => `
              <tr>
                <td>${esc(v.product_name)}</td>
                <td>${esc(v.color_name)}</td>
                <td>${v.units}</td>
              </tr>`).join('')}
            </tbody>
          </table></div>`
      )}
      ${tabCard(
        'Pares más frecuentes', 'pairs', barH(top_pairs.length),
        top_pairs.length === 0,
        top_pairs.length === 0 ? noData : `
          <div class="admin-table-wrap"><table class="admin-table">
            <thead><tr><th>Producto A</th><th>Producto B</th><th>Veces juntos</th></tr></thead>
            <tbody>${top_pairs.map(p => `
              <tr>
                <td>${esc(p.product_a)}</td>
                <td>${esc(p.product_b)}</td>
                <td>${p.count}</td>
              </tr>`).join('')}
            </tbody>
          </table></div>`
      )}
    </div>
  `;
}
```

- [ ] **Step 2: Agregar las funciones de charts al final del archivo**

Después del cierre de la nueva `buildDashHTML`, agregar todas las siguientes funciones al final de `public/js/admin.js`:

```javascript
// ─── Dashboard Chart helpers ──────────────────────────────────
const truncLabel = (s, max = 22) => {
  s = String(s ?? '');
  return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
};

function setupTabDelegation(body, data) {
  body.addEventListener('click', e => {
    const tab = e.target.closest('.dash-tab');
    if (!tab) return;
    const cardId  = tab.dataset.card;
    const tabType = tab.dataset.tab;

    // Toggle active class on tab buttons
    body.querySelectorAll(`.dash-tab[data-card="${cardId}"]`).forEach(t => {
      t.classList.toggle('active', t === tab);
    });
    // Show/hide panes
    body.querySelectorAll(`.dash-tab-pane[data-card="${cardId}"]`).forEach(p => {
      p.classList.toggle('hidden', p.dataset.pane !== tabType);
    });
    // Lazy-init chart on first "Gráfico" click
    if (tabType === 'chart' && !dashCharts[cardId]) {
      initDashChart(cardId, data);
    }
  });
}

function initVisibleCharts(data) {
  // All sections start with "Gráfico" tab active — init them all eagerly
  const ids = ['timeline', 'section', 'delivery', 'clients', 'localidades',
               'top-products', 'low-products', 'variants', 'pairs'];
  ids.forEach(id => initDashChart(id, data));
}

function initDashChart(id, data) {
  const canvas = document.getElementById(`chart-${id}`);
  if (!canvas || dashCharts[id]) return; // no canvas (no data) or already inited
  let chart;
  switch (id) {
    case 'timeline':     chart = initChartTimeline(canvas, data);     break;
    case 'section':      chart = initChartSection(canvas, data);      break;
    case 'delivery':     chart = initChartDelivery(canvas, data);     break;
    case 'clients':      chart = initChartClients(canvas, data);      break;
    case 'localidades':  chart = initChartLocalidades(canvas, data);  break;
    case 'top-products': chart = initChartTopProducts(canvas, data);  break;
    case 'low-products': chart = initChartLowProducts(canvas, data);  break;
    case 'variants':     chart = initChartVariants(canvas, data);     break;
    case 'pairs':        chart = initChartPairs(canvas, data);        break;
  }
  if (chart) dashCharts[id] = chart;
}

// ─── Individual chart initializers ───────────────────────────

function initChartTimeline(canvas, data) {
  const rows = data.orders_over_time || [];
  return new Chart(canvas, {
    type: 'line',
    data: {
      labels: rows.map(r => r.date),
      datasets: [
        {
          label: 'Pedidos',
          data: rows.map(r => parseInt(r.orders)),
          borderColor: '#00B3E9',
          backgroundColor: 'rgba(0,179,233,0.1)',
          yAxisID: 'yOrders',
          tension: 0.3,
          fill: true,
          pointRadius: rows.length > 30 ? 0 : 3,
        },
        {
          label: 'Ingresos',
          data: rows.map(r => parseInt(r.revenue)),
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34,197,94,0.07)',
          yAxisID: 'yRevenue',
          tension: 0.3,
          fill: false,
          pointRadius: rows.length > 30 ? 0 : 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top' },
        tooltip: {
          callbacks: {
            label: ctx => ctx.dataset.yAxisID === 'yRevenue'
              ? ` Ingresos: ${fmtPrice(ctx.parsed.y)}`
              : ` Pedidos: ${ctx.parsed.y}`,
          },
        },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 12 } },
        yOrders: {
          type: 'linear', position: 'left', beginAtZero: true,
          ticks: { precision: 0 },
          title: { display: true, text: 'Pedidos' },
        },
        yRevenue: {
          type: 'linear', position: 'right', beginAtZero: true,
          grid: { drawOnChartArea: false },
          ticks: { callback: v => fmtPrice(v) },
          title: { display: true, text: 'Ingresos' },
        },
      },
    },
  });
}

function initChartSection(canvas, data) {
  const map = {};
  (data.by_section || []).forEach(s => { map[s.section] = parseInt(s.orders); });
  return new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Profesional', 'Mayorista'],
      datasets: [{ data: [map.profesional || 0, map.mayorista || 0],
                   backgroundColor: ['#00B3E9', '#555'], borderWidth: 0 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} pedidos` } },
      },
    },
  });
}

function initChartDelivery(canvas, data) {
  const map = {};
  (data.by_delivery || []).forEach(s => { map[s.delivery] = parseInt(s.orders); });
  return new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Retiro en local', 'Envío a domicilio'],
      datasets: [{ data: [map.retiro || 0, map.envio || 0],
                   backgroundColor: ['#00B3E9', '#555'], borderWidth: 0 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} pedidos` } },
      },
    },
  });
}

function initChartClients(canvas, data) {
  const rows = data.top_clients || [];
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: rows.map(c => truncLabel(c.client_name || '—')),
      datasets: [{ label: 'Pedidos', data: rows.map(c => parseInt(c.orders)),
                   backgroundColor: '#00B3E9', borderRadius: 4 }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.parsed.x} pedidos`,
            afterLabel: ctx => ` ${fmtPrice(rows[ctx.dataIndex]?.total || 0)}`,
          },
        },
      },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function initChartLocalidades(canvas, data) {
  const rows = data.top_localidades || [];
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: rows.map(l => truncLabel(l.client_localidad || '—')),
      datasets: [{ label: 'Pedidos', data: rows.map(l => parseInt(l.orders)),
                   backgroundColor: '#00B3E9', borderRadius: 4 }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.parsed.x} pedidos`,
            afterLabel: ctx => ` ${fmtPrice(rows[ctx.dataIndex]?.total || 0)}`,
          },
        },
      },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function initChartTopProducts(canvas, data) {
  const rows = data.top_products || [];
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: rows.map(p => truncLabel(p.product_name)),
      datasets: [{ label: 'Unidades', data: rows.map(p => parseInt(p.units)),
                   backgroundColor: '#00B3E9', borderRadius: 4 }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.parsed.x} unidades`,
            afterLabel: ctx => ` ${fmtPrice(rows[ctx.dataIndex]?.revenue || 0)}`,
          },
        },
      },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function initChartLowProducts(canvas, data) {
  const rows = data.low_products || [];
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: rows.map(p => truncLabel(p.product_name)),
      datasets: [{ label: 'Unidades vendidas', data: rows.map(p => parseInt(p.units)),
                   backgroundColor: '#f59e0b', borderRadius: 4 }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.parsed.x} unidades vendidas`,
            afterLabel: ctx => ` Stock: ${rows[ctx.dataIndex]?.stock ?? 0}`,
          },
        },
      },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function initChartVariants(canvas, data) {
  const rows = data.top_variants || [];
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: rows.map(v => truncLabel(`${v.product_name} · ${v.color_name}`)),
      datasets: [{ label: 'Unidades', data: rows.map(v => parseInt(v.units)),
                   backgroundColor: '#00B3E9', borderRadius: 4 }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x} unidades` } },
      },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function initChartPairs(canvas, data) {
  const rows = data.top_pairs || [];
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: rows.map(p => truncLabel(`${p.product_a} + ${p.product_b}`)),
      datasets: [{ label: 'Veces juntos', data: rows.map(p => parseInt(p.count)),
                   backgroundColor: '#00B3E9', borderRadius: 4 }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x} veces juntos` } },
      },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}
```

- [ ] **Step 3: Verificar en browser**

Abrir `http://localhost:3000/admin` → Dashboard. Verificar:

1. **Evolución temporal**: Si hay pedidos confirmados, aparece un gráfico de líneas doble con ejes izquierdo (pedidos) y derecho (ingresos). Si no hay, aparece "Sin pedidos confirmados en este período".
2. **Por tipo de cliente / entrega**: Aparecen dos donuts. Al hacer click en "Tabla" se ven las cards de datos.
3. **Todas las demás secciones**: Aparecen gráficos de barras horizontales por defecto. Al hacer click en "Tabla" se muestra la tabla existente.
4. **Cambio de período**: Al hacer click en "7 días", los charts se destruyen y recrean correctamente sin error.
5. **Consola**: Sin errores de JavaScript.
6. **Tooltips**: Al hacer hover sobre barras, aparece el tooltip con el valor correcto.

- [ ] **Step 4: Commit**

```bash
git add public/js/admin.js
git commit -m "feat: add chart tabs, Chart.js chart init functions and timeline section"
```

---

## Self-Review

**Cobertura del spec:**
- ✅ Chart.js 4.x via CDN `https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js` → Task 3
- ✅ Carga lazy del script CDN → Task 3 `loadChartJs()`
- ✅ Tabs Gráfico/Tabla en cada sección → Task 4 `tabCard()` helper en `buildDashHTML()`
- ✅ Tab default activo: "Gráfico" → `class="dash-tab active"` en tabCard
- ✅ Charts destruidos antes de cada recarga → Task 3 `destroyDashCharts()` en `loadDashboard()`
- ✅ Lazy init por sección (tab click) → Task 4 `setupTabDelegation()`
- ✅ `orders_over_time` + `time_granularity` en backend → Task 1
- ✅ Evolución temporal: línea doble, eje dual → Task 4 `initChartTimeline()`
- ✅ Sección y entrega: donuts → Task 4 `initChartSection()`, `initChartDelivery()`
- ✅ Clientes, localidades, top-products, low-products, variants, pairs: barras horiz → Task 4
- ✅ Color primario `#00B3E9`, alerta `#f59e0b`, neutro donut `#555` → Task 4
- ✅ Truncado de labels a 22 caracteres → Task 4 `truncLabel()`
- ✅ CSS tabs: `.dash-card-header`, `.dash-tabs`, `.dash-tab`, `.dash-tab-pane.hidden` → Task 2
- ✅ `.dash-dist-mini` para tabla de donuts → Task 2

**Consistencia de nombres:**
- `dashCharts` declarado en Task 3, usado en Task 4 ✅
- `initDashChart(id, data)` declarado y usado internamente en Task 4 ✅
- `setupTabDelegation(body, data)` — llamado en `loadDashboard()` en Task 3, definido en Task 4. Funciona porque JS es función-hoisted (function declarations) ✅
- `initVisibleCharts(data)` — ídem ✅
- `truncLabel` declarado como `const` en Task 4, scope de módulo ✅
- IDs de canvas: `chart-timeline`, `chart-section`, `chart-delivery`, `chart-clients`, `chart-localidades`, `chart-top-products`, `chart-low-products`, `chart-variants`, `chart-pairs` — consistentes entre `buildDashHTML` y `initDashChart` switch ✅

**Sin placeholders:** Todo el código está completo. ✅
