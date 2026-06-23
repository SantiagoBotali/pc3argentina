// ─── Checkout ─────────────────────────────────────────────────
window.openCheckout = async function(section) {
  // Validate stock
  const items = Object.values(state.carts[section] || {});
  if (items.length === 0) return;

  let stockIssues = [];
  try {
    const res = await fetch('/api/validate-stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items.map(i => ({ product_id: i.productId, variant_idx: i.variantIdx, quantity: i.quantity })) })
    });
    const data = await res.json();
    if (!data.valid) stockIssues = data.issues || [];
  } catch (e) { /* proceed */ }

  renderCheckoutModal(section, stockIssues);
};

function renderCheckoutModal(section, stockIssues) {
  const existingModal = document.getElementById('checkout-modal');
  if (existingModal) existingModal.remove();

  const items = Object.values(state.carts[section] || {});
  const { total, totalSavings } = window.getCartTotal ? getCartTotal(section) : { total: 0, totalSavings: 0 };

  // Build order summary
  const summaryItems = items.map(item => {
    const product = state.products.find(p => p.id === item.productId);
    if (!product) return '';
    const { price, tier } = getEffectivePrice(product, section, item.quantity);
    const subtotal = price * item.quantity;
    const colorSuffix = item.colorName ? ` (${item.colorName})` : '';
    return `
      <div class="order-summary-item">
        <span class="order-summary-name">${product.name}${colorSuffix}</span>
        <span class="order-summary-qty">× ${item.quantity}</span>
        <span class="order-summary-price">${fmt(subtotal)}</span>
      </div>
      ${tier ? `<div style="font-size:11px;color:var(--color-success);margin-top:-4px;margin-bottom:2px">  ✓ ${tier.percentage}% OFF</div>` : ''}
    `;
  }).join('');

  // Stock warning
  const stockWarningHtml = stockIssues.length
    ? `<div class="checkout-stock-warning">
         <div class="checkout-stock-warning-title">⚠ Stock insuficiente en algunos productos</div>
         <ul class="checkout-stock-warning-list">
           ${stockIssues.map(i => `<li>${i.name}: pedís ${i.requested}, disponibles ${i.available}</li>`).join('')}
         </ul>
         <p style="font-size:12px;color:var(--color-text-muted);margin-top:6px">Tu pedido se enviará con una nota indicando la falta de stock.</p>
       </div>`
    : '';

  const sectionLabel = section === 'profesional' ? 'Profesional' : 'Mayorista';

  const modal = document.createElement('div');
  modal.id = 'checkout-modal';
  modal.className = 'modal-overlay checkout-modal';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:540px">
      <div class="modal-header">
        <h3>Completar Pedido <span class="badge badge-accent" style="margin-left:8px">${sectionLabel}</span></h3>
        <button class="btn btn-ghost btn-sm" id="close-checkout">✕</button>
      </div>
      <div class="modal-body">

        <div class="checkout-section-header">
          <h4>Resumen del pedido</h4>
        </div>

        <div class="order-summary">
          ${summaryItems}
          <hr class="divider" style="margin:6px 0">
          ${totalSavings > 0 ? `<div class="order-summary-item"><span style="color:var(--color-success)">🎉 Total ahorrado</span><span style="color:var(--color-success);font-weight:700">${fmt(totalSavings)}</span></div>` : ''}
          <div class="order-summary-item" style="font-weight:800;font-size:15px">
            <span>TOTAL</span><span style="color:var(--color-accent)">${fmt(total)}</span>
          </div>
        </div>

        ${stockWarningHtml}

        <div class="checkout-section-header" style="margin-top:16px">
          <h4>Tipo de comprobante</h4>
        </div>

        <div class="form-group">
          <div class="delivery-options" style="flex-wrap:wrap;gap:6px">
            <label class="delivery-option selected" id="opt-cf">
              <input type="radio" name="comprobante" value="Consumidor Final A" checked>
              <span class="delivery-option-label">Consumidor Final A</span>
            </label>
            <label class="delivery-option" id="opt-mono">
              <input type="radio" name="comprobante" value="Monotributo A">
              <span class="delivery-option-label">Monotributo A</span>
            </label>
            <label class="delivery-option" id="opt-ri">
              <input type="radio" name="comprobante" value="Responsable Inscripto B">
              <span class="delivery-option-label">Responsable Inscripto B</span>
            </label>
            <label class="delivery-option" id="opt-iva">
              <input type="radio" name="comprobante" value="IVA Exento">
              <span class="delivery-option-label">IVA Exento</span>
            </label>
          </div>
        </div>

        <div class="checkout-section-header" style="margin-top:16px">
          <h4>Tus datos</h4>
        </div>

        <div class="form-group">
          <label class="form-label">Nombre y apellido *</label>
          <input type="text" id="checkout-name" class="form-control" placeholder="Ej: Juan Pérez" required>
        </div>

        <div class="form-group">
          <label class="form-label">Teléfono *</label>
          <input type="tel" id="checkout-phone" class="form-control" placeholder="Ej: 3492 123456">
        </div>

        <div class="form-group">
          <label class="form-label">Tipo de entrega *</label>
          <div class="delivery-options">
            <label class="delivery-option selected" id="opt-retiro">
              <input type="radio" name="delivery" value="retiro" checked>
              <span class="delivery-option-icon">🏪</span>
              <span class="delivery-option-label">Retiro en sucursal</span>
              <span class="delivery-option-desc">Pasás a buscar</span>
            </label>
            <label class="delivery-option" id="opt-andreani">
              <input type="radio" name="delivery" value="andreani">
              <span class="delivery-option-icon">📦</span>
              <span class="delivery-option-label">Andreani</span>
              <span class="delivery-option-desc">Envío a domicilio</span>
            </label>
          </div>
        </div>

        <div class="form-group" id="address-group" style="display:none">
          <label class="form-label">Dirección de envío *</label>
          <input type="text" id="checkout-address" class="form-control" placeholder="Calle, número, ciudad">
        </div>

        <div id="checkout-form-error" class="form-error" style="display:none;margin-bottom:12px"></div>

      </div>
      <div class="modal-footer" style="flex-direction:column;gap:10px">
        <button class="whatsapp-btn" id="send-whatsapp-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.890-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          Enviar pedido por WhatsApp
        </button>
        <button class="btn btn-ghost btn-block" id="close-checkout-btn">Cancelar</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Comprobante option toggle
  modal.querySelectorAll('#opt-cf, #opt-mono, #opt-ri, #opt-iva').forEach(opt => {
    opt.addEventListener('click', () => {
      modal.querySelectorAll('[name="comprobante"]').forEach(r => r.closest('.delivery-option').classList.remove('selected'));
      opt.classList.add('selected');
      opt.querySelector('input').checked = true;
    });
  });

  // Delivery option toggle
  modal.querySelectorAll('.delivery-option').forEach(opt => {
    const radio = opt.querySelector('input[name="delivery"]');
    if (!radio) return;
    opt.addEventListener('click', () => {
      modal.querySelectorAll('input[name="delivery"]').forEach(r => r.closest('.delivery-option').classList.remove('selected'));
      opt.classList.add('selected');
      radio.checked = true;
      const isAndreani = radio.value === 'andreani';
      document.getElementById('address-group').style.display = isAndreani ? 'block' : 'none';
    });
  });

  // Close
  const closeModal = () => modal.remove();
  document.getElementById('close-checkout')?.addEventListener('click', closeModal);
  document.getElementById('close-checkout-btn')?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  // Send WhatsApp
  document.getElementById('send-whatsapp-btn')?.addEventListener('click', () => {
    sendWhatsApp(section, stockIssues);
  });
}

function sendWhatsApp(section, stockIssues) {
  const name = document.getElementById('checkout-name')?.value.trim();
  const phone = document.getElementById('checkout-phone')?.value.trim();
  const deliveryEl = document.querySelector('input[name="delivery"]:checked');
  const delivery = deliveryEl?.value;
  const address = document.getElementById('checkout-address')?.value.trim();
  const comprobanteEl = document.querySelector('input[name="comprobante"]:checked');
  const comprobante = comprobanteEl?.value || 'Consumidor Final A';

  const errorEl = document.getElementById('checkout-form-error');

  if (!name) { showError(errorEl, 'Ingresá tu nombre y apellido'); return; }
  if (!phone) { showError(errorEl, 'Ingresá tu teléfono'); return; }
  if (delivery === 'andreani' && !address) { showError(errorEl, 'Ingresá la dirección de envío'); return; }

  errorEl.style.display = 'none';

  const items = Object.values(state.carts[section] || {});
  const sectionLabel = section === 'profesional' ? 'Profesional' : 'Mayorista';
  let lines = [];

  lines.push(`*Pedido PC3 Argentina*`);
  lines.push(`_Lista: ${sectionLabel}_`);
  lines.push('');

  let total = 0;
  let totalSavings = 0;

  for (const item of items) {
    const product = state.products.find(p => p.id === item.productId);
    if (!product) continue;
    const { price, tier, savings } = getEffectivePrice(product, section, item.quantity);
    const subtotal = price * item.quantity;
    total += subtotal;
    totalSavings += savings;

    const colorSuffix = item.colorName ? ` (${item.colorName})` : '';
    lines.push(`• ${product.name}${colorSuffix} × ${item.quantity} un = ${fmt(subtotal)}`);
    if (tier) lines.push(`  ✅ Precio con ${tier.percentage}% OFF (x${tier.min_quantity}+ unidades)`);
  }

  lines.push('');
  if (totalSavings > 0) lines.push(`💰 Total ahorrado con descuentos: ${fmt(totalSavings)}`);
  lines.push(`*TOTAL: ${fmt(total)}*`);
  lines.push('');

  lines.push(`🧾 Comprobante: ${comprobante}`);
  lines.push(`👤 Nombre: ${name}`);
  lines.push(`📱 Teléfono: ${phone}`);

  if (delivery === 'andreani') {
    lines.push(`📦 Envío Andreani a: ${address}`);
  } else {
    lines.push(`🏪 Retiro en sucursal`);
  }

  if (stockIssues && stockIssues.length > 0) {
    lines.push('');
    lines.push(`⚠️ *NOTA DE STOCK:*`);
    for (const issue of stockIssues) {
      lines.push(`  - ${issue.name}: pedido ${issue.requested} un, disponibles ${issue.available} — consultar si ingresa pronto`);
    }
  }

  const message = lines.join('\n');
  const waNumber = state.settings.whatsapp_number || '5493492310744';
  const url = `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`;

  window.open(url, '_blank');

  setTimeout(() => {
    document.getElementById('checkout-modal')?.remove();
    showClearCartPrompt(section);
  }, 500);
}

function showClearCartPrompt(section) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:380px;text-align:center">
      <div class="modal-body" style="padding:32px 24px">
        <div style="font-size:48px;margin-bottom:12px">✅</div>
        <h3 style="margin-bottom:8px">¡Pedido enviado!</h3>
        <p class="text-muted text-sm" style="margin-bottom:24px">Tu pedido fue enviado por WhatsApp. ¿Querés limpiar el carrito?</p>
        <div style="display:flex;gap:10px;justify-content:center">
          <button class="btn btn-primary" id="do-clear">Limpiar carrito</button>
          <button class="btn btn-ghost" id="keep-cart">Mantener</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#do-clear').addEventListener('click', () => {
    state.carts[section] = {};
    saveCartToStorage();
    updateCartUI();
    overlay.remove();
    showToast('Carrito limpiado', 'success');
  });

  overlay.querySelector('#keep-cart').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

function showError(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
}

// Expose for cart.js
window.getCartTotal = function(section) {
  const items = Object.values(state.carts[section] || {});
  let total = 0;
  let totalSavings = 0;
  for (const item of items) {
    const product = state.products.find(p => p.id === item.productId);
    if (!product) continue;
    const { price, savings } = getEffectivePrice(product, section, item.quantity);
    total += price * item.quantity;
    totalSavings += savings;
  }
  return { total, totalSavings };
};
