# Diseño: Gestión de Pedidos en Panel de Administración

**Fecha:** 2026-06-29  
**Estado:** Aprobado

---

## Resumen

Agregar un módulo de gestión de pedidos al panel de administración de PC3. Los pedidos se crean automáticamente cuando un cliente envía su carrito por WhatsApp, y también pueden crearse manualmente por el administrador. El admin confirma o cancela cada pedido. El stock solo se descuenta al confirmar.

---

## Base de datos

### Tabla `orders`

```sql
CREATE TABLE orders (
  id           SERIAL PRIMARY KEY,
  status       TEXT        NOT NULL DEFAULT 'pending',   -- 'pending' | 'confirmed' | 'cancelled'
  section      TEXT        NOT NULL DEFAULT '',           -- 'profesional' | 'mayorista'
  client_name  TEXT        NOT NULL DEFAULT '',
  client_phone TEXT        NOT NULL DEFAULT '',
  delivery     TEXT        NOT NULL DEFAULT 'retiro',     -- 'retiro' | 'andreani'
  address      TEXT        NOT NULL DEFAULT '',
  comprobante  TEXT        NOT NULL DEFAULT '',
  notes        TEXT        NOT NULL DEFAULT '',
  total        INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);
```

### Tabla `order_items`

```sql
CREATE TABLE order_items (
  id           SERIAL PRIMARY KEY,
  order_id     INTEGER     NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   INTEGER     REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT        NOT NULL DEFAULT '',
  color_name   TEXT        NOT NULL DEFAULT '',
  quantity     INTEGER     NOT NULL DEFAULT 1,
  unit_price   INTEGER     NOT NULL DEFAULT 0,
  subtotal     INTEGER     NOT NULL DEFAULT 0
);
```

**Notas:**
- `product_name` y `unit_price` se guardan como snapshot para preservar el historial si el producto cambia de precio o es eliminado.
- `product_id` es nullable (SET NULL) para el mismo motivo.
- El campo `total` en `orders` es la suma de todos los subtotales de sus ítems.

---

## API

### Endpoint público (sin autenticación)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/orders` | Crea pedido desde el carrito del cliente. Se llama antes de abrir WhatsApp. Si falla, no bloquea al cliente. |

**Body de `POST /api/orders`:**
```json
{
  "section": "mayorista",
  "client_name": "Juan Pérez",
  "client_phone": "3492123456",
  "delivery": "andreani",
  "address": "Calle 123, Rafaela",
  "comprobante": "Consumidor Final A",
  "notes": "",
  "items": [
    {
      "product_id": 5,
      "product_name": "Mochila Urban",
      "color_name": "Negro",
      "quantity": 2,
      "unit_price": 15000
    }
  ]
}
```

### Endpoints de admin (requieren `requireAdmin`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/admin/orders` | Lista pedidos con filtros opcionales |
| `GET` | `/api/admin/orders/:id` | Detalle completo con ítems |
| `POST` | `/api/admin/orders` | Crear pedido manualmente (mismo body que público) |
| `PUT` | `/api/admin/orders/:id` | Editar datos de cabecera (cliente, entrega, notas, section) |
| `PUT` | `/api/admin/orders/:id/items` | Reemplazar ítems completos del pedido |
| `POST` | `/api/admin/orders/:id/confirm` | Confirmar pedido → descuenta stock → setea `confirmed_at` |
| `POST` | `/api/admin/orders/:id/cancel` | Cancelar pedido → setea `confirmed_at` |

**Query params de `GET /api/admin/orders`:**
- `status` — `pending` | `confirmed` | `cancelled`
- `section` — `profesional` | `mayorista`
- `search` — busca en `client_name` y `client_phone` (ILIKE)
- `from` — fecha desde (ISO 8601)
- `to` — fecha hasta (ISO 8601)

**Lógica de `confirm`:**
1. Verifica que el pedido esté en `pending`.
2. Por cada ítem, descuenta `quantity` del stock del producto (y de la variante si aplica).
3. Si algún producto no tiene stock suficiente, devuelve error 400 con detalle por producto. El admin puede decidir editar el pedido o confirmarlo igual (override manual si se implementa en el futuro).
4. Si hay stock suficiente, actualiza `status = 'confirmed'` y `confirmed_at = NOW()`.

---

## UI — Panel de administración

### Sidebar
- Nueva entrada **"Pedidos"** con ícono 🛒 en la sección "Catálogo", entre "Productos" y "Paleta de colores".

### Vista principal — Lista de pedidos

- Barra de filtros:
  - Input de búsqueda (nombre / teléfono)
  - Select de estado (Todos / Pendientes / Confirmados / Cancelados)
  - Select de sección (Todos / Profesional / Mayorista)
  - Inputs de fecha desde / hasta
  - Botón "Limpiar filtros"
- Botón **"+ Nuevo pedido"** (crea manualmente)
- Tabla de pedidos:
  - Columnas: `#`, Cliente, Sección, Total, Estado (badge), Fecha, Acciones
  - Los pedidos pendientes aparecen primero y con fondo levemente resaltado
  - Badge de estado: amarillo (pendiente), verde (confirmado), rojo (cancelado)
  - Acción: botón "Ver / Editar" que abre el panel lateral

### Panel lateral de detalle/edición

Sigue el patrón del `edit-panel` existente (slide-in desde la derecha).

**Secciones del panel:**
1. **Datos del cliente** — nombre, teléfono, sección, tipo de comprobante, entrega, dirección, notas. Todos editables si el pedido está en `pending`.
2. **Ítems del pedido** — tabla con: selector de producto (dropdown del catálogo), color (texto libre), cantidad, precio unitario, subtotal. Botón para agregar fila, botón para quitar cada fila. Total recalculado en tiempo real.
3. **Footer del panel:**
   - Pedidos `pending`: botones "Confirmar" (verde) y "Cancelar" (rojo) + "Guardar cambios" (azul)
   - Pedidos `confirmed` o `cancelled`: solo lectura, muestra fecha de confirmación/cancelación

### Cambio en `checkout.js` (flujo del cliente)

En `sendWhatsApp()`, antes de hacer `window.open(url, '_blank')`, se agrega una llamada `fetch('POST /api/orders', ...)` con los datos del pedido. La llamada es fire-and-forget: si falla, el flujo continúa normalmente y WhatsApp se abre igual.

---

## Reglas de negocio

1. **Stock se descuenta únicamente al confirmar** — nunca al crear ni al editar un pedido.
2. **Si no hay stock suficiente al confirmar** — la API devuelve error con detalle. El admin ve un mensaje claro y puede editar el pedido antes de reintentar.
3. **Pedidos confirmados o cancelados son inmutables** — no se pueden editar ni cambiar de estado.
4. **El número de pedido es el `id` SERIAL** — simple, correlativo, sin prefijos.
5. **Creación desde el cliente es best-effort** — si `POST /api/orders` falla (red, servidor), el cliente no se entera y el pedido no queda registrado. El admin puede crearlo manualmente.

---

## Archivos a modificar / crear

| Archivo | Acción |
|---------|--------|
| `database.js` | Agregar tablas `orders` y `order_items` en `init()` + migration |
| `routes/api.js` | Agregar endpoints de pedidos (público y admin) |
| `views/admin.html` | Agregar entrada "Pedidos" en el sidebar |
| `public/js/admin.js` | Agregar `renderOrdersPage()`, lógica de filtros, panel de detalle/edición |
| `public/js/checkout.js` | Agregar llamada `POST /api/orders` antes de abrir WhatsApp |
