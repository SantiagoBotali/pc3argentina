// ─── Image URL helper (supports Cloudinary URLs and local paths) ─
function productImgSrc(slug, filename) {
  if (!filename) return '';
  if (filename.startsWith('http')) return filename;
  return `/productos/${slug}/${filename}`;
}

// ─── Stock limit tooltip ──────────────────────────────────────
let _tooltipTimer = null;
window.showStockTooltip = function showStockTooltip(anchor) {
  let tip = anchor.querySelector('.qty-limit-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'qty-limit-tooltip';
    tip.textContent = 'No quedan más unidades disponibles';
    anchor.appendChild(tip);
  }
  tip.classList.add('visible');
  clearTimeout(_tooltipTimer);
  _tooltipTimer = setTimeout(() => tip.classList.remove('visible'), 2000);
};

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

  // Public price reference (shown whenever a public price is set)
  const publicPrice   = product.price_public || 0;
  const showPublicRef = publicPrice > 0;

  // Helper: effective stock for an image entry
  const imgStock = (img) => (img.image_type === 'context')
    ? (product.stock || 0)
    : (img.stock != null ? img.stock : (product.stock || 0));

  // Only variant-type images drive swatches and out-of-stock logic
  const variants = images.filter(img => img.image_type !== 'context');

  // Fully out of stock = every variant (or product.stock if no variants) has 0 stock
  const isFullyOutOfStock = variants.length
    ? variants.every(img => imgStock(img) === 0)
    : (product.stock || 0) === 0;

  // displayIdx: primera imagen según sort_order (puede ser contexto o variante)
  const displayIdx = 0;

  // cartVariantIdx: primera variante con stock para carrito/swatches
  const firstStockIdx    = images.findIndex(img => img.image_type !== 'context' && imgStock(img) > 0);
  const firstVariantIdx  = images.findIndex(img => img.image_type !== 'context');
  const cartVariantIdx   = firstStockIdx >= 0 ? firstStockIdx : (firstVariantIdx >= 0 ? firstVariantIdx : 0);

  const firstImg  = images[displayIdx];
  const imgSrc    = firstImg ? productImgSrc(product.slug, firstImg.filename) : null;

  const cartItem   = state.carts[section][`${product.id}_${cartVariantIdx}`];
  const currentQty = cartItem ? cartItem.quantity : 0;

  // Stock efectivo inicial basado en la variante seleccionada para el carrito
  const cartVariantImg      = images[cartVariantIdx];
  const firstEffectiveStock = cartVariantImg ? imgStock(cartVariantImg) : (product.stock || 0);

  // Stock badge (updates dynamically when color is switched)
  function stockBadgeHtml(s) {
    return s === 0
      ? `<span class="row-stock-badge row-stock-out">Sin stock de este color</span>`
      : s < 20
        ? `<span class="row-stock-badge row-stock-low">Quedan pocas unidades de este color</span>`
        : '';
  }
  const stockHtml = `<div class="js-stock-badge-wrap">${stockBadgeHtml(firstEffectiveStock)}</div>`;

  // Color swatches — only shown when product has variant-type images
  const activeImg   = images[cartVariantIdx];
  const activeLabel = (activeImg && activeImg.image_type !== 'context' && activeImg.color_name)
    ? activeImg.color_name
    : variantLabel(activeImg?.filename, cartVariantIdx);

  const swatchesHtml = variants.length > 0
    ? `<div class="row-swatches">
        <span class="row-swatches-label">COLOR</span>
        <div class="row-swatch-circles">
          ${images.map((img, i) => {
            if (img.image_type === 'context') return '';  // skip context photos
            const label    = img.color_name || variantLabel(img.filename, i);
            const hex      = img.color_hex  || '#cccccc';
            const stock    = imgStock(img);
            const outClass = stock === 0 ? ' row-swatch--out-of-stock' : '';
            const disabled = stock === 0 ? 'disabled' : '';
            return `<button class="row-swatch js-swatch${outClass}${i === cartVariantIdx ? ' active' : ''}"
              data-swatch-idx="${i}"
              data-src="${productImgSrc(product.slug, img.filename)}"
              data-color-name="${label}"
              data-stock="${img.stock != null ? img.stock : ''}"
              aria-label="${label}"
              title="${stock === 0 ? label + ' (sin stock)' : label}"
              ${disabled}
              style="background-color:${hex}">
            </button>`;
          }).join('')}
        </div>
        <span class="row-swatch-name js-swatch-name">${activeLabel}</span>
      </div>`
    : '';

  const contextImgs = images.reduce((acc, img, i) => {
    if (img.image_type === 'context') acc.push({ img, i });
    return acc;
  }, []);
  const contextThumbsHtml = contextImgs.length > 0
    ? `<div class="row-context-thumbs">
        ${contextImgs.map(({ img, i }) =>
          `<button class="js-context-thumb row-context-thumb"
            data-src="${productImgSrc(product.slug, img.filename)}"
            data-idx="${i}"
            title="Foto de contexto">
            <img src="${productImgSrc(product.slug, img.filename)}" loading="lazy" alt="">
          </button>`
        ).join('')}
        <button class="js-context-lightbox row-context-link">Ver fotos</button>
      </div>`
    : '';

  return `
<div class="product-row${isFullyOutOfStock ? ' product-row--out-of-stock' : ''}" data-id="${product.id}" data-section="${section}">

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
    ${contextThumbsHtml}
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
    ${stockHtml}
  </div>

</div>`;
}

// ─── Row interactions ─────────────────────────────────────────
function setupRowInteractions(row) {
  const productId = parseInt(row.dataset.id);
  const section   = row.dataset.section;
  const product   = state.products.find(p => p.id === productId);
  if (!product) return;

  const qtyInput       = row.querySelector('.js-qty');
  const stockBadgeWrap = row.querySelector('.js-stock-badge-wrap');
  const minusBtn      = row.querySelector('.js-qty-minus');
  const plusBtn       = row.querySelector('.js-qty-plus');
  const nameEl        = row.querySelector('.js-swatch-name');

  // ── Variant / swatch selection ──────────────────────────────
  const images = product.images || [];
  const imgStockFn = (img) => (img.image_type === 'context')
    ? (product.stock || 0)
    : (img.stock != null ? img.stock : (product.stock || 0));
  // Only pick variants as initial selection (context photos don't have per-variant stock)
  const firstStockIdx = images.findIndex(img => img.image_type !== 'context' && imgStockFn(img) > 0);
  const firstVariantIdx = images.findIndex(img => img.image_type !== 'context');
  let selectedVariantIdx = firstStockIdx >= 0 ? firstStockIdx : (firstVariantIdx >= 0 ? firstVariantIdx : 0);
  const mainImg = row.querySelector('.js-main-img');

  // Effective stock for the currently selected variant.
  const firstImage = images[selectedVariantIdx];
  let effectiveStock = firstImage ? imgStockFn(firstImage) : (product.stock || 0);

  // ── Auto-slideshow state (declared early so swatch handler can reference it) ──
  let autoTimer = null;
  const stopAutoSlide = () => { clearInterval(autoTimer); autoTimer = null; };

  function renderStockBadge(s) {
    if (!stockBadgeWrap) return;
    stockBadgeWrap.innerHTML = s === 0
      ? `<span class="row-stock-badge row-stock-out">Sin stock de este color</span>`
      : s < 20
        ? `<span class="row-stock-badge row-stock-low">Quedan pocas unidades de este color</span>`
        : '';
  }

  row.querySelectorAll('.js-swatch').forEach(swatch => {
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      stopAutoSlide();
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

      // Update effective stock for this variant.
      // data-stock="" means "not set" → fall back to product.stock.
      // data-stock="0" means explicitly 0 → out of stock.
      const rawStock = swatch.dataset.stock;
      effectiveStock = rawStock !== '' ? parseInt(rawStock) : (product.stock || 0);
      renderStockBadge(effectiveStock);
      setControlsDisabled(effectiveStock === 0);

      // Reset qty to 0 (or existing cart qty for this color)
      const newKey = `${productId}_${idx}`;
      const existingItem = state.carts[section][newKey];
      qtyInput.value = existingItem ? existingItem.quantity : 0;
      updatePriceDisplay();
    });
  });

  // ── Auto-slideshow ───────────────────────────────────────────
  // Only cycle variants with stock + context photos (skip out-of-stock variants)
  const slideImages = images.filter(img =>
    img.image_type === 'context' || imgStockFn(img) > 0
  );
  if (slideImages.length > 1 && mainImg) {
    let autoIdx = 0;
    const tick = () => {
      autoIdx = (autoIdx + 1) % slideImages.length;
      const img = slideImages[autoIdx];
      mainImg.style.transition = 'opacity 0.5s ease';
      mainImg.style.opacity = '0';
      setTimeout(() => {
        mainImg.src = productImgSrc(product.slug, img.filename);
        requestAnimationFrame(() => requestAnimationFrame(() => { mainImg.style.opacity = '1'; }));
      }, 500);
    };
    autoTimer = setInterval(tick, 3000);
  }

  // Build context images array once for this product (for lightbox)
  const contextLightboxImgs = images
    .filter(img => img.image_type === 'context')
    .map(img => ({ src: productImgSrc(product.slug, img.filename) }));

  row.querySelectorAll('.js-context-thumb').forEach(thumb => {
    thumb.addEventListener('click', (e) => {
      e.stopPropagation();
      stopAutoSlide();
      if (mainImg) {
        mainImg.style.opacity = '0';
        mainImg.src = thumb.dataset.src;
        mainImg.onload = () => { mainImg.style.opacity = '1'; };
        mainImg.style.transition = 'opacity 0.18s ease';
      }
      row.querySelectorAll('.js-swatch').forEach(s => s.classList.remove('active'));
    });
  });

  row.querySelector('.js-context-lightbox')?.addEventListener('click', (e) => {
    e.stopPropagation();
    window.openLightbox(contextLightboxImgs, 0);
  });

  // ── Enable / disable stepper controls based on stock ────────
  function setControlsDisabled(disabled) {
    qtyInput.disabled = disabled;
    if (minusBtn) minusBtn.disabled = disabled;
    if (plusBtn)  plusBtn.disabled  = disabled;
    if (disabled) {
      qtyInput.value = 0;
      qtyInput.classList.remove('stock-exceed');
    }
  }

  // Apply initial state
  setControlsDisabled(effectiveStock === 0);

  // ── Price / savings display ──────────────────────────────────
  const updatePriceDisplay = () => {
    const rawQty = parseInt(qtyInput.value) || 0;
    const qty    = Math.max(1, rawQty); // use ≥1 for price calc

    const { price } = getEffectivePrice(product, section, qty);
    const priceEl = row.querySelector('.js-price-value');
    if (priceEl) priceEl.textContent = fmt(price);
    qtyInput.classList.remove('stock-exceed');
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
    let qty = parseInt(qtyInput.value) || 0;
    if (effectiveStock > 0 && qty > effectiveStock) {
      qty = effectiveStock;
      qtyInput.value = qty;
    }
    updatePriceDisplay();
    syncCart(qty);
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
    const current = parseInt(qtyInput.value) || 0;
    if (current >= effectiveStock) {
      showStockTooltip(row.querySelector('.row-qty-stepper'));
      return;
    }
    const newQty = current + 1;
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
