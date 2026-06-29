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
