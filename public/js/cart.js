// ─── Cart Operations ──────────────────────────────────────────
window.addToCart = function(productId, quantity, section, variantIdx, silent) {
  const s = section || state.activeSection;
  const product = state.products.find(p => p.id === productId);
  if (!product) return;

  const stockIssue = quantity > product.stock;
  const prevVariant = state.carts[s][productId]?.variantIdx;
  state.carts[s][productId] = {
    productId,
    quantity,
    stockIssue,
    variantIdx: variantIdx != null ? variantIdx : (prevVariant || 0)
  };

  saveCartToStorage();
  updateCartUI();
  if (!silent) showToast(`${product.name} agregado al carrito`, 'success');
};

window.removeFromCart = function(productId, section) {
  const s = section || state.activeSection;
  delete state.carts[s][productId];
  saveCartToStorage();
  updateCartUI();
};

window.updateCartQty = function(productId, quantity, section) {
  const s = section || state.activeSection;
  if (quantity < 1) return removeFromCart(productId, s);
  const product = state.products.find(p => p.id === productId);
  if (!product) return;
  const stockIssue = quantity > product.stock;
  const existing = state.carts[s][productId];
  state.carts[s][productId] = { productId, quantity, stockIssue, variantIdx: existing?.variantIdx || 0 };
  saveCartToStorage();
  updateCartUI();
};

function getCartItems(section) {
  return Object.values(state.carts[section] || {});
}

function getCartTotal(section) {
  const items = getCartItems(section);
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
}

function getCartItemCount(section) {
  return getCartItems(section).reduce((sum, i) => sum + i.quantity, 0);
}

// ─── Cart UI ──────────────────────────────────────────────────
window.updateCartUI = function() {
  const proCount = getCartItemCount('profesional');
  const mayoCount = getCartItemCount('mayorista');

  // Header buttons
  const proCountEl = document.getElementById('cart-count-pro');
  const mayoCountEl = document.getElementById('cart-count-mayo');
  if (proCountEl) {
    proCountEl.textContent = proCount;
    proCountEl.style.display = proCount > 0 ? 'flex' : 'none';
  }
  if (mayoCountEl) {
    mayoCountEl.textContent = mayoCount;
    mayoCountEl.style.display = mayoCount > 0 ? 'flex' : 'none';
  }

  // Sidebar tab counts
  const sidebarProEl = document.getElementById('sidebar-count-pro');
  const sidebarMayoEl = document.getElementById('sidebar-count-mayo');
  if (sidebarProEl) sidebarProEl.textContent = proCount;
  if (sidebarMayoEl) sidebarMayoEl.textContent = mayoCount;

  // Active header button highlight
  document.getElementById('cart-btn-pro')?.classList.toggle('has-items', proCount > 0);
  document.getElementById('cart-btn-mayo')?.classList.toggle('has-items', mayoCount > 0);

  renderCartSidebar(state.activeCartTab);
  window.updateFabCart?.();
};

function updateCartTabUI() {
  const tab = state.activeCartTab;
  document.getElementById('cart-tab-pro')?.classList.toggle('active', tab === 'profesional');
  document.getElementById('cart-tab-mayo')?.classList.toggle('active', tab === 'mayorista');
}

window.renderCartSidebar = function(section) {
  const items = getCartItems(section);
  const { total, totalSavings } = getCartTotal(section);
  const minKey = section === 'profesional' ? 'min_purchase_pro' : 'min_purchase_mayo';
  const minPurchase = parseInt(state.settings[minKey]) || 0;
  const shortfall = minPurchase - total;

  updateCartTabUI();

  const itemsEl = document.getElementById('cart-items');
  if (itemsEl) {
    if (items.length === 0) {
      itemsEl.innerHTML = `
        <div class="cart-empty">
          <div class="cart-empty-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <path d="M16 10a4 4 0 0 1-8 0"/>
            </svg>
          </div>
          <div class="fw-bold">Carrito ${section === 'profesional' ? 'Profesional' : 'Mayorista'} vacío</div>
          <div class="text-sm text-muted">Agregá productos desde el catálogo</div>
        </div>`;
    } else {
      itemsEl.innerHTML = items.map(item => buildCartItemHTML(item, section)).join('');

      itemsEl.querySelectorAll('.cart-qty-minus').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = parseInt(btn.dataset.id);
          const item = state.carts[section][id];
          if (item) updateCartQty(id, item.quantity - 1, section);
        });
      });

      itemsEl.querySelectorAll('.cart-qty-plus').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = parseInt(btn.dataset.id);
          const item = state.carts[section][id];
          if (item) updateCartQty(id, item.quantity + 1, section);
        });
      });

      itemsEl.querySelectorAll('.cart-item-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = parseInt(btn.dataset.id);
          removeFromCart(id, section);
        });
      });
    }
  }

  // Summary
  const summaryEl = document.getElementById('cart-summary');
  if (summaryEl) {
    if (items.length === 0) {
      summaryEl.innerHTML = '';
    } else {
      summaryEl.innerHTML = `
        ${totalSavings > 0 ? `<div class="cart-savings-row">✦ Ahorrás ${fmt(totalSavings)} con descuentos</div>` : ''}
        <div class="cart-total-row">
          <span class="cart-total-label">Total</span>
          <span class="cart-total-value">${fmt(total)}</span>
        </div>
        ${shortfall > 0
          ? `<div class="cart-min-warning">⚠ Falta ${fmt(shortfall)} para el mínimo de ${fmt(minPurchase)}</div>`
          : `<div class="cart-min-ok">✓ Mínimo de compra alcanzado</div>`
        }
        <button id="checkout-btn" class="btn btn-primary btn-block btn-lg" ${shortfall > 0 ? 'disabled' : ''}>
          Continuar con el pedido
        </button>
        <button id="clear-cart-btn" class="btn btn-ghost btn-block btn-sm">Limpiar carrito</button>
      `;

      document.getElementById('checkout-btn')?.addEventListener('click', () => openCheckout(section));
      document.getElementById('clear-cart-btn')?.addEventListener('click', () => {
        if (confirm('¿Limpiar el carrito?')) {
          state.carts[section] = {};
          saveCartToStorage();
          updateCartUI();
        }
      });
    }
  }
};

function buildCartItemHTML(item, section) {
  const product = state.products.find(p => p.id === item.productId);
  if (!product) return '';

  const { price, tier } = getEffectivePrice(product, section, item.quantity);
  const subtotal = price * item.quantity;
  const variantIdx = item.variantIdx || 0;
  const firstImg = product.images && product.images[variantIdx];
  const imgSrc = firstImg ? `/productos/${product.slug}/${firstImg.filename}` : '';

  return `
  <div class="cart-item ${item.stockIssue ? 'has-stock-issue' : ''}">
    <div class="cart-item-img">
      ${imgSrc ? `<img src="${imgSrc}" alt="${product.name}">` : ''}
    </div>
    <div class="cart-item-info">
      <div class="cart-item-name">${product.name}</div>
      ${tier ? `<div class="cart-item-discount">✓ ${tier.percentage}% OFF aplicado</div>` : ''}
      ${item.stockIssue ? `<div class="cart-stock-warning">⚠ Stock: ${product.stock} disponibles</div>` : ''}
      <div class="cart-item-qty-row">
        <button class="cart-qty-btn cart-qty-minus" data-id="${product.id}">−</button>
        <span class="cart-item-qty">${item.quantity}</span>
        <button class="cart-qty-btn cart-qty-plus" data-id="${product.id}">+</button>
        <span class="cart-item-subtotal">${fmt(subtotal)}</span>
      </div>
    </div>
    <button class="cart-item-remove" data-id="${product.id}" aria-label="Eliminar">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  </div>`;
}
