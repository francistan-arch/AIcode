const PRODUCTS = [
  { id: 'prod_red_plus', name: 'Red+ Subscription Membership', price: 99.00, image: 'images/red_plus_card.png', description: 'Exclusive AirAsia Rewards Red+ membership. Earn 10x airasia points, free seat vouchers, and priority perks.' },
  { id: 'prod_red_plus_premium', name: 'Red+ Premium VIP Pass', price: 199.00, image: 'images/red_vip_pass.png', description: 'Unlimited ASEAN flight discounts, 15x points multiplier, lounge access, and zero booking fees.' },
  { id: 'prod_points_5k', name: '5,000 airasia points Booster', price: 150.00, image: 'images/points_booster.png', description: 'Instant top-up of 5,000 airasia points credited directly to your AirAsia Rewards member ID.' },
  { id: 'prod_flight_pass', name: 'AirAsia ASEAN Flight Pass', price: 499.00, image: 'images/flight_pass.png', description: 'Fly across Malaysia, Thailand, Indonesia, Philippines, and Vietnam with zero base fare redemptions.' }
];

let cart = [
  { ...PRODUCTS[0], quantity: 1 }
];

let currentConfig = {
  gatewayType: '2c2p-paco',
  merchantID: 'AirAsiaRewards',
  mode: 'simulator'
};

let loadedKeysData = {};

document.addEventListener('DOMContentLoaded', () => {
  renderProducts();
  updateCartUI();
  fetchConfig();
  fetchOrders();
  fetchInspectorLogs();
  fetchKeysStatus();

  setInterval(() => {
    fetchOrders();
    fetchInspectorLogs();
  }, 3000);
});

/* Accessibility Controls */
function setFontSize(size) {
  document.documentElement.setAttribute('data-fontsize', size);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.innerText = newTheme === 'dark' ? '☀️' : '🌙';
}

function switchPanel(panelId) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => {
    if (!b.classList.contains('cart-btn')) b.classList.remove('active');
  });

  const activePanel = document.getElementById(`panel-${panelId}`);
  if (activePanel) activePanel.classList.add('active');

  if (event?.currentTarget) event.currentTarget.classList.add('active');

  if (panelId === 'keys') fetchKeysStatus();
}

/* Dynamic Hover Ambient Backdrop Handlers */
function setAmbientBackdrop(imageUrl) {
  const bg = document.getElementById('ambientBackdrop');
  if (!bg) return;
  bg.style.backgroundImage = `url('${imageUrl}')`;
  bg.classList.add('active');
}

function clearAmbientBackdrop() {
  const bg = document.getElementById('ambientBackdrop');
  if (!bg) return;
  bg.classList.remove('active');
}

function renderProducts() {
  const grid = document.getElementById('productsGrid');
  const tagMap = {
    'prod_red_plus': '🔥 10x Points Multiplier',
    'prod_red_plus_premium': '✨ VIP Unlimited Pass',
    'prod_points_5k': '⭐ Points Booster',
    'prod_flight_pass': '✈️ ASEAN Unlimited'
  };

  grid.innerHTML = PRODUCTS.map(p => `
    <div class="product-card" onmouseenter="setAmbientBackdrop('${p.image}')" onmouseleave="clearAmbientBackdrop()">
      <div class="product-image" style="background-image: url('${p.image}'); background-size: cover; background-position: center; height: 210px;">
        <span class="multiplier-tag">${tagMap[p.id] || 'Red+ Member Offer'}</span>
      </div>
      <div class="product-body">
        <h3 class="product-title">${p.name}</h3>
        <p class="product-desc">${p.description}</p>
        <div class="product-footer">
          <span class="product-price">MYR ${p.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          <button class="add-cart-btn" onclick="addToCart('${p.id}')">🛒 Subscribe / Buy</button>
        </div>
      </div>
    </div>
  `).join('');
}

function addToCart(productId) {
  const prod = PRODUCTS.find(p => p.id === productId);
  if (!prod) return;

  const existing = cart.find(item => item.id === productId);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({ ...prod, quantity: 1 });
  }

  updateCartUI();
  openCart();
}

function updateCartUI() {
  const totalCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  document.getElementById('cartBadge').innerText = totalCount;

  const list = document.getElementById('cartItemsList');
  if (cart.length === 0) {
    list.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">Your cart is empty</div>`;
  } else {
    list.innerHTML = cart.map(item => `
      <div class="cart-item">
        <div>
          <div style="font-weight: 700; color: var(--text-main);">${item.name}</div>
          <div style="font-size: 0.85rem; color: var(--text-muted);">MYR ${item.price.toLocaleString()} x ${item.quantity}</div>
        </div>
        <div style="font-weight: 800; color: var(--text-main);">
          MYR ${(item.price * item.quantity).toLocaleString('en-US', { minimumFractionDigits: 2 })}
        </div>
      </div>
    `).join('');
  }

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  document.getElementById('subtotalAmount').innerText = `MYR ${subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  document.getElementById('totalAmount').innerText = `MYR ${subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

function openCart() {
  document.getElementById('cartModal').classList.add('active');
}

function closeCart() {
  document.getElementById('cartModal').classList.remove('active');
}

async function proceedToCheckout() {
  if (cart.length === 0) {
    alert('Please add at least one item to cart before checkout.');
    return;
  }

  const btn = document.getElementById('checkoutBtn');
  btn.disabled = true;
  btn.innerHTML = `⏳ Connecting to 2C2P Gateway...`;

  const custName = document.getElementById('custName').value;
  const custEmail = document.getElementById('custEmail').value;

  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: cart,
        customerName: custName,
        customerEmail: custEmail,
        currencyCode: 'MYR'
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Checkout request failed');

    // Immediate silent redirect to 2C2P payment page
    window.location.href = data.webPaymentUrl;
  } catch (err) {
    alert(`2C2P Checkout Error: ${err.message}`);
    btn.disabled = false;
    btn.innerHTML = '🔒 Proceed to Checkout';
  }
}

async function fetchKeysStatus() {
  try {
    const res = await fetch('/api/keys-status');
    const data = await res.json();
    if (!data.success || !data.keys) return;

    loadedKeysData = data.keys;
    const grid = document.getElementById('keysGrid');

    grid.innerHTML = Object.values(data.keys).map(k => {
      const isWarn = k.isDuplicate;
      const statusClass = isWarn ? 'warn' : 'ok';
      const statusLabel = isWarn ? 'Duplicate Key Warning' : 'Active & Unique';

      return `
        <div class="key-card ${isWarn ? 'duplicate-warning' : ''}">
          <div class="key-card-header">
            <div>
              <div class="key-title">${k.label}</div>
              <div style="font-size: 0.85rem; color: var(--text-dim); margin-top: 2px;">📁 <code>keys/${k.fileName}</code></div>
            </div>
            <span class="key-badge ${statusClass}">${statusLabel}</span>
          </div>

          <div style="font-size: 0.85rem; color: var(--text-muted);">
            SHA256 Fingerprint:
          </div>
          <div class="key-hash">${k.hash || 'N/A'}</div>

          ${isWarn ? `
            <div style="font-size: 0.85rem; color: var(--warning); line-height: 1.4;">
              ⚠️ <strong>Action Needed:</strong> This file is currently identical to <code>${k.duplicateWith.join(', ')}</code>. Replace this file with 2C2P's public key from Oliver.
            </div>
          ` : ''}

          <button class="copy-btn" onclick="copyKeyContent('${k.key}')">
            📋 Copy PEM Public Key Content
          </button>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('Fetch keys error:', e);
  }
}

function copyKeyContent(keyKey) {
  const item = loadedKeysData[keyKey];
  if (!item || !item.pem) {
    alert('Key content not available.');
    return;
  }
  navigator.clipboard.writeText(item.pem).then(() => {
    alert(`Copied ${item.fileName} content to clipboard!`);
  }).catch(err => {
    alert('Failed to copy: ' + err);
  });
}

async function fetchConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    currentConfig = data;

    document.getElementById('merchantIdText').innerText = data.merchantID;
    document.getElementById('modeText').innerText = data.mode === 'sandbox' ? 'Live 2C2P Gateway (Sandbox)' : 'Local Payment Simulator';

    document.getElementById('cfgMerchantId').value = data.merchantID;
    document.getElementById('cfgMode').value = data.mode;
    if (data.pacoApiUrl) document.getElementById('cfgPacoApiUrl').value = data.pacoApiUrl;
  } catch (e) {
    console.error('Failed to fetch config:', e);
  }
}

function toggleMode() {
  document.getElementById('configModal').classList.add('active');
}

function closeConfigModal() {
  document.getElementById('configModal').classList.remove('active');
}

async function saveConfig() {
  const merchantID = document.getElementById('cfgMerchantId').value;
  const pacoApiUrl = document.getElementById('cfgPacoApiUrl').value;
  const mode = document.getElementById('cfgMode').value;

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gatewayType: '2c2p-paco', merchantID, pacoApiUrl, mode })
    });
    if (res.ok) {
      alert('Gateway Settings Saved!');
      closeConfigModal();
      fetchConfig();
    }
  } catch (err) {
    alert(`Save error: ${err.message}`);
  }
}

async function fetchOrders() {
  try {
    const res = await fetch('/api/orders');
    const orders = await res.json();
    const container = document.getElementById('ordersList');

    if (!orders || orders.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No orders initialized yet.</div>`;
      return;
    }

    container.innerHTML = orders.map(o => {
      let statusColor = 'var(--warning)';
      if (o.status === 'COMPLETED') statusColor = 'var(--success)';
      if (o.status === 'FAILED' || o.status === 'ERROR') statusColor = 'var(--danger)';

      return `
        <div class="log-card">
          <div class="log-header">
            <div>
              <span style="font-weight: 800; font-size: 1.1rem; color: var(--text-main);">${o.invoiceNo}</span>
              <span style="font-size: 0.75rem; background: #0284c7; color: #fff; padding: 3px 10px; border-radius: 12px; margin-left: 8px; font-weight: 700;">
                2C2P PACO v2.0
              </span>
            </div>
            <span style="background: ${statusColor}22; color: ${statusColor}; font-size: 0.8rem; font-weight: 800; padding: 4px 12px; border-radius: 12px; text-transform: uppercase;">
              ${o.status} (${o.respCode || 'PENDING'})
            </span>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; font-size: 0.9rem; margin-top: 10px; color: var(--text-muted);">
            <div><strong>Amount:</strong> MYR ${o.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
            <div><strong>Customer:</strong> ${o.customerName || 'N/A'}</div>
            <div><strong>Txn Ref:</strong> <code style="font-family: var(--font-mono); color: #38bdf8;">${o.transactionRef || 'Pending'}</code></div>
            <div><strong>Channel:</strong> ${o.paymentChannel || '2C2P Hosted Gateway'}</div>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('Fetch orders error:', e);
  }
}

async function fetchInspectorLogs() {
  try {
    const res = await fetch('/api/logs');
    const logs = await res.json();
    const container = document.getElementById('inspectorLogs');

    if (!logs || logs.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No API logs captured yet.</div>`;
      return;
    }

    container.innerHTML = logs.map(l => `
      <div class="log-card">
        <div class="log-header">
          <div>
            <span class="log-tag ${l.type.toLowerCase()}">${l.type}</span>
            <strong style="margin-left: 8px; font-size: 1.05rem; color: var(--text-main);">${l.title}</strong>
          </div>
          <span class="log-time">${new Date(l.timestamp).toLocaleTimeString()}</span>
        </div>
        <pre class="code-block">${JSON.stringify(l.details, null, 2)}</pre>
      </div>
    `).join('');
  } catch (e) {
    console.error('Fetch logs error:', e);
  }
}

async function clearLogs() {
  await fetch('/api/logs', { method: 'DELETE' });
  fetchInspectorLogs();
}
