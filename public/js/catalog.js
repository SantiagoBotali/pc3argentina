// ─── Image URL helper (supports Cloudinary URLs and local paths) ─
function productImgSrc(slug, filename) {
  if (!filename) return '';
  if (filename.startsWith('http')) return filename;
  return `/productos/${slug}/${filename}`;
}

// ─── Global State ────────────────────────────────────────────
window.state = {
  activeSection: 'profesional',
  activeCartTab: 'profesional',
  products: [],
  settings: {},
  carts: { profesional: {}, mayorista: {} },
  resellerSlug: null,
  resellerName: null,
};

// ─── Revendedor: detecta /revendedor/:slug y tagea la sesión ──
(function detectReseller() {
  const m = window.location.pathname.match(/^\/revendedor\/([^/]+)/);
  if (!m) return;
  state.resellerSlug = decodeURIComponent(m[1]);
})();

async function setupResellerBanner() {
  if (!state.resellerSlug) return;
  try {
    const res = await fetch(`/api/resellers/${encodeURIComponent(state.resellerSlug)}`);
    if (!res.ok) throw new Error();
    const reseller = await res.json();
    state.resellerName = reseller.name;
  } catch (_) {
    state.resellerName = state.resellerSlug;
  }

  const banner = document.createElement('div');
  banner.id = 'reseller-banner';
  banner.style.cssText = 'position:sticky;top:0;z-index:60;background:var(--color-accent);color:#fff;text-align:center;padding:8px 12px;font-size:13px;font-weight:600';
  banner.innerHTML = `Vendiendo como <strong>${state.resellerName}</strong> · <a href="/revendedor" style="color:#fff;text-decoration:underline">cambiar</a>`;
  document.body.prepend(banner);
}

// ─── Utility ─────────────────────────────────────────────────
window.fmt = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

window.showToast = (msg, type = 'info', duration = 3000) => {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    toast.style.transition = '0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
};

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  loadCartFromStorage();

  try {
    const [productsRes, settingsRes] = await Promise.all([
      fetch('/api/products'),
      fetch('/api/settings')
    ]);

    if (!productsRes.ok) throw new Error('Error cargando productos');
    state.products = await productsRes.json();
    state.settings = await settingsRes.json();
  } catch (e) {
    console.error(e);
    document.getElementById('product-list').innerHTML =
      '<p style="color:var(--color-danger);padding:20px">Error cargando el catálogo. Recargá la página.</p>';
    return;
  }

  setupTheme();
  renderProductList();
  updateCartUI();
  setupSectionTabs();
  setupGuide();
  setupCartSidebar();
  setupFabs();
  setupPreviewModal();
  updateSectionInfo();
  setupResellerBanner();
});

// ─── Theme ────────────────────────────────────────────────────
function applyTheme(theme) {
  const isLight = theme === 'light';
  document.documentElement.classList.toggle('light', isLight);
  document.body.classList.toggle('light', isLight);
}

function updateLogo() {
  const img = document.getElementById('header-logo-img');
  if (!img) return;
  img.style.display = '';
  const isPro   = state.activeSection === 'mayorista';
  const isLight = document.body.classList.contains('light');
  if (!isPro && !isLight) img.src = '/PC3logo.png';
  else if (!isPro &&  isLight) img.src = '/logo-mayorista-negro.png';
  else if ( isPro && !isLight) img.src = '/logo-mayorista-pro.png';
  else                         img.src = '/logo-mayorista-pro-negro.png';
}

function setupTheme() {
  const saved = localStorage.getItem('pc3_theme') || 'dark';
  applyTheme(saved);
  updateLogo();
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const next = document.body.classList.contains('light') ? 'dark' : 'light';
    applyTheme(next);
    localStorage.setItem('pc3_theme', next);
    updateLogo();
  });
}

// ─── Section Tabs ─────────────────────────────────────────────
function switchToSection(section) {
  if (section === state.activeSection) return;
  state.activeSection = section;

  document.querySelectorAll('.section-card').forEach(c => {
    c.classList.toggle('active', c.dataset.section === section);
  });

  document.body.classList.remove('section-profesional', 'section-mayorista');
  document.body.classList.add(`section-${section}`);

  renderProductList();
  updateCartUI();
  updateSectionInfo();
  updateLogo();
}

function setupSectionTabs() {
  document.querySelectorAll('.section-card').forEach(card => {
    card.addEventListener('click', () => switchToSection(card.dataset.section));
  });
}

function updateSectionInfo() {
  const minPro  = parseInt(state.settings.min_purchase_pro)  || 0;
  const minMayo = parseInt(state.settings.min_purchase_mayo) || 0;

  const proMinEl  = document.getElementById('section-min-label-pro');
  const mayoMinEl = document.getElementById('section-min-label-mayo');

  if (proMinEl)  proMinEl.textContent  = fmt(minPro);
  if (mayoMinEl) mayoMinEl.textContent = fmt(minMayo);

  window.updateFabCart?.();
}

// ─── Floating Action Buttons ───────────────────────────────────
function setupFabs() {
  const waFab = document.getElementById('fab-whatsapp');
  if (waFab && state.settings.whatsapp_number) {
    waFab.href = `https://wa.me/${state.settings.whatsapp_number}`;
  }

  const onFabClick = (section) => {
    if (section !== state.activeSection) {
      // Inactive FAB: just swap the list, don't open the sidebar
      switchToSection(section);
      return;
    }
    // Active FAB: open the cart sidebar
    const sidebar = document.getElementById('cart-sidebar');
    const overlay = document.getElementById('cart-overlay');
    if (sidebar) { sidebar.classList.add('open'); document.body.style.overflow = 'hidden'; }
    if (overlay) overlay.classList.add('visible');
    state.activeCartTab = section;
    updateCartTabUI();
    renderCartSidebar(section);
  };

  document.getElementById('fab-cart-pro')?.addEventListener('click',  () => onFabClick('profesional'));
  document.getElementById('fab-cart-mayo')?.addEventListener('click', () => onFabClick('mayorista'));
}

window.updateFabCart = function() {
  const section = state.activeSection;
  const proFab  = document.getElementById('fab-cart-pro');
  const mayoFab = document.getElementById('fab-cart-mayo');
  const waFab   = document.getElementById('fab-whatsapp');

  if (waFab && state.settings.whatsapp_number) {
    waFab.href = `https://wa.me/${state.settings.whatsapp_number}`;
  }

  if (!proFab || !mayoFab) return;

  proFab.classList.toggle('fab-active',  section === 'profesional');
  mayoFab.classList.toggle('fab-active', section === 'mayorista');

  const updateFabInfo = (s, badgeId, subId) => {
    const isActive = s === section;
    const items = Object.values(state.carts[s] || {});
    const count = items.reduce((sum, i) => sum + i.quantity, 0);
    const badge = document.getElementById(badgeId);
    const sub   = document.getElementById(subId);

    if (badge) {
      badge.textContent = count;
    }
    if (sub) {
      if (!isActive) {
        // Inactive FAB: hint that clicking switches the list
        sub.textContent = count === 0 ? 'Cambiar lista' : `Cambiar · ${count} items`;
      } else if (count === 0) {
        sub.textContent = 'Vacío';
      } else {
        const total = items.reduce((sum, item) => {
          const product = state.products.find(p => p.id === item.productId);
          if (!product) return sum;
          const { price } = window.getEffectivePrice(product, s, item.quantity);
          return sum + price * item.quantity;
        }, 0);
        sub.textContent = fmt(total);
      }
    }
  };

  updateFabInfo('profesional', 'fab-badge-pro',  'fab-sub-pro');
  updateFabInfo('mayorista',   'fab-badge-mayo', 'fab-sub-mayo');
};

// ─── Guide ────────────────────────────────────────────────────
function setupGuide() {
  const banner = document.getElementById('guide-banner');
  const toggleBtn = document.getElementById('guide-toggle');
  if (!toggleBtn || !banner) return;

  toggleBtn.addEventListener('click', () => {
    const collapsed = banner.classList.toggle('collapsed');
    toggleBtn.querySelector('.toggle-text').textContent = collapsed ? '▾ Mostrar guía de uso' : '▴ Ocultar guía';
  });
}

// ─── Cart Sidebar ─────────────────────────────────────────────
function setupCartSidebar() {
  const sidebar = document.getElementById('cart-sidebar');
  const overlay = document.getElementById('cart-overlay');
  const closeBtn = document.getElementById('close-cart');

  const open = (tab) => {
    if (tab) {
      state.activeCartTab = tab;
      updateCartTabUI();
    }
    sidebar.classList.add('open');
    overlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
  };

  const close = () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
    document.body.style.overflow = '';
  };

  // Header cart buttons (PRO / MAY)
  document.getElementById('cart-btn-pro')?.addEventListener('click', () => open('profesional'));
  document.getElementById('cart-btn-mayo')?.addEventListener('click', () => open('mayorista'));

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', close);

  // Cart tab switching inside sidebar
  document.getElementById('cart-tab-pro')?.addEventListener('click', () => {
    state.activeCartTab = 'profesional';
    updateCartTabUI();
    renderCartSidebar('profesional');
  });

  document.getElementById('cart-tab-mayo')?.addEventListener('click', () => {
    state.activeCartTab = 'mayorista';
    updateCartTabUI();
    renderCartSidebar('mayorista');
  });
}

function updateCartTabUI() {
  const tab = state.activeCartTab;
  document.getElementById('cart-tab-pro')?.classList.toggle('active', tab === 'profesional');
  document.getElementById('cart-tab-mayo')?.classList.toggle('active', tab === 'mayorista');
}

// ─── Preview Modal ────────────────────────────────────────────
function setupPreviewModal() {
  const overlay = document.getElementById('preview-modal');
  const closeBtn = document.getElementById('preview-close');

  closeBtn?.addEventListener('click', closePreview);
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) closePreview();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePreview();
  });
}

window.openPreview = function(productId) {
  const product = state.products.find(p => p.id === productId);
  if (!product) return;

  const overlay = document.getElementById('preview-modal');
  const content = document.getElementById('preview-content');
  if (!overlay || !content) return;

  const section = state.activeSection;
  const images  = product.images || [];

  // Initial variant selection (first variant with stock, then first variant, then 0)
  const firstStockIdx    = images.findIndex((img, i) => img.image_type !== 'context' && getVariantStock(product, i) > 0);
  const firstVariantIdx  = images.findIndex(img => img.image_type !== 'context');
  const initialVariantIdx = firstStockIdx >= 0 ? firstStockIdx : (firstVariantIdx >= 0 ? firstVariantIdx : 0);

  let currentViewIdx     = 0;               // respeta el sort_order configurado en admin
  let selectedVariantIdx = initialVariantIdx; // primera variante con stock, para el carrito

  const variants = images.filter(img => img.image_type !== 'context');

  // ── Thumbnail strip (all images) ────────────────────────
  const thumbsHtml = images.map((img, i) => {
    const isVariant    = img.image_type !== 'context';
    const isOutOfStock = isVariant && getVariantStock(product, i) === 0;
    return `
    <button class="pv-thumb${i === currentViewIdx ? ' active' : ''}${isOutOfStock ? ' pv-thumb--out' : ''}" data-idx="${i}"
      style="position:relative">
      <img src="${productImgSrc(product.slug, img.filename)}" alt="" loading="lazy">
      ${isOutOfStock ? '<span class="pv-thumb-out-label">sin stock</span>' : ''}
    </button>`;
  }).join('');

  const initialSrc = images[currentViewIdx]
    ? productImgSrc(product.slug, images[currentViewIdx].filename)
    : '';

  // ── Variant swatches for info panel ─────────────────────
  const activeVariantName = images[selectedVariantIdx]?.color_name || '';
  const swatchesHtml = variants.length > 0
    ? `<div class="pv-swatches">
        <span class="pv-swatches-label">COLOR</span>
        <div class="pv-swatch-circles">
          ${images.map((img, i) => {
            if (img.image_type === 'context') return '';
            const label = img.color_name || `Var. ${i + 1}`;
            const hex   = img.color_hex  || '#cccccc';
            const stock = getVariantStock(product, i);
            return `<button class="pv-swatch js-pv-swatch${i === selectedVariantIdx ? ' active' : ''}${stock === 0 ? ' pv-swatch--out' : ''}"
              data-idx="${i}" data-color="${label}"
              style="background-color:${hex}"
              title="${label}${stock === 0 ? ' (sin stock)' : ''}"
              ${stock === 0 ? 'disabled' : ''}></button>`;
          }).join('')}
        </div>
        <span class="pv-swatch-name" id="pv-swatch-name">${activeVariantName}</span>
      </div>`
    : '';

  // ── Price info ───────────────────────────────────────────
  const sectionPrice = section === 'mayorista' ? product.price_mayo : product.price_pro;
  const sectionLabel = section === 'mayorista' ? 'Precio Mayorista Pro' : 'Precio Mayorista';
  const publicPrice  = product.price_public || 0;

  const priceInfo = `
    <div class="pv-price-hero">
      <span class="pv-price-main">${fmt(sectionPrice)}</span>
      <span class="pv-price-unit">/un</span>
    </div>
    <div class="pv-price-detail">
      <div class="pv-price-detail-row pv-price-detail-section">
        <span class="pv-price-detail-label">${sectionLabel}</span>
        <span class="pv-price-detail-val">${fmt(sectionPrice)}</span>
      </div>
      ${publicPrice > 0 ? `
      <div class="pv-price-detail-row pv-price-detail-public">
        <span class="pv-price-detail-label">Precio Público</span>
        <span class="pv-price-detail-val">${fmt(publicPrice)}</span>
      </div>` : ''}
    </div>
  `;

  const navHtml = images.length > 1
    ? `<button class="pv-nav pv-prev">&#8249;</button><button class="pv-nav pv-next">&#8250;</button>`
    : '';

  content.innerHTML = `
    <div class="pv-gallery" id="pv-gallery">
      ${images.length ? `<div class="pv-thumbs-strip" id="pv-thumbs-strip">${thumbsHtml}</div>` : ''}
      <div class="pv-main-view">
        ${initialSrc
          ? `<img class="pv-main-img" id="pv-main-img" src="${initialSrc}" alt="${product.name}">`
          : `<div class="pv-no-image">Sin imagen</div>`}
        ${navHtml}
      </div>
    </div>
    <div class="pv-info">
      <div class="pv-title-row">
        <h2 class="pv-name">${product.name}</h2>
      </div>
      ${product.contents    ? `<div class="pv-contents">📦 ${product.contents}</div>`        : ''}
      ${product.description ? `<div class="pv-description">${product.description}</div>`     : ''}
      ${swatchesHtml}
      <div class="pv-pricing">
        ${priceInfo}
      </div>
      ${(images.filter(img => img.image_type === 'context').length > 0) ? `
      <div class="pv-context-section">
        <div class="pv-context-mini-row">
          ${images.reduce((acc, img, i) => {
            if (img.image_type === 'context' && acc.length < 4)
              acc.push(`<button class="pv-context-mini js-pv-context-mini" data-idx="${i}" title="Ver foto">
                <img src="${productImgSrc(product.slug, img.filename)}" alt="">
              </button>`);
            return acc;
          }, []).join('')}
          ${images.filter(img => img.image_type === 'context').length > 4
            ? `<span class="pv-context-mini-more">+${images.filter(img => img.image_type === 'context').length - 4}</span>`
            : ''}
        </div>
        <button class="pv-context-link" id="pv-context-btn">Ver fotos detalladas</button>
      </div>` : ''}
      <div class="pv-actions">
        <div class="pv-qty-row" style="position:relative">
          <button class="pv-qty-btn" id="pv-qty-minus">−</button>
          <input type="number" class="pv-qty-input" id="pv-qty-input" value="1" min="1" max="9999">
          <button class="pv-qty-btn" id="pv-qty-plus">+</button>
          <span class="pv-qty-unit">un</span>
        </div>
        <div id="pv-stock-msg" style="font-size:11px;font-weight:600;min-height:16px;margin-top:4px"></div>
        <div class="pv-savings" id="pv-savings"></div>
        <button class="pv-add-btn" id="pv-add-btn" data-product-id="${product.id}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
          </svg>
          Agregar al carrito
        </button>
      </div>
    </div>
  `;

  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // ── DOM refs ─────────────────────────────────────────────
  const qtyInput  = content.querySelector('#pv-qty-input');
  const savingsEl = content.querySelector('#pv-savings');
  const addBtn    = content.querySelector('#pv-add-btn');
  const stockMsg  = content.querySelector('#pv-stock-msg');
  const pvQtyRow  = content.querySelector('.pv-qty-row');
  const pvGallery = content.querySelector('#pv-gallery');
  const mainImg   = content.querySelector('#pv-main-img');

  // ── Stock state (based on selectedVariantIdx; suppressFilter = viewing context photo) ──
  const updateStockState = (variantIdx, suppressFilter = false) => {
    const stock = getVariantStock(product, variantIdx);
    pvGallery?.classList.toggle('pv-gallery--out-of-stock', !suppressFilter && stock === 0);

    const currentQty = parseInt(qtyInput.value) || 1;
    if (stock > 0 && currentQty > stock) qtyInput.value = stock;

    if (stock === 0) {
      stockMsg.textContent = 'Sin stock de este color';
      stockMsg.style.color = 'var(--color-danger)';
    } else if (stock < 20) {
      stockMsg.textContent = 'Quedan pocas unidades de este color';
      stockMsg.style.color = 'var(--color-warning)';
    } else {
      stockMsg.textContent = '';
    }

    addBtn.disabled = stock === 0;
    addBtn.innerHTML = stock === 0
      ? 'Sin stock'
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
        </svg> Agregar al carrito`;

    qtyInput.disabled = stock === 0;
    content.querySelector('#pv-qty-minus').disabled = stock === 0;
    content.querySelector('#pv-qty-plus').disabled  = stock === 0;
  };

  const updateSavings = () => {
    const qty = parseInt(qtyInput.value) || 1;
    const sp  = section === 'mayorista' ? product.price_mayo : product.price_pro;
    const pub = product.price_public || 0;
    savingsEl.textContent = pub > sp
      ? `Ahorrás ${fmt((pub - sp) * qty)} vs precio público`
      : '';
  };

  // ── goTo: change the large image shown ───────────────────
  const goTo = (idx) => {
    if (!images.length) return;
    currentViewIdx = ((idx % images.length) + images.length) % images.length;
    const img = images[currentViewIdx];

    if (mainImg && img) {
      mainImg.style.opacity = '0';
      mainImg.src = productImgSrc(product.slug, img.filename);
      mainImg.onload = () => { mainImg.style.opacity = '1'; };
    }

    content.querySelectorAll('.pv-thumb').forEach((t, i) => {
      t.classList.toggle('active', i === currentViewIdx);
    });

    // If it's a variant, update selectedVariantIdx and swatches
    if (img && img.image_type !== 'context') {
      selectedVariantIdx = currentViewIdx;
      content.querySelectorAll('.js-pv-swatch').forEach(s => {
        s.classList.toggle('active', parseInt(s.dataset.idx) === selectedVariantIdx);
      });
      const swatchName = content.querySelector('#pv-swatch-name');
      if (swatchName) swatchName.textContent = img.color_name || '';
    }

    const isViewingContext = img && img.image_type === 'context';
    updateStockState(selectedVariantIdx, isViewingContext);
    updateSavings();
  };

  // Helper: build context-only lightbox array
  const contextLightboxImgs = () => images
    .map((im, idx) => im.image_type === 'context'
      ? { src: productImgSrc(product.slug, im.filename), originalIdx: idx }
      : null)
    .filter(Boolean);

  // ── Thumbnail strip clicks ────────────────────────────────
  content.querySelectorAll('.pv-thumb').forEach((thumb, i) => {
    thumb.addEventListener('click', (e) => {
      if (e.target.closest('.ctx-thumb-zoom')) {
        // Zoom icon → open lightbox
        const ctxImgs = contextLightboxImgs();
        const start = ctxImgs.findIndex(c => c.originalIdx === i);
        window.openLightbox(ctxImgs, start >= 0 ? start : 0);
      } else {
        goTo(i); // variant or context → show in gallery
      }
    });
  });

  // ── Prev / Next ──────────────────────────────────────────
  content.querySelector('.pv-prev')?.addEventListener('click', () => goTo(currentViewIdx - 1));
  content.querySelector('.pv-next')?.addEventListener('click', () => goTo(currentViewIdx + 1));

  // ── Context mini-thumbnails → change main image ──────────────
  content.querySelectorAll('.js-pv-context-mini').forEach(btn => {
    btn.addEventListener('click', () => goTo(parseInt(btn.dataset.idx)));
  });

  // ── "Ver fotos detalladas" button ────────────────────────────
  content.querySelector('#pv-context-btn')?.addEventListener('click', () => {
    window.openLightbox(contextLightboxImgs(), 0);
  });

  // ── Modal variant swatches ───────────────────────────────
  content.querySelectorAll('.js-pv-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => goTo(parseInt(swatch.dataset.idx)));
  });

  // ── Qty controls ─────────────────────────────────────────
  qtyInput.addEventListener('input', () => {
    const stock = getVariantStock(product, selectedVariantIdx);
    let qty = parseInt(qtyInput.value) || 1;
    if (stock > 0 && qty > stock) { qtyInput.value = stock; qty = stock; }
    updateSavings();
  });

  content.querySelector('#pv-qty-minus')?.addEventListener('click', () => {
    qtyInput.value = Math.max(1, (parseInt(qtyInput.value) || 1) - 1);
    updateSavings();
  });

  content.querySelector('#pv-qty-plus')?.addEventListener('click', () => {
    const stock   = getVariantStock(product, selectedVariantIdx);
    const current = parseInt(qtyInput.value) || 1;
    if (current >= stock) { window.showStockTooltip(pvQtyRow); return; }
    qtyInput.value = current + 1;
    updateSavings();
  });

  addBtn?.addEventListener('click', () => {
    const qty = parseInt(qtyInput.value) || 1;
    window.addToCart(product.id, qty, section, selectedVariantIdx);
    closePreview();
  });

  // ── Initial render ────────────────────────────────────────
  goTo(0); // muestra la primera imagen según sort_order
  updateSavings();
};

// ─── Lightbox (context photos fullscreen) ────────────────────
window.openLightbox = function(imgs, startIdx) {
  // Remove any previous instance to avoid listener accumulation
  document.getElementById('lightbox-overlay')?.remove();

  let currentIdx = ((startIdx || 0) + imgs.length) % imgs.length;
  const multi = imgs.length > 1;

  const overlay = document.createElement('div');
  overlay.id = 'lightbox-overlay';
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML = `
    <button class="lightbox-close" aria-label="Cerrar">✕</button>
    ${multi ? `<button class="lightbox-nav lightbox-prev" aria-label="Anterior">&#8249;</button>` : ''}
    <div class="lightbox-img-wrap">
      <img class="lightbox-img" src="${imgs[currentIdx].src}" alt="">
    </div>
    ${multi ? `<button class="lightbox-nav lightbox-next" aria-label="Siguiente">&#8250;</button>` : ''}
    ${multi ? `<div class="lightbox-counter">${currentIdx + 1} / ${imgs.length}</div>` : ''}
  `;
  document.body.appendChild(overlay);

  const imgEl   = overlay.querySelector('.lightbox-img');
  const counter = overlay.querySelector('.lightbox-counter');
  const prevBtn = overlay.querySelector('.lightbox-prev');
  const nextBtn = overlay.querySelector('.lightbox-next');

  const goTo = (idx) => {
    currentIdx = ((idx % imgs.length) + imgs.length) % imgs.length;
    imgEl.style.opacity = '0';
    imgEl.src = imgs[currentIdx].src;
    imgEl.onload = () => { imgEl.style.opacity = '1'; };
    if (counter) counter.textContent = `${currentIdx + 1} / ${imgs.length}`;
  };

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };

  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (multi && e.key === 'ArrowLeft')  goTo(currentIdx - 1);
    if (multi && e.key === 'ArrowRight') goTo(currentIdx + 1);
  };

  overlay.querySelector('.lightbox-close').addEventListener('click', close);
  prevBtn?.addEventListener('click', () => goTo(currentIdx - 1));
  nextBtn?.addEventListener('click', () => goTo(currentIdx + 1));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
};

function closePreview() {
  const overlay = document.getElementById('preview-modal');
  if (overlay) overlay.classList.add('hidden');
  const sidebar = document.getElementById('cart-sidebar');
  if (!sidebar?.classList.contains('open')) {
    document.body.style.overflow = '';
  }
}

// ─── Storage ──────────────────────────────────────────────────
function loadCartFromStorage() {
  try {
    const saved = localStorage.getItem('pc3_carts');
    if (!saved) return;
    const parsed = JSON.parse(saved);

    const migrate = (cart) => {
      if (!cart) return {};
      const migrated = {};
      for (const [key, item] of Object.entries(cart)) {
        // Old format: key is a plain number (productId). New: "productId_variantIdx"
        const newKey = String(key).includes('_') ? key : `${key}_${item.variantIdx || 0}`;
        migrated[newKey] = {
          ...item,
          variantIdx: item.variantIdx || 0,
          colorName: item.colorName || ''
        };
      }
      return migrated;
    };

    state.carts = {
      profesional: migrate(parsed.profesional),
      mayorista: migrate(parsed.mayorista)
    };
  } catch (e) { /* ignore corrupt storage */ }
}

function saveCartToStorage() {
  localStorage.setItem('pc3_carts', JSON.stringify(state.carts));
}

window.saveCartToStorage = saveCartToStorage;
