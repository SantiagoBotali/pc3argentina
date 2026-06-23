# Diseño: Colores por ítem de carrito, facturación, entrega y mejoras de UX

**Fecha:** 2026-06-23  
**Estado:** Aprobado

---

## Resumen

Cinco mejoras relacionadas al flujo de compra del catálogo PC3:

1. Variantes de color distinguidas como ítems separados en el carrito
2. Stock por color gestionable desde el admin
3. Tipo de comprobante en el checkout
4. Tipos de entrega: Retiro en sucursal / Andreani
5. Edición manual de cantidad en el sidebar del carrito

---

## 1. Base de datos

### Cambio en `product_images`

Agregar dos columnas nuevas:

```sql
ALTER TABLE product_images ADD COLUMN color_name TEXT NOT NULL DEFAULT '';
ALTER TABLE product_images ADD COLUMN stock INTEGER NOT NULL DEFAULT 0;
```

- `color_name`: nombre del color visible para el cliente (ej: "Rojo", "Azul"). Editable desde el admin.
- `stock`: unidades disponibles de ese color específico.

El campo `stock` en la tabla `products` se mantiene como fallback para productos sin imágenes cargadas. Cuando un producto tiene al menos una imagen, el stock se gestiona por color y el campo `stock` del producto se oculta en el admin.

Las columnas se agregan mediante una migración ejecutada al inicio del servidor (en `database.js`, dentro de `init()`), usando `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` o verificando previamente con `PRAGMA table_info`.

---

## 2. API

### `GET /api/products`

Sin cambio en la firma. La respuesta de cada imagen ahora incluye `color_name` y `stock`:

```json
{
  "images": [
    { "id": 1, "filename": "var1.png", "sort_order": 0, "color_name": "Rojo", "stock": 12 },
    { "id": 2, "filename": "var2.png", "sort_order": 1, "color_name": "Azul", "stock": 5 }
  ]
}
```

### `PUT /admin/products/:id/images/:imgId` *(nuevo endpoint)*

Acepta body JSON con:
```json
{ "color_name": "Rojo", "stock": 12 }
```

Actualiza la fila de `product_images` correspondiente. Requiere autenticación de admin.

### `POST /api/validate-stock`

El body de cada ítem cambia de:
```json
{ "product_id": 5, "quantity": 3 }
```
a:
```json
{ "product_id": 5, "variant_idx": 2, "quantity": 3 }
```

La validación busca `product_images` por `product_id` y `sort_order = variant_idx`. Si la imagen tiene `stock > 0` (o `stock` definido), valida contra ese stock. Si el producto no tiene imágenes, valida contra `products.stock` (fallback).

---

## 3. Carrito con colores distintos (`cart.js`, `products.js`)

### Clave del carrito

**Antes:** `state.carts[section][productId]`  
**Después:** `state.carts[section]["${productId}_${variantIdx}"]`

Permite tener el mismo producto en distintos colores como ítems independientes.

### Forma del ítem

```js
{
  productId: 5,
  variantIdx: 2,       // índice del color (sort_order de la imagen)
  colorName: "Rojo",   // nombre del color, copiado al agregar
  quantity: 3,
  stockIssue: false
}
```

### Funciones afectadas

- `addToCart(productId, quantity, section, variantIdx, silent)` — usa clave compuesta, copia `colorName` desde `product.images[variantIdx].color_name`
- `removeFromCart(key, section)` — recibe la clave compuesta
- `updateCartQty(key, quantity, section)` — recibe la clave compuesta
- `buildCartItemHTML(item, section)` — muestra nombre del producto + nombre del color, usa input numérico editable

### Sidebar del carrito — cantidad editable

En `buildCartItemHTML`, la cantidad pasa de `<span>` a `<input type="number">`:

```html
<input type="number" class="cart-item-qty-input" value="3" min="1" data-key="5_2" data-section="profesional">
```

Al `blur` o `Enter`, aplica `updateCartQty`. Los botones +/− siguen presentes y actualizan el input.

### Visualización en el carrito

Cada fila muestra:
- Imagen del color seleccionado
- Nombre del producto + " — " + nombre del color (ej: "Cinta Cohesiva 5cm — Rojo")
- Precio unitario con descuento si aplica
- Input de cantidad editable + botones +/−
- Subtotal
- Botón eliminar

---

## 4. Checkout (`checkout.js`)

### Tipo de comprobante

Campo obligatorio, radio buttons, posicionado antes de "Tus datos":

```
Tipo de comprobante *
○ Consumidor Final A
○ Monotributo A
○ Responsable Inscripto B
○ IVA Exento
```

Validación: si no se selecciona ninguno, se muestra error y no se envía el pedido.

### Tipos de entrega

| ID | Label | Ícono | Campo adicional |
|---|---|---|---|
| `retiro` | Retiro en sucursal | 🏪 | Ninguno |
| `andreani` | Andreani | 📦 | Dirección de envío |

Se elimina la opción `envio` (envío a domicilio genérico) y se reemplaza por `andreani`.

El campo de dirección se muestra/oculta según la selección (igual que el comportamiento actual).

### Mensaje de WhatsApp

Líneas actualizadas:

```
• Cinta Cohesiva 5cm (Rojo) × 3 un = $XXX
  ✅ Precio con 10% OFF (x5+ unidades)
• Cinta Cohesiva 5cm (Azul) × 1 un = $XXX

🧾 Comprobante: Consumidor Final A
👤 Nombre: Juan Pérez
📱 Teléfono: 3492 123456
📦 Envío Andreani a: Av. Siempre Viva 123, Rafaela
```

Para retiro en sucursal:
```
🏪 Retiro en sucursal
```

---

## 5. Panel de administración (`admin.js`, `admin.html`)

### Editor de imágenes/colores

En el modal de edición de producto, la sección de imágenes muestra una tabla con una fila por imagen:

```
[thumbnail] | Nombre del color: [________] | Stock: [____] | [↑] [↓] | [🗑]
```

- `color_name`: input text, autosave al blur via `PUT /api/admin/products/:id/images/:imgId`
- `stock`: input number (min 0), autosave al blur via el mismo endpoint
- Si el producto tiene al menos una imagen, el campo `stock` del producto principal se muestra como deshabilitado con el texto "Gestionado por color"

### Comportamiento de autosave

Al perder el foco en cualquier campo de color o stock de imagen, se dispara un `PATCH`/`PUT` silencioso. En caso de error se muestra un toast de error.

---

## 6. Archivos afectados

| Archivo | Cambios |
|---|---|
| `database.js` | Migración: ALTER TABLE product_images ADD COLUMN color_name, stock |
| `routes/api.js` | Nuevo endpoint PUT /admin/products/:id/images/:imgId; actualizar validate-stock; devolver color_name/stock en GET /api/products |
| `public/js/cart.js` | Clave compuesta, input editable de qty, buildCartItemHTML actualizado |
| `public/js/products.js` | addToCart con colorName, syncCart con clave compuesta |
| `public/js/checkout.js` | Campo comprobante, opción Andreani, mensaje WhatsApp actualizado |
| `public/js/admin.js` | Editor de color_name y stock por imagen |
| `views/admin.html` | (si hay HTML estático en el template del editor de productos) |

---

## 7. Consideraciones de migración

- Las imágenes existentes quedan con `color_name = ''` y `stock = 0`. El admin puede completarlos sin urgencia.
- El carrito guardado en `localStorage` con el formato viejo (`productId` como clave) será incompatible. Se limpia silenciosamente al detectar el formato antiguo (verificar si la clave contiene `_`).
- No hay cambios en la estructura de rutas ni en la autenticación.
