// ─── Revendedores (dashboard) ──────────────────────────────────

async function renderResellersPage() {
  const content = document.getElementById('admin-content');
  content.innerHTML = `<div class="loader-wrap"><div class="loader-dots"><span></span><span></span><span></span></div><span>Cargando revendedores...</span></div>`;

  let resellers = [];
  try {
    resellers = await api('/admin/resellers');
  } catch (e) {
    content.innerHTML = `<p style="color:var(--color-danger)">${e.message}</p>`;
    return;
  }

  const origin = window.location.origin;
  const rows = resellers.map((r, i) => `
    <tr>
      <td style="font-weight:700">${i + 1}</td>
      <td>${escapeHtml(r.name)}</td>
      <td style="font-weight:600">${r.sales_count}</td>
      <td>${fmtPrice(r.confirmed_revenue)}</td>
      <td>
        <code style="font-size:12px">${origin}/revendedor/${r.slug}</code>
        <button class="btn btn-ghost btn-sm" style="margin-left:6px" data-copy="${origin}/revendedor/${r.slug}">Copiar link</button>
      </td>
    </tr>
  `).join('');

  content.innerHTML = `
    <div class="settings-card">
      <h3 style="margin-bottom:4px">Revendedores</h3>
      <div class="text-sm text-muted" style="margin-bottom:12px">
        Ranking por cantidad de pedidos generados con el link único de cada revendedor, de mayor a menor.
        Cada revendedor entra a su link, arma el carrito y carga los datos del cliente — el pedido queda
        registrado acá con su nombre.
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table" style="width:100%">
          <thead>
            <tr><th>#</th><th>Revendedor</th><th>Ventas</th><th>Facturación confirmada</th><th>Link único</th></tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--color-text-muted)">Todavía no hay ventas registradas.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;

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
