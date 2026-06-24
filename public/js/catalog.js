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
  carts: { profesional: {}, mayorista: {} }
};

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
});

// ─── Theme ────────────────────────────────────────────────────
function applyTheme(theme) {
  const isLight = theme === 'light';
  document.documentElement.classList.toggle('light', isLight);
  document.body.classList.toggle('light', isLight);
}

function setupTheme() {
  const saved = localStorage.getItem('pc3_theme') || 'dark';
  applyTheme(saved);
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const next = document.body.classList.contains('light') ? 'dark' : 'light';
    applyTheme(next);
    localStorage.setItem('pc3_theme', next);
  });
}

// ─── Section Tabs ─────────────────────────────────────────────
function setupSectionTabs() {
  document.querySelectorAll('.section-card').forEach(card => {
    card.addEventListener('click', () => {
      const section = card.dataset.section;
      if (section === state.activeSection) return;
      state.activeSection = section;

      document.querySelectorAll('.section-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');

      document.body.classList.remove('section-profesional', 'section-mayorista');
      document.body.classList.add(`section-${section}`);

      renderProductList();
      updateCartUI();
      updateSectionInfo();
    });
  });
}

function updateSectionInfo() {
  const minPro  = parseInt(state.settings.min_purchase_pro)  || 0;
  const minMayo = parseInt(state.settings.min_purchase_mayo) || 0;

  const proMinEl  = document.getElementById('section-min-label-pro');
  const mayoMinEl = document.getElementById('section-min-label-mayo');

  if (proMinEl)  proMinEl.textContent  = `Mín. ${fmt(minPro)}`;
  if (mayoMinEl) mayoMinEl.textContent = `Mín. ${fmt(minMayo)}`;

  window.updateFabCart?.();
}

// ─── Floating Action Buttons ───────────────────────────────────
function setupFabs() {
  const waFab = document.getElementById('fab-whatsapp');
  if (waFab && state.settings.whatsapp_number) {
    waFab.href = `https://wa.me/${state.settings.whatsapp_number}`;
  }

  document.getElementById('fab-cart-pro')?.addEventListener('click', () => {
    state.activeCartTab = 'profesional';
    const sidebar = document.getElementById('cart-sidebar');
    const overlay = document.getElementById('cart-overlay');
    if (sidebar) { sidebar.classList.add('open'); document.body.style.overflow = 'hidden'; }
    if (overlay) overlay.classList.add('visible');
    updateCartTabUI();
    renderCartSidebar('profesional');
  });

  document.getElementById('fab-cart-mayo')?.addEventListener('click', () => {
    state.activeCartTab = 'mayorista';
    const sidebar = document.getElementById('cart-sidebar');
    const overlay = document.getElementById('cart-overlay');
    if (sidebar) { sidebar.classList.add('open'); document.body.style.overflow = 'hidden'; }
    if (overlay) overlay.classList.add('visible');
    updateCartTabUI();
    renderCartSidebar('mayorista');
  });
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
    const items = Object.values(state.carts[s] || {});
    const count = items.reduce((sum, i) => sum + i.quantity, 0);
    const badge = document.getElementById(badgeId);
    const sub   = document.getElementById(subId);

    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    }
    if (sub) {
      if (count === 0) {
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
  const images = product.images || [];

  const slidesHtml = images.length
    ? images.map((img, i) => `
        <div class="pv-slide ${i === 0 ? 'active' : ''}" data-idx="${i}">
          <img src="${productImgSrc(product.slug, img.filename)}" alt="${product.name}">
        </div>`).join('')
    : `<div class="pv-slide active"><div class="pv-no-image">Sin imagen</div></div>`;

  const dotsHtml = images.length > 1
    ? `<div class="pv-dots">${images.map((_, i) =>
        `<button class="pv-dot ${i === 0 ? 'active' : ''}" data-idx="${i}"></button>`).join('')}</div>`
    : '';

  const navHtml = images.length > 1
    ? `<button class="pv-nav pv-prev">&#8249;</button>
       <button class="pv-nav pv-next">&#8250;</button>`
    : '';

  const sectionPrice = section === 'mayorista' ? product.price_mayo : product.price_pro;
  const sectionLabel = section === 'mayorista' ? 'Precio Mayorista' : 'Precio Profesional';
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

  const stockBadge = product.stock === 0
    ? `<span class="pv-stock-badge pv-stock-out">Sin stock</span>`
    : product.stock <= 5
      ? `<span class="pv-stock-badge pv-stock-low">Stock: ${product.stock}</span>`
      : '';

  content.innerHTML = `
    <div class="pv-gallery">
      <div class="pv-slides" id="pv-slides">${slidesHtml}</div>
      ${navHtml}
      ${dotsHtml}
    </div>
    <div class="pv-info">
      <div class="pv-title-row">
        <h2 class="pv-name">${product.name}</h2>
        ${stockBadge}
      </div>
      ${product.contents ? `<div class="pv-contents">📦 ${product.contents}</div>` : ''}
      ${product.description ? `<div class="pv-description">${product.description}</div>` : ''}

      <div class="pv-pricing">
        ${priceInfo}
      </div>

      <div class="pv-actions">
        <div class="pv-qty-row">
          <button class="pv-qty-btn" id="pv-qty-minus">−</button>
          <input type="number" class="pv-qty-input" id="pv-qty-input" value="1" min="1" max="9999">
          <button class="pv-qty-btn" id="pv-qty-plus">+</button>
          <span class="pv-qty-unit">un</span>
        </div>
        <div class="pv-savings" id="pv-savings"></div>
        <button class="pv-add-btn" id="pv-add-btn" data-product-id="${product.id}" ${product.stock === 0 ? 'disabled' : ''}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
          </svg>
          ${product.stock === 0 ? 'Sin stock' : 'Agregar al carrito'}
        </button>
      </div>
    </div>
  `;

  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Setup gallery navigation
  let currentSlide = 0;
  const slides = content.querySelectorAll('.pv-slide');
  const dots = content.querySelectorAll('.pv-dot');

  const goTo = (idx) => {
    currentSlide = (idx + slides.length) % slides.length;
    slides.forEach((s, i) => s.classList.toggle('active', i === currentSlide));
    dots.forEach((d, i) => d.classList.toggle('active', i === currentSlide));
  };

  content.querySelector('.pv-prev')?.addEventListener('click', () => goTo(currentSlide - 1));
  content.querySelector('.pv-next')?.addEventListener('click', () => goTo(currentSlide + 1));
  dots.forEach((dot, i) => dot.addEventListener('click', () => goTo(i)));

  // Qty + add
  const qtyInput = content.querySelector('#pv-qty-input');
  const savingsEl = content.querySelector('#pv-savings');
  const addBtn = content.querySelector('#pv-add-btn');

  const updateSavings = () => {
    const qty = parseInt(qtyInput.value) || 1;
    const sp = section === 'mayorista' ? product.price_mayo : product.price_pro;
    const pub = product.price_public || 0;
    if (pub > sp) {
      savingsEl.textContent = `Ahorrás ${fmt((pub - sp) * qty)} vs precio público`;
    } else {
      savingsEl.textContent = '';
    }
  };

  qtyInput.addEventListener('input', updateSavings);
  content.querySelector('#pv-qty-minus')?.addEventListener('click', () => {
    qtyInput.value = Math.max(1, (parseInt(qtyInput.value) || 1) - 1);
    updateSavings();
  });
  content.querySelector('#pv-qty-plus')?.addEventListener('click', () => {
    qtyInput.value = (parseInt(qtyInput.value) || 1) + 1;
    updateSavings();
  });

  addBtn?.addEventListener('click', () => {
    const qty = parseInt(qtyInput.value) || 1;
    window.addToCart(product.id, qty, section, currentSlide);
    closePreview();
  });

  updateSavings();
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
