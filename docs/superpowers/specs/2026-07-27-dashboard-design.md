# Dashboard de Métricas — Diseño

**Fecha:** 2026-07-27  
**Proyecto:** PC3 Admin — Generador de Catálogos Profesionales

---

## Resumen

Agregar una nueva página "Dashboard" al panel de administración de PC3 que muestre métricas clave sobre pedidos y productos, con filtrado por período de tiempo.

---

## Decisiones de diseño

- **UI:** Cards + Tablas (sin librerías de charts externas). Consistente con el estilo admin existente.
- **Arquitectura:** Un solo endpoint `GET /api/admin/dashboard?from=&to=` que devuelve todas las métricas en un JSON.
- **Filtros:** Botones rápidos + rango personalizado de fechas.
- **Datos base:** Solo pedidos con `status = 'confirmed'` para las métricas de ingresos/ventas. Para conteos de estado se usan todos los pedidos.

---

## Integración en el admin existente

- Agregar botón "Dashboard" en la sidebar de `views/admin.html`, como primer ítem del nav (antes de Productos).
- Nueva función `renderDashboard()` en el JS del admin que fetcha y renderiza el contenido.
- La lógica del endpoint va en `routes/api.js` bajo `/api/admin/dashboard` con `requireAdmin`.

---

## Endpoint

### `GET /api/admin/dashboard`

**Query params:**
- `from` — fecha ISO inicio (opcional, default: sin límite)
- `to` — fecha ISO fin (opcional, default: sin límite)

**Respuesta JSON:**
```json
{
  "kpis": {
    "total_orders": 120,
    "confirmed_orders": 95,
    "pending_orders": 18,
    "cancelled_orders": 7,
    "confirmed_revenue": 480000,
    "avg_ticket": 5052
  },
  "by_section": [
    { "section": "profesional", "orders": 60, "revenue": 250000 },
    { "section": "mayorista",   "orders": 35, "revenue": 230000 }
  ],
  "by_delivery": [
    { "delivery": "retiro",  "orders": 70 },
    { "delivery": "envio",   "orders": 25 }
  ],
  "top_clients": [
    { "client_name": "Juan López", "client_phone": "...", "orders": 5, "total": 45000, "section": "mayorista" }
  ],
  "top_localidades": [
    { "client_localidad": "Buenos Aires", "orders": 12, "total": 80000 }
  ],
  "top_products": [
    { "product_name": "Campera Rompeviento", "units": 45, "revenue": 180000, "pct": 22.5 }
  ],
  "low_products": [
    { "product_id": 3, "product_name": "Remera Lisa", "units": 2, "stock": 30 }
  ],
  "top_variants": [
    { "product_name": "Campera Rompeviento", "color_name": "Azul marino", "units": 18 }
  ],
  "top_pairs": [
    { "product_a": "Campera Rompeviento", "product_b": "Pantalón Cargo", "count": 12 }
  ]
}
```

---

## Consultas SQL clave

### KPIs
```sql
SELECT
  COUNT(*) AS total_orders,
  COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed_orders,
  COUNT(*) FILTER (WHERE status = 'pending')   AS pending_orders,
  COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_orders,
  COALESCE(SUM(total) FILTER (WHERE status = 'confirmed'), 0) AS confirmed_revenue
FROM orders
WHERE ($1::timestamptz IS NULL OR created_at >= $1)
  AND ($2::timestamptz IS NULL OR created_at <= $2);
```

### Por sección y entrega
```sql
SELECT section, COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue
FROM orders
WHERE status = 'confirmed'
  AND ($1::timestamptz IS NULL OR created_at >= $1)
  AND ($2::timestamptz IS NULL OR created_at <= $2)
GROUP BY section;
```

### Top productos (más vendidos)
```sql
SELECT oi.product_name, SUM(oi.quantity) AS units, SUM(oi.subtotal) AS revenue
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE o.status = 'confirmed'
  AND ($1::timestamptz IS NULL OR o.created_at >= $1)
  AND ($2::timestamptz IS NULL OR o.created_at <= $2)
GROUP BY oi.product_name
ORDER BY units DESC
LIMIT 10;
```

### Variantes más pedidas (producto + color)
```sql
SELECT oi.product_name, oi.color_name, SUM(oi.quantity) AS units
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE o.status = 'confirmed'
  AND oi.color_name != ''
  AND ($1::timestamptz IS NULL OR o.created_at >= $1)
  AND ($2::timestamptz IS NULL OR o.created_at <= $2)
GROUP BY oi.product_name, oi.color_name
ORDER BY units DESC
LIMIT 10;
```

### Pares de productos pedidos juntos
```sql
SELECT a.product_name AS product_a, b.product_name AS product_b, COUNT(*) AS count
FROM order_items a
JOIN order_items b ON a.order_id = b.order_id AND a.product_name < b.product_name
JOIN orders o ON o.id = a.order_id
WHERE o.status = 'confirmed'
  AND ($1::timestamptz IS NULL OR o.created_at >= $1)
  AND ($2::timestamptz IS NULL OR o.created_at <= $2)
GROUP BY a.product_name, b.product_name
ORDER BY count DESC
LIMIT 10;
```

### Productos menos vendidos (activos con menor venta)
```sql
SELECT p.id AS product_id, p.name AS product_name, p.stock,
       COALESCE(SUM(oi.quantity), 0) AS units
FROM products p
LEFT JOIN order_items oi ON oi.product_id = p.id
LEFT JOIN orders o ON o.id = oi.order_id
  AND o.status = 'confirmed'
  AND ($1::timestamptz IS NULL OR o.created_at >= $1)
  AND ($2::timestamptz IS NULL OR o.created_at <= $2)
WHERE p.active = 1
GROUP BY p.id, p.name, p.stock
ORDER BY units ASC
LIMIT 5;
```

---

## Layout del Dashboard (UI)

```
┌─ Filtros de período ─────────────────────────────────────────────┐
│  [Hoy] [7 días] [30 días] [Este mes] [Todo]  Desde: [] Hasta: [] │
└──────────────────────────────────────────────────────────────────┘

┌─ KPIs ─┬──────────┬──────────┬──────────┬──────────┬────────────┐
│ Total  │ Ingres.  │ Ticket   │Pendiente │Confirm.  │ Cancelados │
│pedidos │confirm.  │ promedio │          │          │            │
└────────┴──────────┴──────────┴──────────┴──────────┴────────────┘

┌─ Por tipo de cliente ──────────────────────────────────────────┐
│  [Profesional: N pedidos / $X]  [Mayorista: N pedidos / $X]   │
│  [Retiro: N (X%)]               [Envío: N (X%)]               │
└────────────────────────────────────────────────────────────────┘

┌─ Clientes más frecuentes ──┐  ┌─ Por localidad ──────────────┐
│ Tabla top 10               │  │ Tabla top 10                 │
└────────────────────────────┘  └──────────────────────────────┘

┌─ Productos más vendidos ───┐  ┌─ Productos menos vendidos ───┐
│ Tabla top 10               │  │ Tabla top 5                  │
└────────────────────────────┘  └──────────────────────────────┘

┌─ Variantes más pedidas ────┐  ┌─ Pares más frecuentes ───────┐
│ Tabla top 10               │  │ Tabla top 10                 │
└────────────────────────────┘  └──────────────────────────────┘
```

---

## Archivos a modificar / crear

| Archivo | Cambio |
|---------|--------|
| `routes/api.js` | Agregar `GET /api/admin/dashboard` con toda la lógica de queries |
| `views/admin.html` | Agregar botón Dashboard en sidebar + función `renderDashboard()` en el JS inline |
| `public/css/admin.css` | Agregar estilos para las cards KPI y tablas del dashboard (si no alcanzan los existentes) |

---

## Notas de implementación

- El filtro `to` debe incluir hasta el final del día seleccionado. En el endpoint, convertir el parámetro `to` a `to_date::date + interval '1 day'` antes de usarlo en el WHERE (`created_at < $2`), o bien el frontend envía la fecha siguiente. Se elige la opción backend: el endpoint recibe `to=2026-07-27` y aplica `< '2026-07-28'::date`.
- Las queries de pares pueden ser costosas con muchos pedidos. Para el volumen actual (cientos/miles de pedidos) es aceptable.
- El `product_name` en `order_items` es texto, no FK. Esto es intencional (preserva el nombre histórico aunque el producto se edite). Las queries de ranking usan ese campo.
- `low_products` usa `active = 1` (entero) consistente con el esquema PostgreSQL heredado de SQLite.
