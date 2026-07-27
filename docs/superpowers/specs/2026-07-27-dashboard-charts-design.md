# Dashboard Charts — Diseño

**Fecha:** 2026-07-27
**Proyecto:** PC3 Admin — Dashboard de Métricas

---

## Resumen

Agregar gráficos interactivos al dashboard existente usando Chart.js vía CDN. Cada sección tendrá tabs "Gráfico / Tabla" para alternar entre visualización y datos crudos. Se agrega una nueva sección de evolución temporal arriba de todo.

---

## Decisiones de diseño

- **Librería:** Chart.js 4.x cargada vía CDN (`https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js`)
- **Carga:** Lazy — el `<script>` se inyecta en el DOM la primera vez que el usuario navega al Dashboard, no en el load inicial de la app
- **Tabs:** Sistema `.dash-tab-group` reutilizable. Cada sección con gráfico tiene botones "Gráfico" y "Tabla". La vista activa por defecto es "Gráfico".
- **Init de charts:** Lazy por sección — el chart se crea la primera vez que el tab "Gráfico" se activa (o al cargar si "Gráfico" es el tab inicial). Se destruye y recrea al cambiar el período de tiempo (nueva llamada a `loadDashboard()`).
- **Colores:** Usar la paleta del design system. El color primario `#00B3E9` (var `--color-accent`) para barras y líneas. Donuts con 2 colores: accent + un tono neutro.
- **Tema:** Los charts deben adaptarse al tema oscuro del admin. Chart.js recibe colores de texto y grilla desde las variables CSS del documento.

---

## Nueva query en el backend

### Campo adicional: `orders_over_time`

Se agrega al endpoint `GET /api/admin/dashboard` un nuevo campo en el JSON de respuesta.

**Lógica de agrupación:**
- Si el período es ≤ 60 días (o `from` y `to` están presentes y su diferencia ≤ 60 días) → agrupar por **día** (`DATE(created_at)`)
- Si el período es > 60 días o no hay fechas (`all`) → agrupar por **mes** (`TO_CHAR(created_at, 'YYYY-MM')`)

**Query (agrupación por día):**
```sql
SELECT DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') AS date,
       COUNT(*) AS orders,
       COALESCE(SUM(total), 0) AS revenue
FROM orders
WHERE status = 'confirmed'
  AND ($1::timestamptz IS NULL OR created_at >= $1)
  AND ($2::timestamptz IS NULL OR created_at < $2)
GROUP BY DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')
ORDER BY date ASC
```

**Query (agrupación por mes):**
```sql
SELECT TO_CHAR(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM') AS date,
       COUNT(*) AS orders,
       COALESCE(SUM(total), 0) AS revenue
FROM orders
WHERE status = 'confirmed'
  AND ($1::timestamptz IS NULL OR created_at >= $1)
  AND ($2::timestamptz IS NULL OR created_at < $2)
GROUP BY TO_CHAR(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM')
ORDER BY date ASC
```

**Respuesta:**
```json
{
  "orders_over_time": [
    { "date": "2026-07-01", "orders": 5, "revenue": 25000 },
    { "date": "2026-07-02", "orders": 3, "revenue": 14500 }
  ],
  "time_granularity": "day"
}
```

---

## Secciones del dashboard y sus gráficos

### 1. Evolución temporal *(nueva sección, primera del dashboard)*

- **Tipo:** Línea doble (`type: 'line'`)
- **Datos:** `orders_over_time`
- **Eje X:** fechas (día o mes según granularidad)
- **Eje Y izquierdo:** cantidad de pedidos (línea color accent `#00B3E9`)
- **Eje Y derecho:** ingresos en $ (línea color `#22c55e`, verde)
- **Tab default:** Gráfico (no hay tabla — es la única sección sin tab Tabla)
- **Sin datos:** texto "Sin pedidos confirmados en este período"

### 2. Distribución por sección (Pro vs Mayorista)

- **Tipo:** Donut (`type: 'doughnut'`)
- **Datos:** `by_section` — pedidos por sección
- **Colores:** `['#00B3E9', '#555']`
- **Tab default:** Gráfico. Tab Tabla muestra las cards actuales (Profesional / Mayorista con pedidos y revenue)

### 3. Distribución por entrega (Retiro vs Envío)

- **Tipo:** Donut (`type: 'doughnut'`)
- **Datos:** `by_delivery` — pedidos por tipo de entrega
- **Colores:** `['#00B3E9', '#555']`
- **Tab default:** Gráfico. Tab Tabla muestra las cards actuales (Retiro / Envío con % del total)

> Las secciones 2 y 3 se muestran **lado a lado** en una fila de 2 columnas (`.dash-tables-grid`)

### 4. Clientes más frecuentes

- **Tipo:** Barras horizontales (`type: 'bar'`, `indexAxis: 'y'`)
- **Datos:** `top_clients` — eje Y: nombre del cliente, eje X: cantidad de pedidos
- **Color:** `#00B3E9`
- **Tab default:** Gráfico

### 5. Por localidad

- **Tipo:** Barras horizontales (`type: 'bar'`, `indexAxis: 'y'`)
- **Datos:** `top_localidades` — eje Y: localidad, eje X: cantidad de pedidos
- **Color:** `#00B3E9`
- **Tab default:** Gráfico

### 6. Productos más vendidos

- **Tipo:** Barras horizontales (`type: 'bar'`, `indexAxis: 'y'`)
- **Datos:** `top_products` — eje Y: nombre del producto, eje X: unidades vendidas
- **Color:** `#00B3E9`
- **Tab default:** Gráfico

### 7. Productos menos vendidos

- **Tipo:** Barras horizontales (`type: 'bar'`, `indexAxis: 'y'`)
- **Datos:** `low_products` — eje Y: nombre del producto, eje X: unidades vendidas
- **Color:** `#f59e0b` (amarillo — señal de alerta de stock bajo)
- **Tab default:** Gráfico

### 8. Variantes más pedidas

- **Tipo:** Barras horizontales (`type: 'bar'`, `indexAxis: 'y'`)
- **Datos:** `top_variants` — eje Y: "Producto · Color", eje X: unidades
- **Color:** `#00B3E9`
- **Tab default:** Gráfico

### 9. Pares más frecuentes

- **Tipo:** Barras horizontales (`type: 'bar'`, `indexAxis: 'y'`)
- **Datos:** `top_pairs` — eje Y: "Producto A + Producto B", eje X: veces juntos
- **Color:** `#00B3E9`
- **Tab default:** Gráfico

---

## Sistema de tabs

Cada sección con tabs renderiza este HTML:

```html
<div class="dash-table-card">
  <div class="dash-card-header">
    <h4 class="dash-table-title">Título de la sección</h4>
    <div class="dash-tabs">
      <button class="dash-tab active" data-tab="chart">Gráfico</button>
      <button class="dash-tab" data-tab="table">Tabla</button>
    </div>
  </div>
  <div class="dash-tab-pane" data-pane="chart">
    <canvas id="chart-NOMBRE"></canvas>
  </div>
  <div class="dash-tab-pane hidden" data-pane="table">
    <!-- tabla existente -->
  </div>
</div>
```

La lógica de tabs es un único event listener delegado en el `#dash-body`. Al cambiar a "Gráfico", si el chart no fue inicializado aún (`Chart.getChart(canvas) === undefined`), se llama a la función `initChart_NOMBRE(data)` correspondiente.

---

## Chart.js — configuración global

```javascript
Chart.defaults.color = getComputedStyle(document.documentElement)
  .getPropertyValue('--color-text-muted').trim() || '#888';
Chart.defaults.borderColor = getComputedStyle(document.documentElement)
  .getPropertyValue('--color-border').trim() || '#2a2a2a';
```

Esto se llama una vez cuando Chart.js se carga, antes de renderizar cualquier gráfico.

---

## Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `routes/api.js` | Agregar query `orders_over_time` al endpoint `/admin/dashboard` |
| `views/admin.html` | Agregar lazy-load del script de Chart.js |
| `public/js/admin.js` | Reemplazar `buildDashHTML()` con versión que incluye tabs y charts; agregar funciones `initChart_*`; lazy-load de Chart.js |
| `public/css/admin.css` | Agregar estilos para `.dash-tabs`, `.dash-tab`, `.dash-tab-pane`, `.dash-card-header` |

---

## Notas de implementación

- Los `<canvas>` de Chart.js necesitan un contenedor con altura definida. Usar `style="position:relative;height:240px"` en el wrapper del canvas.
- Al llamar `loadDashboard()` (cuando cambia el filtro de fechas), todos los charts anteriores deben ser destruidos antes de que el DOM sea reemplazado. Usar `Chart.getChart(canvasEl)?.destroy()` o mantener referencias en un objeto `dashCharts = {}`.
- La destrucción se maneja llamando `destroyDashCharts()` al inicio de `loadDashboard()`.
- Las etiquetas largas en barras horizontales se truncan a 20 caracteres con `...` para no romper el layout.
- Tooltips de Chart.js muestran el valor completo (sin truncar).
- El CDN de Chart.js se carga solo una vez: si `window.Chart` ya existe, no se vuelve a inyectar.
