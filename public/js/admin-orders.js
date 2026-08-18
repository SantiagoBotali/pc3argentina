// ─── Admin Orders ─────────────────────────────────────────────

const ordersState = {
  orders: [],
  filters: { status: '', section: '', search: '', from: '', to: '' },
};

const STATUS_LABEL = { pending: 'Pendiente', confirmed: 'Confirmado', cancelled: 'Cancelado' };
const STATUS_BADGE  = { pending: 'badge-warning', confirmed: 'badge-success', cancelled: 'badge-danger' };
const SECTION_LABEL = { profesional: 'Mayorista', mayorista: 'Mayorista Pro' };

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
          <option value="profesional" ${f.section==='profesional'?'selected':''}>Mayorista</option>
          <option value="mayorista"   ${f.section==='mayorista'  ?'selected':''}>Mayorista Pro</option>
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
    const confirmCells = isPending
      ? `<td style="white-space:nowrap">
           <button class="btn btn-sm" style="background:#16a34a;color:#fff;margin-right:4px" onclick="confirmOrderInline(${o.id}, this)">✓ Confirmar</button>
           <button class="btn btn-sm" style="background:var(--color-danger);color:#fff" onclick="cancelOrderInline(${o.id}, this)">✕ Cancelar</button>
         </td>`
      : `<td></td>`;
    return `
      <tr class="${isPending ? 'order-row-pending' : ''}">
        <td style="font-weight:700">#${o.id}</td>
        <td>
          ${escapeHtml(o.client_name)}
          ${o.client_club ? `<br><small style="color:var(--color-text-muted)">${escapeHtml(o.client_club)}</small>` : ''}
          <br><small style="color:var(--color-text-muted)">${escapeHtml(o.client_phone)}${o.client_email ? ' · ' + escapeHtml(o.client_email) : ''}</small>
        </td>
        <td>${sectionLabel}</td>
        <td>${o.reseller_name ? `<span class="badge">${escapeHtml(o.reseller_name)}</span>` : '<span class="text-muted">—</span>'}</td>
        <td style="font-weight:600">${fmtPrice(o.total)}</td>
        <td><span class="badge ${badgeClass}">${statusLabel}</span></td>
        <td>${date}</td>
        ${confirmCells}
        <td><button class="btn btn-ghost btn-sm" onclick="openOrderPanel(${o.id})">Ver / Editar</button></td>
      </tr>
    `;
  }).join('');

  wrap.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table" style="width:100%">
        <thead>
          <tr>
            <th>#</th><th>Cliente</th><th>Lista</th><th>Revendedor</th><th>Total</th><th>Estado</th><th>Fecha</th><th>Confirmación</th><th>Acciones</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

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
    section:          order?.section          || 'mayorista',
    client_name:      order?.client_name      || '',
    client_club:      order?.client_club      || '',
    client_dni:       order?.client_dni       || '',
    client_cuit:      order?.client_cuit      || '',
    client_phone:     order?.client_phone     || '',
    client_email:     order?.client_email     || '',
    address:          order?.address          || '',
    client_localidad: order?.client_localidad || '',
    delivery:         order?.delivery         || 'local',
    comprobante:      order?.comprobante      || 'Consumidor Final',
    notes:            order?.notes            || '',
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

  const comprobanteOptions = ['Consumidor Final','Monotributo A','Responsable Inscripto A','IVA Exento']
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
            <option value="mayorista"   ${v.section==='mayorista'   ?'selected':''}>Mayorista Pro</option>
            <option value="profesional" ${v.section==='profesional' ?'selected':''}>Mayorista</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Nombre y apellido *</label>
          <input type="text" id="op-name" class="form-control" value="${escapeHtml(v.client_name)}" ${readonlyAttr}>
        </div>
        <div class="form-group">
          <label class="form-label">Club / Empresa / Consultorio</label>
          <input type="text" id="op-club" class="form-control" value="${escapeHtml(v.client_club)}" ${readonlyAttr} placeholder="Opcional">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">DNI *</label>
            <input type="text" id="op-dni" class="form-control" value="${escapeHtml(v.client_dni)}" ${readonlyAttr}>
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">CUIT *</label>
            <input type="text" id="op-cuit" class="form-control" value="${escapeHtml(v.client_cuit)}" ${readonlyAttr}>
          </div>
        </div>
        <div class="form-group" style="margin-top:10px">
          <label class="form-label">Dirección *</label>
          <input type="text" id="op-address" class="form-control" value="${escapeHtml(v.address)}" ${readonlyAttr} placeholder="Calle, número, piso/dpto">
        </div>
        <div class="form-group">
          <label class="form-label">Localidad / Código postal *</label>
          <input type="text" id="op-localidad" class="form-control" value="${escapeHtml(v.client_localidad)}" ${readonlyAttr}>
        </div>
        <div class="form-group">
          <label class="form-label">Mail *</label>
          <input type="email" id="op-email" class="form-control" value="${escapeHtml(v.client_email)}" ${readonlyAttr}>
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
            <option value="local"    ${v.delivery==='local'    ?'selected':''}>Retiro por el local</option>
            <option value="retiro"   ${v.delivery==='retiro'   ?'selected':''}>Retiro en sucursal Andreani</option>
            <option value="andreani" ${v.delivery==='andreani' ?'selected':''}>Andreani (envío a domicilio)</option>
          </select>
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

    </div>
  `;

  // (sin toggle de dirección — el campo siempre es visible)

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
    section:          document.getElementById('op-section')   ?.value?.trim() || 'mayorista',
    client_name:      document.getElementById('op-name')      ?.value?.trim() || '',
    client_club:      document.getElementById('op-club')      ?.value?.trim() || '',
    client_dni:       document.getElementById('op-dni')       ?.value?.trim() || '',
    client_cuit:      document.getElementById('op-cuit')      ?.value?.trim() || '',
    client_phone:     document.getElementById('op-phone')     ?.value?.trim() || '',
    client_email:     document.getElementById('op-email')     ?.value?.trim() || '',
    address:          document.getElementById('op-address')   ?.value?.trim() || '',
    client_localidad: document.getElementById('op-localidad') ?.value?.trim() || '',
    delivery:         document.getElementById('op-delivery')  ?.value         || 'retiro',
    comprobante:      document.getElementById('op-comprobante')?.value        || '',
    notes:            document.getElementById('op-notes')     ?.value?.trim() || '',
    items,
  };
}

async function saveOrder(orderId) {
  const data = collectOrderData();
  if (!data.client_name)  { toast('Ingresá el nombre del cliente', 'error'); return; }
  if (!data.client_phone) { toast('Ingresá el teléfono del cliente', 'error'); return; }
  if (!data.items.length) { toast('Agregá al menos un ítem al pedido', 'error'); return; }

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
  try {
    await api(`/admin/orders/${orderId}/confirm`, { method: 'POST' });
    toast('Pedido confirmado ✓', 'success');
    document.getElementById('edit-panel')   ?.classList.remove('open');
    document.getElementById('panel-overlay')?.classList.remove('visible');
    await loadOrders();
  } catch (e) {
    toast(e.message.includes('Stock insuficiente')
      ? 'Stock insuficiente en uno o más productos.'
      : e.message, 'error');
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

async function confirmOrderInline(orderId, btn) {
  btn.disabled = true;
  await confirmOrder(orderId);
  btn.disabled = false;
}

async function cancelOrderInline(orderId, btn) {
  if (!confirm('¿Cancelar este pedido?')) return;
  btn.disabled = true;
  try {
    await api(`/admin/orders/${orderId}/cancel`, { method: 'POST' });
    toast('Pedido cancelado');
    await loadOrders();
  } catch (e) {
    toast(e.message, 'error');
    btn.disabled = false;
  }
}
