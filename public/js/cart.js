// ─── Image URL helper (supports Cloudinary URLs and local paths) ─
function productImgSrc(slug, filename) {
  if (!filename) return '';
  if (filename.startsWith('http')) return filename;
  return `/productos/${slug}/${filename}`;
}

// ─── Cart Operations ──────────────────────────────────────────
function getVariantStock(product, variantIdx) {
  const image = product.images && product.images[variantIdx];
  if (!image) return product.stock || 0;
  // Context photos don't have per-variant stock — fall back to product.stock
  if (image.image_type === 'context') return product.stock || 0;
  // null stock means "not set" → use product.stock; 0 or positive means explicit value
  if (image.stock != null) return image.stock;
  return product.stock || 0;
}

window.addToCart = function(productId, quantity, section, variantIdx, silent) {
  const s = section || state.activeSection;
  const product = state.products.find(p => p.id === productId);
  if (!product) return;

  const idx = variantIdx != null ? variantIdx : 0;
  const image = product.images && product.images[idx];
  const isContext = image && image.image_type === 'context';
  const colorName = isContext
    ? ''
    : ((image && image.color_name) ? image.color_name : (image ? `Var. ${idx + 1}` : ''));
  const availableStock = getVariantStock(product, idx);
  if (availableStock === 0) return; // never add out-of-stock items
  const cappedQty = Math.min(quantity, availableStock);
  const key = `${productId}_${idx}`;

  state.carts[s][key] = { productId, quantity: cappedQty, variantIdx: idx, colorName };
  saveCartToStorage();
  updateCartUI();
  if (!silent) {
    const colorSuffix = colorName ? ` (${colorName})` : '';
    showToast(`${product.name}${colorSuffix} agregado al carrito`, 'success');
  }
};

window.removeFromCart = function(key, section) {
  const s = section || state.activeSection;
  delete state.carts[s][key];
  saveCartToStorage();
  updateCartUI();
};

window.updateCartQty = function(key, quantity, section) {
  const s = section || state.activeSection;
  if (quantity < 1) return removeFromCart(key, s);
  const existing = state.carts[s][key];
  if (!existing) return;
  const product = state.products.find(p => p.id === existing.productId);
  if (!product) return;
  const availableStock = getVariantStock(product, existing.variantIdx);
  if (availableStock === 0) return;
  const cappedQty = Math.min(quantity, availableStock);
  state.carts[s][key] = { ...existing, quantity: cappedQty };
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
  const activeSection = state.activeSection;

  // Lock cart tab to active section — the other section's cart is not accessible
  state.activeCartTab = activeSection;

  const isPro  = activeSection === 'profesional';
  const isMayo = activeSection === 'mayorista';

  // Header buttons: disable & dim the inactive section's button
  const btnPro  = document.getElementById('cart-btn-pro');
  const btnMayo = document.getElementById('cart-btn-mayo');
  if (btnPro)  { btnPro.disabled  = !isPro;  btnPro.style.opacity  = isPro  ? '' : '0.3'; btnPro.style.cursor  = isPro  ? '' : 'not-allowed'; }
  if (btnMayo) { btnMayo.disabled = !isMayo; btnMayo.style.opacity = isMayo ? '' : '0.3'; btnMayo.style.cursor = isMayo ? '' : 'not-allowed'; }

  // Sidebar tabs: hide the inactive one
  const tabPro  = document.getElementById('cart-tab-pro');
  const tabMayo = document.getElementById('cart-tab-mayo');
  if (tabPro)  tabPro.style.display  = isPro  ? '' : 'none';
  if (tabMayo) tabMayo.style.display = isMayo ? '' : 'none';

  // FABs: always clickable — clicking the inactive one swaps the active section
  const fabPro  = document.getElementById('fab-cart-pro');
  const fabMayo = document.getElementById('fab-cart-mayo');
  if (fabPro)  { fabPro.disabled  = false; fabPro.style.opacity  = ''; }
  if (fabMayo) { fabMayo.disabled = false; fabMayo.style.opacity = ''; }

  const proCount  = getCartItemCount('profesional');
  const mayoCount = getCartItemCount('mayorista');

  // Badge counts on header buttons
  const proCountEl  = document.getElementById('cart-count-pro');
  const mayoCountEl = document.getElementById('cart-count-mayo');
  if (proCountEl)  { proCountEl.textContent  = proCount; }
  if (mayoCountEl) { mayoCountEl.textContent = mayoCount; }

  // Sidebar tab counts
  const sidebarProEl  = document.getElementById('sidebar-count-pro');
  const sidebarMayoEl = document.getElementById('sidebar-count-mayo');
  if (sidebarProEl)  sidebarProEl.textContent  = proCount;
  if (sidebarMayoEl) sidebarMayoEl.textContent = mayoCount;

  // Active header button highlight
  document.getElementById('cart-btn-pro')?.classList.toggle('has-items', proCount > 0);
  document.getElementById('cart-btn-mayo')?.classList.toggle('has-items', mayoCount > 0);

  renderCartSidebar(activeSection);
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
          <div class="fw-bold">Carrito ${section === 'profesional' ? 'Mayorista' : 'Mayorista Pro'} vacío</div>
          <div class="text-sm text-muted">Agregá productos desde el catálogo</div>
        </div>`;
    } else {
      itemsEl.innerHTML = items.map(item => buildCartItemHTML(item, section)).join('');

      itemsEl.querySelectorAll('.cart-qty-minus').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.key;
          const item = state.carts[section][key];
          if (item) updateCartQty(key, item.quantity - 1, section);
        });
      });

      itemsEl.querySelectorAll('.cart-qty-plus').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.key;
          const item = state.carts[section][key];
          if (item) updateCartQty(key, item.quantity + 1, section);
        });
      });

      itemsEl.querySelectorAll('.cart-item-qty-input').forEach(input => {
        input.addEventListener('change', () => {
          const key = input.dataset.key;
          const qty = parseInt(input.value) || 1;
          updateCartQty(key, Math.max(1, qty), section); // updateCartQty caps at available stock
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') input.blur();
        });
      });

      itemsEl.querySelectorAll('.cart-item-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.key;
          removeFromCart(key, section);
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

  const key = `${item.productId}_${item.variantIdx}`;
  const { price, tier } = getEffectivePrice(product, section, item.quantity);
  const subtotal = price * item.quantity;
  const variantIdx = item.variantIdx || 0;
  const firstImg = product.images && product.images[variantIdx];
  const imgSrc = firstImg ? productImgSrc(product.slug, firstImg.filename) : '';
  const colorLabel = item.colorName ? ` — ${item.colorName}` : '';

  return `
  <div class="cart-item">
    <div class="cart-item-img">
      ${imgSrc ? `<img src="${imgSrc}" alt="${product.name}">` : ''}
    </div>
    <div class="cart-item-info">
      <div class="cart-item-name">${product.name}${colorLabel}</div>
      ${tier ? `<div class="cart-item-discount">✓ ${tier.percentage}% OFF aplicado</div>` : ''}
      <div class="cart-item-qty-row">
        <button class="cart-qty-btn cart-qty-minus" data-key="${key}">−</button>
        <input type="number" class="cart-qty-btn cart-item-qty-input" data-key="${key}" value="${item.quantity}" min="1"
          style="width:48px;text-align:center;border:1px solid var(--color-border);border-radius:4px;background:var(--color-surface2);color:var(--color-text);padding:2px 4px;font-size:13px">
        <button class="cart-qty-btn cart-qty-plus" data-key="${key}">+</button>
        <span class="cart-item-subtotal">${fmt(subtotal)}</span>
      </div>
    </div>
    <button class="cart-item-remove" data-key="${key}" aria-label="Eliminar">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  </div>`;
}
