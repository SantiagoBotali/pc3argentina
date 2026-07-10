# Diseño: Variantes por botón + Fotos de contexto + Reordenamiento

**Fecha:** 2026-07-10  
**Estado:** Aprobado

---

## Resumen

Modificar el sistema de imágenes de productos para:
1. Agregar variantes mediante un botón (fila vacía primero, luego subir foto)
2. Soportar fotos de contexto (imágenes sin color/stock, solo galería)
3. Permitir reordenar todas las imágenes con drag & drop + botones ↑↓

---

## Base de datos

### Migración
Una sola columna nueva en `product_images`:

```sql
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS image_type TEXT NOT NULL DEFAULT 'variant';
```

- Valor `'variant'`: imagen con color_name, color_hex, stock (comportamiento actual)
- Valor `'context'`: imagen decorativa sin campos de color ni stock
- Todos los registros existentes quedan como `'variant'` automáticamente

### Schema resultante de `product_images`
```
id          SERIAL PRIMARY KEY
product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE
filename    TEXT NOT NULL
color_name  TEXT NOT NULL DEFAULT ''
color_hex   TEXT NOT NULL DEFAULT ''
stock       INTEGER NOT NULL DEFAULT 0
sort_order  INTEGER NOT NULL DEFAULT 0
image_type  TEXT NOT NULL DEFAULT 'variant'
```

---

## API (`routes/api.js`)

### Cambios mínimos

**POST `/api/admin/products/:id/images`**
- Recibe campo adicional `image_type` en el body del form multipart (`'variant'` o `'context'`, default `'variant'`)
- Inserta con ese valor en la columna `image_type`

**GET `/api/products`** y **GET `/api/admin/products`**
- Sin cambios. El `SELECT *` ya devuelve `image_type` una vez que existe la columna.

**PUT `/api/admin/products/:id/images/reorder`**
- Sin cambios. Ya maneja `sort_order` global para todos los registros del producto.

**PUT `/api/admin/products/:id/images/:imgId`**
- Sin cambios. Actualiza `color_name`, `color_hex`, `stock`. Las fotos de contexto simplemente no envían esos campos.

**DELETE `/api/admin/products/:id/images/:imgId`**
- Sin cambios.

---

## Panel Admin (`public/js/admin.js`)

### Reemplazo de la sección "Imágenes y colores"

La sección actual (upload zone + lista de variantes) se reemplaza por tres sub-secciones:

#### Sub-sección 1: Variantes

Lista de filas con `image_type === 'variant'`. Cada fila:
- Miniatura clickeable para reemplazar foto (igual que hoy)
- Campos: nombre de color, hex (con eyedropper + swatches de librería), stock
- Botón ✕ para eliminar

**Botón "＋ Nueva variante"** al pie:
- Inserta una fila vacía en el DOM (sin registro en DB todavía)
- La fila muestra un placeholder de foto con botón "Subir foto"
- Al seleccionar la foto, se sube al servidor (`POST /images` con `image_type=variant`)
- El registro en DB se crea en ese momento; la fila se actualiza con el id real
- Si el usuario cierra el panel sin subir foto, la fila pendiente se descarta (solo existía en el DOM)

#### Sub-sección 2: Fotos de contexto

Lista de filas con `image_type === 'context'`. Cada fila:
- Miniatura
- Botón ✕ para eliminar (misma lógica que variantes)

**Botón "＋ Agregar foto de contexto"**:
- Abre file picker directamente (sin fila vacía previa, no hay campos que llenar)
- Al seleccionar, sube con `image_type=context`
- La fila aparece en la lista al completarse la subida

#### Sub-sección 3: Orden de visualización

Lista unificada de **todas** las imágenes del producto (variantes + contexto), ordenadas por `sort_order`.

Cada ítem muestra:
- Handle de drag & drop (⠿) a la izquierda
- Miniatura pequeña
- Etiqueta: `🎨 Variante — [color_name]` o `📷 Foto de contexto`
- Botones ↑ ↓ a la derecha

Al reordenar (drag o flechas):
- Se actualiza visualmente el DOM inmediatamente
- Se llama `PUT /api/admin/products/:id/images/reorder` con el nuevo array `[{id, sort_order}]`

Las tres sub-secciones se mantienen en sincronía: reordenar en la sección 3 no mueve ítems entre las secciones 1 y 2 (solo cambia el sort_order), pero la sección 3 siempre refleja el orden real de DB.

---

## Frontend / Catálogo (`public/js/catalog.js`, `public/js/products.js`)

### Swatches de color (lista de productos)
- Solo imágenes con `image_type === 'variant'` generan swatches
- El contador "N colores" cuenta solo variantes
- Las fotos de contexto se ignoran para swatches

### Preview modal (detalle)
- Gallery/slider muestra **todas** las imágenes ordenadas por `sort_order`, sin filtrar por tipo
- El usuario ve variantes y fotos de contexto mezcladas según configuró el admin
- Navegación con flechas y dots sin cambios

### Stock en gallery
- Cuando el slide activo es `image_type === 'variant'`: stock efectivo = stock de esa variante
- Cuando el slide activo es `image_type === 'context'`: stock efectivo = stock general del producto

### Carrito
- Solo imágenes `variant` son opciones seleccionables de color al agregar al carrito
- `selectedVariantIdx` continúa siendo el índice dentro del subset de variantes (no del array total de imágenes)

---

## Flujo de datos end-to-end

```
Admin crea variante:
  Click "Nueva variante" → fila vacía en DOM
  Selecciona foto → POST /api/admin/products/:id/images (image_type=variant)
  DB crea registro → fila actualiza con id real
  Sección "Orden" se refresca para incluir el nuevo ítem

Admin agrega foto de contexto:
  Click "Agregar foto de contexto" → file picker
  Selecciona foto → POST /api/admin/products/:id/images (image_type=context)
  DB crea registro → fila aparece en lista
  Sección "Orden" se refresca

Admin reordena:
  Drag o flechas en sección "Orden"
  PUT /api/admin/products/:id/images/reorder → actualiza sort_order en DB

Catálogo carga:
  GET /api/products → images[] ordenadas por sort_order, con image_type
  Swatches: filter(img => img.image_type === 'variant')
  Gallery slides: todas las imágenes
```

---

## Consideraciones

- **Compatibilidad:** Sin breaking changes. El campo `image_type` tiene default `'variant'`, por lo que todos los datos existentes funcionan igual.
- **Upload zona existente:** Se elimina la zona de drag & drop genérica (upload-zone). Se reemplaza por los dos botones diferenciados.
- **Reorder endpoint:** Ya existe y funciona. No requiere cambios.
- **Sin migración de datos:** Los registros existentes mantienen su comportamiento como variantes.
