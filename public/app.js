// Store Products Catalog
const PRODUCTS = [
  { id: 'prod_1', name: 'AeroPulse Noise-Canceling Headphones', price: 2490, icon: '🎧', description: 'Studio-grade spatial audio with active noise cancellation and 40h battery.' },
  { id: 'prod_2', name: 'CyberKey Mechanical Keyboard', price: 1850, icon: '⌨️', description: 'Hot-swappable RGB mechanical switches with gasket mount acoustic dampening.' },
  { id: 'prod_3', name: 'UltraFit OLED Smart Watch', price: 3200, icon: '⌚', description: 'Curved AMOLED display, blood oxygen tracking, and 14-day battery life.' },
  { id: 'prod_4', name: 'VoltCore 65W GaN Fast Charger', price: 890, icon: '🔌', description: 'Ultra-compact triple port USB-C GaN charger for laptop and mobile.' }
];

let cart = [
  { ...PRODUCTS[0], quantity: 1 }
];

let currentConfig = {
  merchantID: 'JT01',
  mode: 'simulator'
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  renderProducts();
  updateCartUI();
  fetchConfig();
  fetchOrders();
  fetchInspectorLogs();

  // Poll for live updates every 3 seconds
  setInterval(() => {
    fetchOrders();
    fetchInspectorLogs();
  }, 3000);
});

// Switch Dashboard Tabs
function switchPanel(panelId) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => {
    if (!b.classList.contains('cart-btn')) b.classList.remove('active');
  });

  const activePanel = document.getElementById(`panel-${panelId}`);
  if (activePanel) activePanel.classList.add('active');

  const btn = event?.currentTarget;
  if (btn) btn.classList.add('active');
}

// Render Products Grid
function renderProducts() {
  const grid = document.getElementById('productsGrid');
  grid.innerHTML = PRODUCTS.map(p => `
    <div class="product-card">
      <div class="product-image">${p.icon}</div>
      <div class="product-body">
        <h3 class="product-title">${p.name}</h3>
        <p class="product-desc">${p.description}</p>
        <div class="product-footer">
          <span class="product-price">THB ${p.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          <button class="add-cart-btn" onclick="addToCart('${p.id}')">🛒 Add to Cart</button>
        </div>
      </div>
    </div>
  `).join('');
}

// Cart Logic
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
          <div style="font-weight: 600;">${item.name}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted);">THB ${item.price.toLocaleString()} x ${item.quantity}</div>
        </div>
        <div style="font-weight: 700; color: #fff;">
          THB ${(item.price * item.quantity).toLocaleString('en-US', { minimumFractionDigits: 2 })}
        </div>
      </div>
    `).join('');
  }

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  document.getElementById('subtotalAmount').innerText = `THB ${subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  document.getElementById('totalAmount').innerText = `THB ${subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

function openCart() {
  document.getElementById('cartModal').classList.add('active');
}

function closeCart() {
  document.getElementById('cartModal').classList.remove('active');
}

// Proceed to 2C2P Checkout
async function proceedToCheckout() {
  if (cart.length === 0) {
    alert('Please add at least one item to cart before checkout.');
    return;
  }

  const btn = document.getElementById('checkoutBtn');
  btn.disabled = true;
  btn.innerHTML = '⏳ Initializing 2C2P Hosted Page...';

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
        currencyCode: 'THB'
      })
    });

    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Checkout creation failed');

    // Redirect user to 2C2P Hosted Payment Page URL
    console.log('Redirecting to 2C2P Hosted Payment URL:', data.webPaymentUrl);
    window.location.href = data.webPaymentUrl;
  } catch (err) {
    alert(`Checkout Error: ${err.message}`);
    btn.disabled = false;
    btn.innerHTML = '🔒 Pay via 2C2P Hosted Page';
  }
}

// Config Modal & Fetch
async function fetchConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    currentConfig = data;

    document.getElementById('merchantIdText').innerText = data.merchantID;
    document.getElementById('modeText').innerText = data.mode === 'simulator' 
      ? '2C2P Hosted Simulator Mode (Local Test)' 
      : '2C2P Live Sandbox Mode';

    document.getElementById('cfgMerchantId').value = data.merchantID;
    document.getElementById('cfgApiUrl').value = data.apiUrl;
    document.getElementById('cfgMode').value = data.mode;
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
  const secretKey = document.getElementById('cfgSecretKey').value;
  const apiUrl = document.getElementById('cfgApiUrl').value;
  const mode = document.getElementById('cfgMode').value;

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchantID, secretKey: secretKey || undefined, apiUrl, mode })
    });
    if (res.ok) {
      alert('2C2P Gateway Configuration Saved!');
      closeConfigModal();
      fetchConfig();
    }
  } catch (err) {
    alert(`Save error: ${err.message}`);
  }
}

// Fetch Orders
async function fetchOrders() {
  try {
    const res = await fetch('/api/orders');
    const orders = await res.json();
    const container = document.getElementById('ordersList');

    if (!orders || orders.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No checkout orders created yet.</div>`;
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
              <span style="font-weight: 700; font-size: 1rem;">${o.invoiceNo}</span>
              <span style="font-size: 0.8rem; color: var(--text-muted); margin-left: 10px;">${o.description}</span>
            </div>
            <span style="background: ${statusColor}22; color: ${statusColor}; font-size: 0.75rem; font-weight: 700; padding: 4px 10px; border-radius: 12px; text-transform: uppercase;">
              ${o.status}
            </span>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; font-size: 0.85rem; margin-top: 10px; color: var(--text-muted);">
            <div><strong>Amount:</strong> THB ${o.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
            <div><strong>Customer:</strong> ${o.customerName || 'N/A'}</div>
            <div><strong>Txn Ref:</strong> <code>${o.transactionRef || 'Pending'}</code></div>
            <div><strong>Payment Channel:</strong> ${o.paymentChannel || '2C2P Hosted'}</div>
            <div><strong>Created:</strong> ${new Date(o.createdAt).toLocaleTimeString()}</div>
          </div>

          ${o.webPaymentUrl ? `
            <div style="margin-top: 12px; pt-2; border-top: 1px solid var(--border-color); font-size: 0.8rem;">
              <strong>Hosted Payment URL:</strong> 
              <a href="${o.webPaymentUrl}" target="_blank" style="color: #60a5fa; word-break: break-all;">${o.webPaymentUrl}</a>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('Fetch orders error:', e);
  }
}

// Fetch Inspector Logs
async function fetchInspectorLogs() {
  try {
    const res = await fetch('/api/logs');
    const logs = await res.json();
    const container = document.getElementById('inspectorLogs');

    if (!logs || logs.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No API logs captured yet. Complete a checkout to see live payloads.</div>`;
      return;
    }

    container.innerHTML = logs.map(l => `
      <div class="log-card">
        <div class="log-header">
          <div>
            <span class="log-tag ${l.type.toLowerCase()}">${l.type}</span>
            <strong style="margin-left: 8px;">${l.title}</strong>
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
