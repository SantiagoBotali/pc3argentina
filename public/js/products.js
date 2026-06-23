// ─── Discount helpers ─────────────────────────────────────────
function getApplicableTier(product, section, quantity) {
  if (!product.discount_tiers) return null;
  const tiers = product.discount_tiers
    .filter(t => t.section === section && quantity >= t.min_quantity)
    .sort((a, b) => b.min_quantity - a.min_quantity);
  return tiers[0] || null;
}

function getEffectivePrice(product, section, quantity) {
  const basePrice = section === 'mayorista' ? product.price_mayo : product.price_pro;
  const tier = getApplicableTier(product, section, quantity);
  if (!tier) return { price: basePrice, tier: null, savings: 0 };
  const discounted = Math.round(product.price_pro * (1 - tier.percentage / 100));
  const savings = (product.price_pro - discounted) * quantity;
  return { price: discounted, tier, savings };
}

window.getEffectivePrice = getEffectivePrice;
window.getApplicableTier = getApplicableTier;

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
  const imgSrc    = firstImg ? `/productos/${product.slug}/${firstImg.filename}` : null;

  const cartItem   = state.carts[section][`${product.id}_0`];
  const currentQty = cartItem ? cartItem.quantity : 0;

  // Show web reference price when it differs from list price (always in mayo; in pro when discount tiers exist)
  const hasTiersPro = section === 'profesional' && product.discount_tiers?.some(t => t.section === 'profesional');
  const showWebRef  = section === 'mayorista' || hasTiersPro;

  // Tier badges (PRO only)
  const tiersHtml = hasTiersPro
    ? product.discount_tiers
        .filter(t => t.section === 'profesional')
        .sort((a, b) => a.min_quantity - b.min_quantity)
        .map(t => {
          const dp = Math.round(product.price_pro * (1 - t.percentage / 100));
          return `<div class="row-tier">
            <span class="tier-threshold">+${t.min_quantity}</span>
            <span class="tier-pct">${t.percentage}%</span>
            <span class="tier-price">${fmt(dp)}</span>
          </div>`;
        }).join('')
    : '';

  // Mayorista saving badge
  const mayoSaving = section === 'mayorista'
    ? (() => {
        const pct = Math.round(((product.price_pro - product.price_mayo) / product.price_pro) * 100);
        return `<div class="row-mayo-saving">${pct}% menos que precio web</div>`;
      })()
    : '';

  // Stock badge
  const stockHtml = product.stock === 0
    ? `<span class="row-stock-badge row-stock-out">Sin stock</span>`
    : product.stock <= 5
      ? `<span class="row-stock-badge row-stock-low">Stock: ${product.stock}</span>`
      : '';

  // Color swatches — always shown if product has images
  const firstLabel = variantLabel(images[0]?.filename, 0);
  const swatchesHtml = images.length > 0
    ? `<div class="row-swatches">
        <span class="row-swatches-label">COLOR</span>
        <div class="row-swatch-circles">
          ${images.map((img, i) => {
            const label = variantLabel(img.filename, i);
            return `<button class="row-swatch js-swatch ${i === 0 ? 'active' : ''}"
              data-swatch-idx="${i}"
              data-src="/productos/${product.slug}/${img.filename}"
              data-color-name="${label}"
              aria-label="${label}"
              title="${label}">
              <img src="/productos/${product.slug}/${img.filename}" alt="" loading="lazy">
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
      ${showWebRef ? `<div class="row-web-price">
        <span class="row-web-label">PRECIO WEB</span>
        <span class="row-web-value">${fmt(webPrice)}</span>
      </div>` : ''}
    </div>
    ${tiersHtml ? `<div class="row-tiers">${tiersHtml}</div>` : ''}
    ${mayoSaving}
    <div class="row-savings js-dynamic-savings"></div>
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

  const qtyInput  = row.querySelector('.js-qty');
  const savingsEl = row.querySelector('.js-dynamic-savings');
  const stockWarn = row.querySelector('.js-stock-warning');
  const minusBtn  = row.querySelector('.js-qty-minus');
  const plusBtn   = row.querySelector('.js-qty-plus');
  const nameEl    = row.querySelector('.js-swatch-name');

  // ── Variant / swatch selection ──────────────────────────────
  let selectedVariantIdx = 0;
  const mainImg = row.querySelector('.js-main-img');

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
    });
  });

  // ── Price / savings display ──────────────────────────────────
  const updatePriceDisplay = () => {
    const rawQty = parseInt(qtyInput.value) || 0;
    const qty    = Math.max(1, rawQty); // use ≥1 for price calc

    const { price, tier, savings } = getEffectivePrice(product, section, qty);
    const priceEl = row.querySelector('.js-price-value');
    if (priceEl) priceEl.textContent = fmt(price);

    if (savingsEl) {
      if (tier && section === 'profesional') {
        savingsEl.textContent = `✓ ${tier.percentage}% OFF — ahorrás ${fmt(savings)}`;
        savingsEl.style.display = 'block';
      } else if (section === 'mayorista' && rawQty > 1) {
        const totalSavings = (product.price_pro - product.price_mayo) * rawQty;
        savingsEl.textContent = `Ahorrás ${fmt(totalSavings)} vs web`;
        savingsEl.style.display = 'block';
      } else {
        savingsEl.textContent = '';
        savingsEl.style.display = 'none';
      }
    }

    if (stockWarn) {
      if (rawQty > product.stock && product.stock > 0) {
        stockWarn.textContent = `⚠ Stock: ${product.stock} un`;
        qtyInput.classList.add('stock-exceed');
      } else if (product.stock === 0) {
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
    } else if (product.stock > 0) {
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
