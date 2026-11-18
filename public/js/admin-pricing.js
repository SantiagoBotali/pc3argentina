// ─── Referencia de precios / dólar BNA ─────────────────────────

const pricingState = { dolar: null, products: [] };

function fmtUsd(n) {
  return '$ ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function renderPricingPage() {
  const content = document.getElementById('admin-content');
  content.innerHTML = `<div class="loader-wrap"><div class="loader-dots"><span></span><span></span><span></span></div><span>Consultando cotización del BNA...</span></div>`;

  try {
    const [dolar, products] = await Promise.all([
      api('/admin/dolar'),
      api('/admin/products'),
    ]);
    pricingState.dolar = dolar;
    pricingState.products = products;
  } catch (e) {
    content.innerHTML = `<p style="color:var(--color-danger)">${e.message}</p>`;
    return;
  }

  renderPricingContent();
}

function renderPricingContent() {
  const content = document.getElementById('admin-content');
  const d = pricingState.dolar;
  const toUsd = (ars) => (d && d.venta ? ars / d.venta : 0);

  const rows = pricingState.products.map(p => `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${fmtPrice(p.price_pro)}<br><small class="text-muted">${fmtUsd(toUsd(p.price_pro))}</small></td>
      <td>${fmtPrice(p.price_mayo)}<br><small class="text-muted">${fmtUsd(toUsd(p.price_mayo))}</small></td>
      <td>${fmtPrice(p.price_public)}<br><small class="text-muted">${fmtUsd(toUsd(p.price_public))}</small></td>
    </tr>
  `).join('');

  content.innerHTML = `
    <div class="settings-card" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div>
          <h3 style="margin-bottom:4px">Cotización del dólar — Banco Nación</h3>
          <div class="text-sm text-muted">
            Fuente: bna.com.ar/Personas · Cotización Billetes
            ${d.hora ? ' · Actualizado ' + escapeHtml(d.hora) + ' hs' : ''}
            ${d.cached ? ' · <span title="Se guarda en caché 10 minutos para no golpear el sitio del BNA en cada carga">(caché)</span>' : ''}
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" id="refresh-dolar-btn">↻ Actualizar cotización</button>
      </div>
      <div style="display:flex;gap:28px;margin-top:14px">
        <div>
          <div class="text-sm text-muted">Compra</div>
          <div style="font-size:22px;font-weight:800">$ ${Number(d.compra).toLocaleString('es-AR')}</div>
        </div>
        <div>
          <div class="text-sm text-muted">Venta</div>
          <div style="font-size:22px;font-weight:800">$ ${Number(d.venta).toLocaleString('es-AR')}</div>
        </div>
      </div>
    </div>

    <div class="settings-card" style="max-width:none">
      <h3 style="margin-bottom:4px">Referencia de precios por categoría</h3>
      <div class="text-sm text-muted" style="margin-bottom:12px">
        Precios actuales del catálogo en pesos y su equivalente en dólares (al tipo de cambio venta del BNA),
        para usar como referencia al fijar precios en Tiendanube (público) y en las listas Mayorista / Mayorista Pro.
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table" style="width:100%">
          <thead>
            <tr><th>Producto</th><th>Mayorista</th><th>Mayorista Pro</th><th>Público (Tiendanube)</th></tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--color-text-muted)">No hay productos cargados.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('refresh-dolar-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<div class="loader-dots" style="--color-accent:#000"><span></span><span></span><span></span></div>`;
    try {
      pricingState.dolar = await api('/admin/dolar?force=1');
      renderPricingContent();
      toast('Cotización actualizada');
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  });
}
