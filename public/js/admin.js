// ─── Image URL helper (supports Cloudinary URLs and local paths) ─
function productImgSrc(slug, filename) {
  if (!filename) return '';
  if (filename.startsWith('http')) return filename;
  return `/productos/${slug}/${filename}`;
}

// ─── Admin SPA ────────────────────────────────────────────────
const admin = {
  products: [],
  colors: [],
  currentPage: 'products',
  editProductId: null,
};

const api = async (path, opts = {}) => {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
    body: opts.body && !(opts.body instanceof FormData)
      ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body))
      : opts.body
  });
  if (res.status === 401) { window.location = '/admin/login'; throw new Error('No autorizado'); }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `Error ${res.status}` }));
    throw new Error(err.error || 'Error desconocido');
  }
  return res.status === 204 ? null : res.json();
};

const fmtPrice = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n);

function toast(msg, type = 'success') {
  const c = document.getElementById('admin-toasts');
  if (!c) return;
  // Fade out and remove any existing toast before showing the new one
  c.querySelectorAll('.toast').forEach(existing => {
    existing.style.transition = 'opacity 0.15s ease';
    existing.style.opacity = '0';
    setTimeout(() => existing.remove(), 150);
  });
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  t.style.opacity = '0';
  t.style.transition = 'opacity 0.2s ease';
  c.appendChild(t);
  // Slight delay so the fade-in feels intentional
  requestAnimationFrame(() => requestAnimationFrame(() => { t.style.opacity = '1'; }));
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 200);
  }, 3000);
}

// ─── Navigation ───────────────────────────────────────────────
function navigate(page) {
  admin.currentPage = page;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page));

  const titles = { products: 'Productos', orders: 'Pedidos', colors: 'Paleta de colores', settings: 'Configuración', password: 'Cambiar Contraseña' };
  document.getElementById('page-title').textContent = titles[page] || page;

  if (page === 'products') renderProductsPage();
  else if (page === 'orders') renderOrdersPage();
  else if (page === 'colors') renderColorsPage();
  else if (page === 'settings') renderSettingsPage();
  else if (page === 'password') renderPasswordPage();
}

// ─── Products Page ────────────────────────────────────────────
async function renderProductsPage() {
  const content = document.getElementById('admin-content');
  content.innerHTML = `<div class="loader-wrap"><div class="loader-dots"><span></span><span></span><span></span></div><span>Cargando productos...</span></div>`;

  try {
    admin.products = await api('/admin/products');
  } catch (e) {
    content.innerHTML = `<p style="color:var(--color-danger)">${e.message}</p>`;
    return;
  }

  content.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px">
      <h3 style="font-size:16px">Todos los productos (${admin.products.length})</h3>
      <button class="btn btn-primary btn-sm" id="btn-new-product">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nuevo producto
      </button>
    </div>

    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th>Imagen</th>
            <th>Nombre / Slug</th>
            <th>Precio Mayo</th>
            <th>Precio MaPro</th>
            <th>Precio Público</th>
            <th>Stock</th>
            <th>Activo</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody id="products-tbody">
          ${admin.products.map(p => buildProductRow(p)).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('btn-new-product')?.addEventListener('click', () => openEditPanel(null));

  attachTableEvents();
}

function buildProductRow(p) {
  const firstImg = p.images && p.images[0];
  const imgSrc = firstImg ? productImgSrc(p.slug, firstImg.filename) : '';
  const hasVariants = p.images && p.images.length > 0;
  const variantStockTotal = hasVariants
    ? p.images.reduce((sum, img) => sum + (img.stock || 0), 0)
    : null;
  const variantStockTooltip = hasVariants
    ? p.images.map(img => `${img.color_name || img.filename}: ${img.stock || 0}`).join('\n')
    : '';
  return `
  <tr data-id="${p.id}">
    <td>
      ${imgSrc ? `<img class="table-product-img" src="${imgSrc}" alt="${p.name}">` : '<div style="width:48px;height:48px;background:var(--color-surface2);border-radius:6px"></div>'}
    </td>
    <td>
      <div style="font-weight:700;font-size:14px">${p.name}</div>
      <div style="font-size:11px;color:var(--color-text-faint)">${p.slug}</div>
    </td>
    <td>${fmtPrice(p.price_pro)}</td>
    <td>${fmtPrice(p.price_mayo)}</td>
    <td>${fmtPrice(p.price_public)}</td>
    <td>
      <div style="display:flex;align-items:center;gap:8px">
        ${hasVariants
          ? `<span title="${variantStockTooltip}" style="font-size:13px;cursor:default">
               ${variantStockTotal} un
               <span style="font-size:10px;color:var(--color-text-muted);display:block">${p.images.length} colores</span>
             </span>`
          : `<input type="number" class="inline-stock-input" data-id="${p.id}" value="${p.stock}" min="0">`
        }
        <button class="btn btn-secondary btn-sm stock-btn" data-id="${p.id}" title="Gestionar stock" style="flex-shrink:0">📦</button>
      </div>
    </td>
    <td>
      <label class="active-toggle" title="${p.active ? 'Activo' : 'Inactivo'}">
        <input type="checkbox" class="active-toggle-input" data-id="${p.id}" ${p.active ? 'checked' : ''}>
        <span class="toggle-track"></span>
      </label>
    </td>
    <td>
      <div style="display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm edit-btn" data-id="${p.id}" title="Editar">✏</button>
        <button class="btn btn-danger btn-sm delete-btn" data-id="${p.id}" title="Desactivar">🗑</button>
      </div>
    </td>
  </tr>`;
}

function attachTableEvents() {
  // Edit
  document.querySelectorAll('.edit-btn').forEach(btn =>
    btn.addEventListener('click', () => openEditPanel(parseInt(btn.dataset.id))));

  // Stock modal
  document.querySelectorAll('.stock-btn').forEach(btn =>
    btn.addEventListener('click', () => openStockModal(parseInt(btn.dataset.id))));

  // Delete (hard — permanent)
  document.querySelectorAll('.delete-btn').forEach(btn =>
    btn.addEventListener('click', async () => {
      const row = btn.closest('tr');
      const name = row?.querySelector('td:nth-child(2) div')?.textContent || 'este producto';
      if (!confirm(`⚠️ Eliminar permanentemente "${name}"?\n\nEsta acción es irreversible: se borrarán el producto, sus imágenes y todos sus datos.`)) return;
      try {
        await api(`/admin/products/${btn.dataset.id}?hard=1`, { method: 'DELETE' });
        toast('Producto eliminado permanentemente');
        renderProductsPage();
      } catch (e) { toast(e.message, 'error'); }
    }));

  // Inline stock save
  document.querySelectorAll('.inline-stock-input').forEach(input => {
    input.addEventListener('change', async () => {
      try {
        await api(`/admin/products/${input.dataset.id}`, {
          method: 'PUT',
          body: { stock: parseInt(input.value) }
        });
        toast('Stock actualizado');
      } catch (e) { toast(e.message, 'error'); }
    });
  });

  // Active toggle
  document.querySelectorAll('.active-toggle-input').forEach(cb => {
    cb.addEventListener('change', async () => {
      try {
        await api(`/admin/products/${cb.dataset.id}`, {
          method: 'PUT',
          body: { active: cb.checked }
        });
        toast(cb.checked ? 'Producto activado' : 'Producto desactivado');
      } catch (e) { toast(e.message, 'error'); }
    });
  });
}

// ─── Edit Panel ───────────────────────────────────────────────
async function openEditPanel(productId) {
  admin.editProductId = productId;
  const panel = document.getElementById('edit-panel');
  const panelBody = document.getElementById('edit-panel-body');
  const panelTitle = document.getElementById('edit-panel-title');

  let product = null;
  if (productId) {
    product = admin.products.find(p => p.id === productId);
    panelTitle.textContent = 'Editar Producto';
  } else {
    panelTitle.textContent = 'Nuevo Producto';
  }

  panelBody.innerHTML = buildEditForm(product);

  panel.classList.add('open');
  document.getElementById('panel-overlay')?.classList.add('visible');

  setupEditFormEvents(product);
}

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
    <div style="width:52px;height:52px;border-radius:6px;overflow:hidden;flex-shrink:0">
      <img src="${productImgSrc(p.slug, img.filename)}" alt="${img.filename}"
        style="width:100%;height:100%;object-fit:cover;display:block">
    </div>
    <span style="flex:1;font-size:13px;color:var(--color-text-muted)">Foto de contexto</span>
    <button class="img-thumb-del" data-img-id="${img.id}" data-product-id="${p.id}"
      style="flex-shrink:0;opacity:1;position:static;background:#ef4444;color:#fff;border:none;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:16px;font-weight:700;display:flex;align-items:center;justify-content:center;line-height:1">
      ✕
    </button>
  </div>`;
}

function buildOrderList(p) {
  const images = p.images || [];
  if (!images.length) return '<p style="font-size:13px;color:var(--color-text-muted)">Aún no hay imágenes.</p>';
  const escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return images.map((img) => `
    <div class="order-row" data-img-id="${img.id}" draggable="true"
      style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--color-surface2);border-radius:6px;cursor:default;user-select:none">
      <span class="drag-handle" style="cursor:grab;color:var(--color-text-muted);font-size:18px;line-height:1;flex-shrink:0">⠿</span>
      <img src="${productImgSrc(p.slug, img.filename)}" alt=""
        style="width:36px;height:36px;object-fit:cover;border-radius:4px;flex-shrink:0">
      <span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${img.image_type === 'context'
          ? '📷 Foto de contexto'
          : `🎨 Variante${img.color_name ? ' — ' + escHtml(img.color_name) : ''}`}
      </span>
      <button type="button" class="btn btn-ghost btn-sm order-up-btn" data-img-id="${img.id}" style="padding:3px 7px">↑</button>
      <button type="button" class="btn btn-ghost btn-sm order-down-btn" data-img-id="${img.id}" style="padding:3px 7px">↓</button>
    </div>`).join('');
}

function buildEditForm(p) {
  return `
    <!-- Basic info -->
    <div class="section-divider">Información básica</div>

    <div class="form-group">
      <label class="form-label">Nombre del producto *</label>
      <input type="text" class="form-control" id="ef-name" value="${p?.name || ''}" placeholder="Ej: Cinta Cohesiva 5 CM">
    </div>

    <div class="form-group">
      <label class="form-label">Slug (URL) *</label>
      <input type="text" class="form-control" id="ef-slug" value="${p?.slug || ''}" placeholder="cinta-cohesiva-5-cm" ${p ? 'disabled' : ''}>
      ${p ? '<div class="text-xs text-muted mt-1">El slug no se puede cambiar una vez creado.</div>' : ''}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group">
        <label class="form-label">Contenido del pack</label>
        <input type="text" class="form-control" id="ef-contents" value="${p?.contents || ''}" placeholder="Caja x24 rollos · 5cm × 4.5m">
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Descripción</label>
      <textarea class="form-control" id="ef-description" rows="3" placeholder="Descripción del producto...">${p?.description || ''}</textarea>
    </div>

    <!-- Pricing -->
    <div class="section-divider">Precios</div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px">
      <div class="form-group">
        <label class="form-label">Precio Mayorista</label>
        <input type="number" class="form-control" id="ef-price-pro" value="${p?.price_pro || ''}" placeholder="3500" min="0">
      </div>
      <div class="form-group">
        <label class="form-label">Precio MaPro</label>
        <input type="number" class="form-control" id="ef-price-mayo" value="${p?.price_mayo || ''}" placeholder="1450" min="0">
      </div>
      <div class="form-group">
        <label class="form-label">Precio Público</label>
        <input type="number" class="form-control" id="ef-price-public" value="${p?.price_public || ''}" placeholder="5000" min="0">
      </div>
      <div class="form-group">
        <label class="form-label">Stock disponible
          ${p && p.images && p.images.some(img => img.image_type !== 'context')
            ? '<span style="font-size:11px;color:var(--color-text-muted)"> (por color)</span>'
            : ''}
        </label>
        ${p && p.images && p.images.some(img => img.image_type !== 'context')
          ? `<button type="button" class="btn btn-secondary btn-sm" id="btn-manage-stock" style="margin-top:2px">
               📦 Gestionar stock por color
             </button>`
          : `<input type="number" class="form-control" id="ef-stock" value="${p?.stock ?? ''}" placeholder="100" min="0">`
        }
      </div>
    </div>

    <div class="form-group" style="display:flex;align-items:center;gap:10px">
      <label class="active-toggle">
        <input type="checkbox" id="ef-active" ${p == null || p.active ? 'checked' : ''}>
        <span class="toggle-track"></span>
      </label>
      <span class="text-sm">Producto activo (visible en el catálogo)</span>
    </div>

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

    <div id="ef-error" class="form-error" style="display:none;margin-top:10px"></div>
  `;
}

function buildTiersTable(tiers, section, productId) {
  if (!tiers.length) return `<p class="text-sm text-muted mb-1">Sin tramos de descuento.</p>`;
  return `
    <table class="tier-table">
      <thead><tr><th>Mínimo (un)</th><th>Descuento %</th><th></th></tr></thead>
      <tbody>
        ${tiers.map(t => `
          <tr data-tier-id="${t.id}">
            <td><input type="number" class="tier-input tier-min" value="${t.min_quantity}" min="1" data-id="${t.id}"></td>
            <td><input type="number" class="tier-input tier-pct" value="${t.percentage}" min="0.1" max="99" step="0.1" data-id="${t.id}"></td>
            <td>
              <button class="btn btn-danger btn-sm del-tier-btn" data-id="${t.id}" style="padding:3px 7px">✕</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function setupEditFormEvents(product) {
  // Save — use onclick (not addEventListener) so re-opening the panel replaces
  // the handler instead of stacking a new one on top of the previous one.
  const saveBtn = document.getElementById('save-product-btn');
  if (saveBtn) saveBtn.onclick = () => saveProduct(product);

  // Stock modal trigger from edit panel
  const manageStockBtn = document.getElementById('btn-manage-stock');
  if (manageStockBtn) manageStockBtn.onclick = () => {
    if (product) openStockModal(product.id);
  };

  if (product) {
    // ── Delete (variantes y contexto) ───────────────────────────
    const panelBodyEl = document.getElementById('edit-panel-body');
    if (panelBodyEl && !panelBodyEl.dataset.delInit) {
      panelBodyEl.dataset.delInit = '1';
      panelBodyEl.addEventListener('click', async (e) => {
      if (!e.target.classList.contains('img-thumb-del')) return;
      if (!confirm('¿Eliminar esta imagen? Se borrará permanentemente.')) return;
      const imgId     = e.target.dataset.imgId;
      const productId = e.target.dataset.productId;
      try {
        await api(`/admin/products/${productId}/images/${imgId}`, { method: 'DELETE' });
        // Remove the clicked row
        e.target.closest('.img-color-row, .img-context-row')?.remove();
        // Also remove corresponding row in variant-list / context-list (if deleted from order section)
        document.querySelector(`#variant-list [data-img-id="${imgId}"], #context-list [data-img-id="${imgId}"]`)?.remove();
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
    }

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

async function addTier(productId, section) {
  const min = prompt(`Cantidad mínima para el descuento (${section}):`);
  if (!min || isNaN(parseInt(min))) return;
  const pct = prompt(`Porcentaje de descuento (ej: 20 para 20%):`);
  if (!pct || isNaN(parseFloat(pct))) return;

  try {
    await api(`/admin/products/${productId}/tiers`, {
      method: 'POST',
      body: { section, min_quantity: parseInt(min), percentage: parseFloat(pct) }
    });
    toast('Tramo agregado');
    // Refresh panel
    const product = await api(`/admin/products`).then(ps => ps.find(p => p.id === productId));
    if (product) {
      admin.products = admin.products.map(p => p.id === productId ? product : p);
      openEditPanel(productId);
    }
  } catch (e) { toast(e.message, 'error'); }
}

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
  if (list.dataset.ddInit) return; // already wired
  list.dataset.ddInit = '1';
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

async function saveProduct(existingProduct) {
  const name = document.getElementById('ef-name')?.value.trim();
  const slug = document.getElementById('ef-slug')?.value.trim();
  const contents = document.getElementById('ef-contents')?.value.trim();
  const description = document.getElementById('ef-description')?.value.trim();
  const price_pro = document.getElementById('ef-price-pro')?.value;
  const price_mayo = document.getElementById('ef-price-mayo')?.value;
  const price_public = document.getElementById('ef-price-public')?.value;
  const stock = document.getElementById('ef-stock')?.value;
  const active = document.getElementById('ef-active')?.checked;

  const errorEl = document.getElementById('ef-error');
  if (!name) { showEfError(errorEl, 'El nombre es requerido'); return; }
  if (!existingProduct && !slug) { showEfError(errorEl, 'El slug es requerido'); return; }

  const body = { name, contents, description, price_pro, price_mayo, price_public, stock, active };

  const btn = document.getElementById('save-product-btn');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<div class="loader-dots" style="--color-accent:#000"><span></span><span></span><span></span></div>`;
  }

  try {
    if (existingProduct) {
      await api(`/admin/products/${existingProduct.id}`, { method: 'PUT', body });
      toast('Producto actualizado');
    } else {
      await api('/admin/products', { method: 'POST', body: { ...body, slug } });
      toast('Producto creado');
    }
    closeEditPanel();
    renderProductsPage();
  } catch (e) {
    showEfError(errorEl, e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
  }
}

function showEfError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

function closeEditPanel() {
  document.getElementById('edit-panel')?.classList.remove('open');
  document.getElementById('panel-overlay')?.classList.remove('visible');
  admin.editProductId = null;
}

// ─── Stock Modal ──────────────────────────────────────────────
function openStockModal(productId) {
  const product = admin.products.find(p => p.id === productId);
  if (!product) return;

  const modal   = document.getElementById('stock-modal');
  const overlay = document.getElementById('stock-modal-overlay');
  const title   = document.getElementById('stock-modal-title');
  const body    = document.getElementById('stock-modal-body');

  title.textContent = `Stock — ${product.name}`;

  const variantImages = (product.images || []).filter(img => img.image_type !== 'context');
  const hasVariants   = variantImages.length > 0;

  if (hasVariants) {
    body.innerHTML = variantImages.map(img => `
      <div class="stock-modal-row" data-img-id="${img.id}">
        <img src="${productImgSrc(product.slug, img.filename)}" alt="${img.color_name || img.filename}" loading="lazy">
        <span class="stock-modal-color-name">${img.color_name || img.filename}</span>
        <div class="stock-modal-stock-wrap">
          <label>Stock</label>
          <input type="number" class="form-control stock-modal-input"
            data-img-id="${img.id}"
            data-product-id="${product.id}"
            value="${img.stock || 0}" min="0"
            style="width:90px">
        </div>
      </div>
    `).join('');
  } else {
    body.innerHTML = `
      <div class="form-group">
        <label class="form-label">Stock disponible</label>
        <input type="number" class="form-control" id="stock-modal-single"
          value="${product.stock || 0}" min="0" style="max-width:160px">
      </div>
    `;
  }

  overlay.classList.add('visible');
  modal.classList.add('open');

  document.getElementById('save-stock-modal').onclick = async () => {
    try {
      if (hasVariants) {
        for (const input of body.querySelectorAll('.stock-modal-input')) {
          const imgId = parseInt(input.dataset.imgId);
          const prodId = input.dataset.productId;
          const stock = parseInt(input.value) || 0;
          const img = product.images.find(i => i.id === imgId);
          await api(`/admin/products/${prodId}/images/${imgId}`, {
            method: 'PUT',
            body: { color_name: img?.color_name || '', stock }
          });
          if (img) img.stock = stock;
        }
      } else {
        const stock = parseInt(document.getElementById('stock-modal-single').value) || 0;
        await api(`/admin/products/${product.id}`, { method: 'PUT', body: { stock } });
        product.stock = stock;
      }
      toast('Stock actualizado');
      closeStockModal();
      // Refresh table row without full reload
      const tr = document.querySelector(`#products-tbody tr[data-id="${productId}"]`);
      if (tr) tr.outerHTML = buildProductRow(product);
      attachTableEvents();
      // If edit panel is open for this product, refresh it
      if (admin.editProductId === productId) openEditPanel(productId);
    } catch (e) { toast(e.message, 'error'); }
  };
}

function closeStockModal() {
  document.getElementById('stock-modal')?.classList.remove('open');
  document.getElementById('stock-modal-overlay')?.classList.remove('visible');
}

// ─── Settings Page ────────────────────────────────────────────
async function renderSettingsPage() {
  const content = document.getElementById('admin-content');
  content.innerHTML = `<div class="loader-wrap"><div class="loader-dots"><span></span><span></span><span></span></div><span>Cargando configuración...</span></div>`;
  let settings = {};
  try { settings = await api('/admin/settings'); } catch (e) { /* */ }

  content.innerHTML = `
    <div class="settings-card">
      <h3>Configuración general</h3>

      <div class="form-group">
        <label class="form-label">Compra mínima — Lista Profesional ($)</label>
        <input type="number" class="form-control" id="s-min-pro" value="${settings.min_purchase_pro || 550000}" min="0">
      </div>
      <div class="form-group">
        <label class="form-label">Compra mínima — Lista Mayorista ($)</label>
        <input type="number" class="form-control" id="s-min-mayo" value="${settings.min_purchase_mayo || 950000}" min="0">
      </div>
      <div class="form-group">
        <label class="form-label">Número de WhatsApp (código país + número sin +)</label>
        <input type="text" class="form-control" id="s-wa" value="${settings.whatsapp_number || ''}" placeholder="5493492310744">
      </div>

      <button class="btn btn-primary" id="save-settings-btn">Guardar configuración</button>
    </div>
  `;

  document.getElementById('save-settings-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<div class="loader-dots" style="--color-accent:#000"><span></span><span></span><span></span></div>`;
    const updates = [
      { key: 'min_purchase_pro', value: document.getElementById('s-min-pro').value },
      { key: 'min_purchase_mayo', value: document.getElementById('s-min-mayo').value },
      { key: 'whatsapp_number', value: document.getElementById('s-wa').value.trim() },
    ];
    try {
      await Promise.all(updates.map(u => api('/admin/settings', { method: 'PUT', body: u })));
      toast('Configuración guardada');
    } catch (e) { toast(e.message, 'error'); }
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  });
}

// ─── Password Page ────────────────────────────────────────────
function renderPasswordPage() {
  const content = document.getElementById('admin-content');
  content.innerHTML = `
    <div class="settings-card">
      <h3>Cambiar contraseña</h3>
      <div class="form-group">
        <label class="form-label">Contraseña actual</label>
        <input type="password" class="form-control" id="pw-current" autocomplete="current-password">
      </div>
      <div class="form-group">
        <label class="form-label">Nueva contraseña</label>
        <input type="password" class="form-control" id="pw-new" autocomplete="new-password">
      </div>
      <div class="form-group">
        <label class="form-label">Confirmar nueva contraseña</label>
        <input type="password" class="form-control" id="pw-confirm" autocomplete="new-password">
      </div>
      <div id="pw-error" class="form-error" style="display:none;margin-bottom:12px"></div>
      <button class="btn btn-primary" id="save-pw-btn">Cambiar contraseña</button>
    </div>
  `;

  document.getElementById('save-pw-btn')?.addEventListener('click', async (e) => {
    const cur = document.getElementById('pw-current').value;
    const nw = document.getElementById('pw-new').value;
    const conf = document.getElementById('pw-confirm').value;
    const errEl = document.getElementById('pw-error');

    if (!cur || !nw) { errEl.textContent = 'Completá todos los campos'; errEl.style.display = 'block'; return; }
    if (nw !== conf) { errEl.textContent = 'Las contraseñas no coinciden'; errEl.style.display = 'block'; return; }
    if (nw.length < 6) { errEl.textContent = 'La contraseña debe tener al menos 6 caracteres'; errEl.style.display = 'block'; return; }

    const btn = e.currentTarget;
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<div class="loader-dots" style="--color-accent:#000"><span></span><span></span><span></span></div>`;

    try {
      await api('/admin/change-password', {
        method: 'POST',
        body: { current_password: cur, new_password: nw }
      });
      errEl.style.display = 'none';
      toast('Contraseña actualizada correctamente');
      document.getElementById('pw-current').value = '';
      document.getElementById('pw-new').value = '';
      document.getElementById('pw-confirm').value = '';
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    }
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  });
}

// ─── Colors Page ──────────────────────────────────────────────
async function renderColorsPage() {
  const content = document.getElementById('admin-content');
  content.innerHTML = `<div class="loader-wrap"><div class="loader-dots"><span></span><span></span><span></span></div><span>Cargando colores...</span></div>`;

  try {
    admin.colors = await api('/admin/colors');
  } catch (e) {
    content.innerHTML = `<p style="color:var(--color-danger)">${e.message}</p>`;
    return;
  }

  function colorRow(c) {
    return `
      <div class="color-lib-row" data-color-id="${c.id}" style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--color-surface2);border-radius:8px">
        <label style="position:relative;width:36px;height:36px;flex-shrink:0;display:inline-block;cursor:pointer;border-radius:50%;overflow:hidden" title="Click para cambiar color">
          <input type="color" class="color-lib-picker" data-color-id="${c.id}" value="${c.hex}"
            style="position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;border:0;padding:0">
          <div class="color-lib-preview" style="position:absolute;inset:0;background:${c.hex};border:1.5px solid rgba(255,255,255,0.2);box-shadow:0 1px 4px rgba(0,0,0,0.3);pointer-events:none"></div>
        </label>
        <input type="text" class="form-control color-lib-hex" data-color-id="${c.id}" value="${c.hex}" maxlength="7" placeholder="#rrggbb" style="width:90px;font-size:13px;font-family:monospace;padding:5px 8px">
        <input type="text" class="form-control color-lib-name" data-color-id="${c.id}" value="${c.name}" placeholder="Nombre del color" style="flex:1;font-size:13px;padding:5px 8px">
        <button class="btn btn-danger btn-sm del-color-btn" data-color-id="${c.id}" style="flex-shrink:0">✕</button>
      </div>
    `;
  }

  function colorsGrid() {
    return admin.colors.map(colorRow).join('');
  }

  content.innerHTML = `
    <div style="max-width:560px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;gap:10px">
        <p style="font-size:13px;color:var(--color-text-muted);margin:0">Estos colores están disponibles como accesos rápidos al editar variantes de productos.</p>
        <button class="btn btn-primary btn-sm" id="btn-add-color" style="white-space:nowrap">+ Agregar color</button>
      </div>
      <div id="color-lib-list" style="display:flex;flex-direction:column;gap:8px">
        ${colorsGrid()}
      </div>
    </div>
  `;

  const list = document.getElementById('color-lib-list');

  // Picker change → sync hex field + preview
  list.addEventListener('change', async (e) => {
    const isPicker = e.target.classList.contains('color-lib-picker');
    const isHex    = e.target.classList.contains('color-lib-hex');
    const isName   = e.target.classList.contains('color-lib-name');
    if (!isPicker && !isHex && !isName) return;

    const id  = e.target.dataset.colorId;
    const row = e.target.closest('.color-lib-row');

    if (isPicker) {
      const hex = e.target.value;
      row.querySelector('.color-lib-hex').value     = hex;
      row.querySelector('.color-lib-preview').style.background = hex;
    }
    if (isHex) {
      const val = e.target.value.trim();
      if (/^#[0-9a-f]{6}$/i.test(val)) {
        row.querySelector('.color-lib-picker').value = val;
        row.querySelector('.color-lib-preview').style.background = val;
      }
    }

    const name = row.querySelector('.color-lib-name').value.trim();
    const hex  = row.querySelector('.color-lib-hex').value.trim();
    if (!name || !/^#[0-9a-f]{6}$/i.test(hex)) return;

    try {
      const updated = await api(`/admin/colors/${id}`, { method: 'PUT', body: { name, hex } });
      const idx = admin.colors.findIndex(c => c.id === updated.id);
      if (idx >= 0) admin.colors[idx] = updated;
      toast('Color actualizado');
    } catch (err) { toast(err.message, 'error'); }
  });

  // Delete color
  list.addEventListener('click', async (e) => {
    if (!e.target.classList.contains('del-color-btn')) return;
    if (!confirm('¿Eliminar este color de la paleta?')) return;
    const id = e.target.dataset.colorId;
    try {
      await api(`/admin/colors/${id}`, { method: 'DELETE' });
      admin.colors = admin.colors.filter(c => String(c.id) !== String(id));
      e.target.closest('.color-lib-row').remove();
      toast('Color eliminado');
    } catch (err) { toast(err.message, 'error'); }
  });

  // Add color
  document.getElementById('btn-add-color')?.addEventListener('click', async () => {
    const name = prompt('Nombre del color (ej: Verde lima):');
    if (!name) return;
    const hex = prompt('Código hexadecimal (ej: #84CC16):', '#cccccc');
    if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) { alert('Código hex inválido. Usá el formato #RRGGBB'); return; }
    try {
      const newColor = await api('/admin/colors', { method: 'POST', body: { name: name.trim(), hex: hex.trim() } });
      admin.colors.push(newColor);
      const row = document.createElement('div');
      row.innerHTML = colorRow(newColor);
      list.appendChild(row.firstElementChild);
      toast('Color agregado');
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ─── Init ─────────────────────────────────────────────────────
// ─── Image Eyedropper ────────────────────────────────────────
let _eyedropCallback = null;

function injectEyedropperModal() {
  const modal = document.createElement('div');
  modal.id = 'eyedrop-modal';
  modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.78);align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = `
    <div style="background:#181824;border-radius:14px;padding:20px;width:100%;max-width:400px;box-shadow:0 24px 64px rgba(0,0,0,0.6)">
      <div style="font-size:12px;color:#888;margin-bottom:12px;text-align:center;letter-spacing:0.04em">Mové el cursor sobre la imagen y hacé click para capturar el color</div>
      <div style="position:relative;cursor:crosshair;line-height:0;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.08)">
        <canvas id="eyedrop-canvas" style="display:block;width:100%;height:auto"></canvas>
        <div id="eyedrop-loupe" style="position:absolute;pointer-events:none;opacity:0;width:36px;height:36px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.5),0 2px 12px rgba(0,0,0,0.4);transform:translate(-50%,-50%);top:0;left:0"></div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:12px">
        <div id="eyedrop-preview" style="width:30px;height:30px;border-radius:50%;border:2px solid rgba(255,255,255,0.2);flex-shrink:0;background:#cccccc;transition:background 0.08s"></div>
        <code id="eyedrop-hex" style="font-size:14px;color:#e0e0e0;font-family:monospace;letter-spacing:0.04em">#cccccc</code>
        <button id="eyedrop-cancel" type="button" style="margin-left:auto;padding:7px 16px;border:none;border-radius:8px;background:rgba(255,255,255,0.08);color:#ccc;cursor:pointer;font-size:13px">Cancelar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('eyedrop-cancel').addEventListener('click', () => {
    modal.style.display = 'none';
    _eyedropCallback = null;
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) { modal.style.display = 'none'; _eyedropCallback = null; }
  });
}

function openEyedropper(imgSrc, onSelect) {
  _eyedropCallback = onSelect;
  const modal   = document.getElementById('eyedrop-modal');
  const canvas  = document.getElementById('eyedrop-canvas');
  const ctx     = canvas.getContext('2d');
  const loupe   = document.getElementById('eyedrop-loupe');
  const preview = document.getElementById('eyedrop-preview');
  const hexLbl  = document.getElementById('eyedrop-hex');

  function pickPixel(e) {
    try {
      const rect   = canvas.getBoundingClientRect();
      const scaleX = canvas.width  / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = Math.max(0, Math.min(Math.floor((e.clientX - rect.left) * scaleX), canvas.width  - 1));
      const y = Math.max(0, Math.min(Math.floor((e.clientY - rect.top)  * scaleY), canvas.height - 1));
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
      return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      return null; // Canvas tainted (CORS); fall back gracefully
    }
  }

  canvas.onmousemove = (e) => {
    const hex = pickPixel(e);
    if (!hex) return;
    loupe.style.left    = `${e.offsetX}px`;
    loupe.style.top     = `${e.offsetY}px`;
    loupe.style.opacity = '1';
    loupe.style.background = hex;
    preview.style.background = hex;
    hexLbl.textContent = hex;
  };
  canvas.onmouseleave = () => { loupe.style.opacity = '0'; };
  canvas.onclick = (e) => {
    const hex = pickPixel(e);
    if (!hex) { toast('No se pudo leer el color. Usá el campo de texto para ingresar el hex.', 'error'); return; }
    modal.style.display = 'none';
    if (_eyedropCallback) { _eyedropCallback(hex); _eyedropCallback = null; }
  };

  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    const maxW  = 360;
    const scale = Math.min(1, maxW / image.naturalWidth);
    canvas.width  = Math.round(image.naturalWidth  * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    modal.style.display = 'flex';
  };
  image.onerror = () => { toast('No se pudo cargar la imagen para el cuentagotas', 'error'); _eyedropCallback = null; };
  // Append a cache-buster so the browser fetches with CORS headers even if
  // the same URL was previously cached without them (e.g. from an <img> tag).
  image.src = imgSrc + (imgSrc.includes('?') ? '&' : '?') + '_ec=' + Date.now();
}

document.addEventListener('DOMContentLoaded', () => {
  injectEyedropperModal();

  // Nav items
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigate(item.dataset.page));
  });

  // Close panel
  document.getElementById('close-edit-panel')?.addEventListener('click', closeEditPanel);
  document.getElementById('panel-overlay')?.addEventListener('click', closeEditPanel);

  // Logout
  document.getElementById('logout-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (confirm('¿Cerrar sesión?')) e.target.submit();
  });

  // Load global color palette
  api('/admin/colors').then(colors => { admin.colors = colors || []; }).catch(() => {});

  // Start on products page
  navigate('products');
});
