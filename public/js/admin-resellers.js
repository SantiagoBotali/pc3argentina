// ─── Vendedores: ranking, comisiones y gestión ─────────────────

async function renderResellersPage() {
  const content = document.getElementById('admin-content');
  content.innerHTML = `<div class="loader-wrap"><div class="loader-dots"><span></span><span></span><span></span></div><span>Cargando vendedores...</span></div>`;

  let resellers = [];
  try {
    resellers = await api('/admin/resellers');
  } catch (e) {
    content.innerHTML = `<p style="color:var(--color-danger)">${escapeHtml(e.message)}</p>`;
    return;
  }

  const origin = window.location.origin;
  const totalCommission = resellers.reduce((s, r) => s + (r.active ? r.commission_amount : 0), 0);
  let rank = 0;

  const rows = resellers.map(r => {
    const link = `${origin}/revendedor/${r.slug}`;
    const inactive = !r.active;
    return `
      <tr data-id="${r.id}" style="${inactive ? 'opacity:0.5' : ''}">
        <td style="font-weight:700">${inactive ? '—' : ++rank}</td>
        <td><input type="text" class="form-control js-r-name" value="${escapeHtml(r.name)}" style="min-width:130px"></td>
        <td style="font-weight:600">${r.sales_count}</td>
        <td>${fmtPrice(r.confirmed_revenue)}<br><small class="text-muted">${r.confirmed_count} confirmado${r.confirmed_count === 1 ? '' : 's'}</small></td>
        <td>
          <div style="display:flex;align-items:center;gap:4px">
            <input type="number" class="form-control js-r-pct" value="${r.commission_pct}" min="0" max="100" step="0.5" style="width:76px"> %
          </div>
        </td>
        <td style="font-weight:700;color:var(--color-accent)">${fmtPrice(r.commission_amount)}</td>
        <td>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap">
            <input type="checkbox" class="js-r-active" ${r.active ? 'checked' : ''}> ${r.active ? 'Activo' : 'Inactivo'}
          </label>
        </td>
        <td style="white-space:nowrap">
          <button class="btn btn-primary btn-sm js-r-save">Guardar</button>
          <button class="btn btn-ghost btn-sm" data-copy="${link}" title="${link}">Copiar link</button>
        </td>
      </tr>
    `;
  }).join('');

  content.innerHTML = `
    <div class="settings-card" style="margin-bottom:16px">
      <h3 style="margin-bottom:4px">Agregar vendedor</h3>
      <div class="text-sm text-muted" style="margin-bottom:12px">
        Aparece en el catálogo, al final del formulario del pedido, en el campo "Vendedor" (opcional para el cliente).
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input type="text" id="new-r-name" class="form-control" placeholder="Nombre (ej: Mariano)" style="width:220px">
        <input type="number" id="new-r-pct" class="form-control" placeholder="% comisión" min="0" max="100" step="0.5" style="width:120px">
        <button class="btn btn-primary btn-sm" id="new-r-btn">+ Agregar</button>
      </div>
    </div>

    <div class="settings-card" style="max-width:none">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:12px">
        <div>
          <h3 style="margin-bottom:4px">Vendedores y comisiones</h3>
          <div class="text-sm text-muted">
            Ordenados por cantidad de pedidos (sin contar cancelados). La comisión se calcula sobre lo facturado
            en pedidos <strong>confirmados</strong> × el % de cada vendedor. Para que una venta cuente, confirmá el
            pedido en "Pedidos". Los inactivos no aparecen en el catálogo pero conservan su historial.
          </div>
        </div>
        <div style="text-align:right">
          <div class="text-sm text-muted">Total comisiones</div>
          <div style="font-size:20px;font-weight:800">${fmtPrice(totalCommission)}</div>
        </div>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table" style="width:100%">
          <thead>
            <tr><th>#</th><th>Vendedor</th><th>Pedidos</th><th>Facturación confirmada</th><th>Comisión</th><th>A pagar</th><th>Estado</th><th>Acciones</th></tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--color-text-muted)">Todavía no hay vendedores cargados.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('new-r-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const name = document.getElementById('new-r-name').value.trim();
    if (!name) { toast('Escribí el nombre del vendedor', 'error'); return; }
    btn.disabled = true;
    try {
      await api('/admin/resellers', {
        method: 'POST',
        body: { name, commission_pct: document.getElementById('new-r-pct').value },
      });
      toast(`Vendedor "${name}" agregado`);
      renderResellersPage();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });

  content.querySelectorAll('.js-r-save').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('tr');
      btn.disabled = true;
      try {
        await api(`/admin/resellers/${row.dataset.id}`, {
          method: 'PUT',
          body: {
            name: row.querySelector('.js-r-name').value.trim(),
            commission_pct: row.querySelector('.js-r-pct').value,
            active: row.querySelector('.js-r-active').checked,
          },
        });
        toast('Vendedor guardado');
        renderResellersPage();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });

  content.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        toast('Link copiado');
      } catch (_) {
        toast('No se pudo copiar el link', 'error');
      }
    });
  });
}
