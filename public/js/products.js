// ─── Image URL helper (supports Cloudinary URLs and local paths) ─
function productImgSrc(slug, filename) {
  if (!filename) return '';
  if (filename.startsWith('http')) return filename;
  return `/productos/${slug}/${filename}`;
}

// ─── Price helpers ─────────────────────────────────────────────
function getEffectivePrice(product, section, quantity) {
  const price = section === 'mayorista' ? product.price_mayo : product.price_pro;
  const publicPrice = product.price_public || 0;
  const savings = publicPrice > price ? (publicPrice - price) * (quantity || 1) : 0;
  return { price, tier: null, savings };
}

window.getEffectivePrice = getEffectivePrice;

// ─── Render list ──────────────────────────────────────────────
window.renderProductList = function () {
  const list = document.getElementById('product-list');
  if (!list) return;

  const { products, activeSection } = state;

  if (!products.length) {
    list.innerHTML = '<p style="color:var(--color-text-muted);padding:20px">No hay productos disponibles.</p>';
    return;
  }

  list.innerHTML = products.map((p, i) => buildProductRow(p, activeSection, i + 1)).join('');

  list.querySelectorAll('.product-row').forEach(row => {
    setupRowInteractions(row);
  });
};

window.renderProductGrid = window.renderProductList;

// ─── Color name from filename ─────────────────────────────────
function variantLabel(filename, idx) {
  if (!filename) return `Var. ${idx + 1}`;
  if (filename.startsWith('http')) return `Var. ${idx + 1}`;
  const n = filename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').trim();
  if (!n || /^var\s*\d+$/i.test(n)) return `Var. ${idx + 1}`;
  return n.charAt(0).toUpperCase() + n.slice(1);
}

// ─── Row builder ──────────────────────────────────────────────
function buildProductRow(product, section, rowNum) {
  const images    = product.images || [];
  const basePrice = section === 'mayorista' ? product.price_mayo : product.price_pro;
  const webPrice  = product.price_pro;
  const firstImg  = images[0];
  const imgSrc    = firstImg ? productImgSrc(product.slug, firstImg.filename) : null;

  const cartItem   = state.carts[section][`${product.id}_0`];
  const currentQty = cartItem ? cartItem.quantity : 0;

  // Public price reference (shown whenever a public price is set)
  const publicPrice   = product.price_public || 0;
  const showPublicRef = publicPrice > 0;

  // Effective stock: use first variant's stock if set, else product-level stock
  const firstImg0 = images[0];
  const firstEffectiveStock = (firstImg0 && firstImg0.stock > 0) ? firstImg0.stock : product.stock;

  // Stock badge (updates dynamically when color is switched)
  function stockBadgeHtml(s) {
    return s === 0
      ? `<span class="row-stock-badge row-stock-out">Sin stock</span>`
      : s <= 5
        ? `<span class="row-stock-badge row-stock-low">Stock: ${s}</span>`
        : '';
  }
  const stockHtml = `<div class="js-stock-badge-wrap">${stockBadgeHtml(firstEffectiveStock)}</div>`;

  // Color swatches — always shown if product has images
  const firstLabel = images[0]?.color_name || variantLabel(images[0]?.filename, 0);
  const swatchesHtml = images.length > 0
    ? `<div class="row-swatches">
        <span class="row-swatches-label">COLOR</span>
        <div class="row-swatch-circles">
          ${images.map((img, i) => {
            const label = img.color_name || variantLabel(img.filename, i);
            return `<button class="row-swatch js-swatch ${i === 0 ? 'active' : ''}"
              data-swatch-idx="${i}"
              data-src="${productImgSrc(product.slug, img.filename)}"
              data-color-name="${label}"
              data-stock="${img.stock || 0}"
              aria-label="${label}"
              title="${label}">
              <img src="${productImgSrc(product.slug, img.filename)}" alt="" loading="lazy">
            </button>`;
          }).join('')}
        </div>
        <span class="row-swatch-name js-swatch-name">${firstLabel}</span>
      </div>`
    : '';

  return `
<div class="product-row" data-id="${product.id}" data-section="${section}">

  <div class="row-num">${rowNum}</div>

  <div class="row-image" data-preview-id="${product.id}" title="Ver fotos y detalle">
    <div class="row-img-wrap">
      ${imgSrc
        ? `<img class="js-main-img" src="${imgSrc}" alt="${product.name}" loading="lazy">`
        : `<div class="row-img-placeholder"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>`
      }
      <div class="row-img-overlay">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </div>
    </div>
  </div>

  <div class="row-main">
    <div class="row-name" data-preview-id="${product.id}">${product.name}</div>
    ${product.contents    ? `<div class="row-contents">${product.contents}</div>`         : ''}
    ${product.description ? `<div class="row-description">${product.description}</div>`  : ''}
    ${swatchesHtml}
    ${stockHtml}
    <button class="row-detail-link js-detail-link" data-preview-id="${product.id}">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
      Ver fotos y detalle
    </button>
  </div>

  <div class="row-right">
    <div class="row-price-block">
      <div class="row-price-main">
        <span class="row-price-value js-price-value" data-base="${basePrice}">${fmt(basePrice)}</span>
        <span class="row-price-unit">/un</span>
      </div>
      <div class="row-price-detail">
        ${showPublicRef ? `
        <div class="row-price-detail-row row-price-detail-public">
          <span class="row-price-detail-label">Precio Público</span>
          <span class="row-price-detail-val">${fmt(publicPrice)}</span>
        </div>` : ''}
      </div>
    </div>
    <div class="row-qty-stepper">
      <button class="qty-step-btn js-qty-minus" aria-label="Menos">−</button>
      <input type="number" class="qty-input js-qty" min="0" max="9999" value="${currentQty}" data-product-id="${product.id}">
      <button class="qty-step-btn js-qty-plus" aria-label="Más">+</button>
    </div>
    <div class="row-stock-warn js-stock-warning"></div>
  </div>

</div>`;
}

// ─── Row interactions ─────────────────────────────────────────
function setupRowInteractions(row) {
  const productId = parseInt(row.dataset.id);
  const section   = row.dataset.section;
  const product   = state.products.find(p => p.id === productId);
  if (!product) return;

  const qtyInput      = row.querySelector('.js-qty');
  const stockWarn     = row.querySelector('.js-stock-warning');
  const stockBadgeWrap = row.querySelector('.js-stock-badge-wrap');
  const minusBtn      = row.querySelector('.js-qty-minus');
  const plusBtn       = row.querySelector('.js-qty-plus');
  const nameEl        = row.querySelector('.js-swatch-name');

  // ── Variant / swatch selection ──────────────────────────────
  let selectedVariantIdx = 0;
  const mainImg = row.querySelector('.js-main-img');

  // Effective stock for the currently selected variant
  const firstImage = product.images && product.images[0];
  let effectiveStock = (firstImage && firstImage.stock > 0) ? firstImage.stock : product.stock;

  function renderStockBadge(s) {
    if (!stockBadgeWrap) return;
    stockBadgeWrap.innerHTML = s === 0
      ? `<span class="row-stock-badge row-stock-out">Sin stock</span>`
      : s <= 5
        ? `<span class="row-stock-badge row-stock-low">Stock: ${s}</span>`
        : '';
  }

  row.querySelectorAll('.js-swatch').forEach(swatch => {
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(swatch.dataset.swatchIdx);
      selectedVariantIdx = idx;

      if (mainImg) {
        mainImg.style.opacity = '0';
        mainImg.src = swatch.dataset.src;
        mainImg.onload = () => { mainImg.style.opacity = '1'; };
        mainImg.style.transition = 'opacity 0.18s ease';
      }

      row.querySelectorAll('.js-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');

      if (nameEl) nameEl.textContent = swatch.dataset.colorName || swatch.title;

      // Update effective stock for this variant
      const variantStock = parseInt(swatch.dataset.stock) || 0;
      effectiveStock = variantStock > 0 ? variantStock : product.stock;
      renderStockBadge(effectiveStock);

      // Reset qty to 0 (or existing cart qty for this color)
      const newKey = `${productId}_${idx}`;
      const existingItem = state.carts[section][newKey];
      qtyInput.value = existingItem ? existingItem.quantity : 0;
      updatePriceDisplay();
    });
  });

  // ── Price / savings display ──────────────────────────────────
  const updatePriceDisplay = () => {
    const rawQty = parseInt(qtyInput.value) || 0;
    const qty    = Math.max(1, rawQty); // use ≥1 for price calc

    const { price } = getEffectivePrice(product, section, qty);
    const priceEl = row.querySelector('.js-price-value');
    if (priceEl) priceEl.textContent = fmt(price);

    if (stockWarn) {
      if (rawQty > effectiveStock && effectiveStock > 0) {
        stockWarn.textContent = `⚠ Stock: ${effectiveStock} un`;
        qtyInput.classList.add('stock-exceed');
      } else if (effectiveStock === 0) {
        stockWarn.textContent = '⚠ Sin stock';
        qtyInput.classList.add('stock-exceed');
      } else {
        stockWarn.textContent = '';
        qtyInput.classList.remove('stock-exceed');
      }
    }
  };

  // ── Auto-sync cart when qty changes ─────────────────────────
  let autoAddTimer = null;

  const syncCart = (qty, immediate = false) => {
    clearTimeout(autoAddTimer);
    const key = `${productId}_${selectedVariantIdx}`;
    if (qty === 0) {
      if (state.carts[section][key]) window.removeFromCart(key, section);
    } else if (effectiveStock > 0) {
      if (immediate) {
        window.addToCart(productId, qty, section, selectedVariantIdx, true);
      } else {
        autoAddTimer = setTimeout(() => {
          window.addToCart(productId, qty, section, selectedVariantIdx, true);
        }, 380);
      }
    }
  };

  qtyInput.addEventListener('input', () => {
    updatePriceDisplay();
    syncCart(parseInt(qtyInput.value) || 0);
  });

  qtyInput.addEventListener('blur', () => {
    syncCart(parseInt(qtyInput.value) || 0, true);
  });

  // − button
  minusBtn?.addEventListener('click', () => {
    const newQty = Math.max(0, (parseInt(qtyInput.value) || 0) - 1);
    qtyInput.value = newQty;
    updatePriceDisplay();
    syncCart(newQty, true);
  });

  // + button
  plusBtn?.addEventListener('click', () => {
    const newQty = (parseInt(qtyInput.value) || 0) + 1;
    qtyInput.value = newQty;
    updatePriceDisplay();
    syncCart(newQty, true);
  });

  // Preview triggers
  row.querySelectorAll('[data-preview-id]').forEach(el => {
    el.addEventListener('click', () => window.openPreview(productId));
  });

  updatePriceDisplay();
}
