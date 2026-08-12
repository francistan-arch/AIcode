const express = require('express');
const axios = require('axios');
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const TwoC2PService = require('./lib/2c2p');
const PacoService = require('./lib/paco');
const { getPrivateKey, getPublicKey, PRIVATE_KEY_PATH, PUBLIC_KEY_PATH } = require('./lib/keyManager');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// In-Memory Database & Inspector Logs
const orders = new Map();
const inspectorLogs = [];
const activeTokens = new Map();

let currentConfig = {
  gatewayType: process.env.GATEWAY_TYPE || '2c2p-paco',
  merchantID: process.env.PACO_PARTNER_ID || process.env['2C2P_MERCHANT_ID'] || 'PACO_PARTNER_DEMO',
  apiUrl: process.env['2C2P_API_URL'] || 'https://sandbox-pgw.2c2p.com/payment/4.3/paymentToken',
  pacoApiUrl: process.env.PACO_API_URL || 'https://core.demo-paco.2c2p.com/paco/v1/prepaymentui',
  mode: process.env.MODE || 'simulator'
};

function get2C2PInstance() {
  return new TwoC2PService({
    ...currentConfig,
    secretKey: process.env['2C2P_SECRET_KEY'] || '72A910E124A4B9448D3528A6D3F9514300E634A9F200A51D14187D397C11C3D6'
  });
}

function getPacoInstance() {
  return new PacoService({
    partnerId: currentConfig.merchantID,
    apiUrl: currentConfig.pacoApiUrl,
    mode: currentConfig.mode,
    privatePem: getPrivateKey(),
    publicPem: getPublicKey()
  });
}

function logEvent(type, title, details) {
  const log = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    type,
    title,
    details
  };
  inspectorLogs.unshift(log);
  if (inspectorLogs.length > 100) inspectorLogs.pop();
  return log;
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// 1. Config & Keys API
app.get('/api/config', (req, res) => {
  res.json({
    gatewayType: currentConfig.gatewayType,
    merchantID: currentConfig.merchantID,
    signatureAlgorithm: 'RS256 (RSA 2048-bit PEM)',
    privateKeyPath: PRIVATE_KEY_PATH,
    publicKeyPath: PUBLIC_KEY_PATH,
    apiUrl: currentConfig.apiUrl,
    pacoApiUrl: currentConfig.pacoApiUrl,
    mode: currentConfig.mode
  });
});

app.post('/api/config', (req, res) => {
  const { gatewayType, merchantID, apiUrl, pacoApiUrl, mode } = req.body;
  if (gatewayType && ['2c2p-pgw', '2c2p-paco'].includes(gatewayType)) currentConfig.gatewayType = gatewayType;
  if (merchantID) currentConfig.merchantID = merchantID;
  if (apiUrl) currentConfig.apiUrl = apiUrl;
  if (pacoApiUrl) currentConfig.pacoApiUrl = pacoApiUrl;
  if (mode && ['simulator', 'sandbox'].includes(mode)) currentConfig.mode = mode;

  logEvent('CONFIG_UPDATE', 'Gateway Configuration Updated', { currentConfig });
  res.json({ success: true, message: 'Configuration updated successfully', config: currentConfig });
});

// 2. PACO `prepaymentui` Request API (RS256 Signed)
app.post('/api/paco/prepaymentui', async (req, res) => {
  try {
    const { items, customerName, customerEmail, currencyCode = 'MYR' } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart must contain at least one item' });
    }

    const totalAmount = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const invoiceNo = `INV-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const description = items.map(i => `${i.name} x${i.quantity}`).join(', ');
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const paco = getPacoInstance();
    const result = await paco.requestPrePaymentUi({
      invoiceNo,
      description,
      amount: totalAmount,
      currencyCode,
      customerName,
      customerEmail
    }, baseUrl);

    const newOrder = {
      invoiceNo,
      description,
      items,
      amount: totalAmount,
      currencyCode,
      customerName,
      customerEmail,
      gateway: '2c2p-paco',
      status: 'PRE_PAYMENT_UI',
      prepaymentUiToken: result.prepaymentUiToken,
      webPaymentUrl: result.webPaymentUrl,
      mode: result.mode,
      signatureAlgorithm: 'RS256',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      events: []
    };

    orders.set(invoiceNo, newOrder);
    if (result.prepaymentUiToken) {
      activeTokens.set(result.prepaymentUiToken, newOrder);
    }

    logEvent('PREPAYMENT_UI_REQUEST', `PACO RS256 PrePaymentUI Requested (${invoiceNo})`, {
      gateway: '2c2p-paco',
      signatureAlgorithm: 'RS256 (RSA PEM)',
      invoiceNo,
      amount: totalAmount,
      currencyCode,
      availablePaymentMethods: result.availablePaymentMethods,
      prepaymentUiToken: result.prepaymentUiToken,
      webPaymentUrl: result.webPaymentUrl,
      rawRequestPayload: result.rawRequestPayload,
      requestJwt: result.requestJwt,
      responseJwt: result.responseJwt,
      decodedResponse: result.decodedResponse
    });

    res.json({
      success: true,
      invoiceNo,
      amount: totalAmount,
      currencyCode,
      prepaymentUiToken: result.prepaymentUiToken,
      availablePaymentMethods: result.availablePaymentMethods,
      webPaymentUrl: result.webPaymentUrl,
      rawRequestPayload: result.rawRequestPayload,
      requestJwt: result.requestJwt,
      responseJwt: result.responseJwt,
      decodedResponse: result.decodedResponse
    });
  } catch (err) {
    console.error('PrePaymentUI error:', err);
    logEvent('PREPAYMENT_UI_ERROR', 'PACO PrePaymentUI Request Failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// 3. Checkout API
app.post('/api/checkout', async (req, res) => {
  try {
    const { invoiceNo, selectedMethod = 'ALL' } = req.body;
    let order = orders.get(invoiceNo);

    if (!order) {
      return res.status(404).json({ error: 'Order session not found' });
    }

    order.status = 'PENDING_PAYMENT';
    order.selectedMethod = selectedMethod;
    orders.set(invoiceNo, order);

    logEvent('CHECKOUT_CONFIRMED', `PACO PrePaymentUI Confirmed (${invoiceNo})`, {
      invoiceNo,
      selectedMethod,
      webPaymentUrl: order.webPaymentUrl
    });

    res.json({
      success: true,
      invoiceNo: order.invoiceNo,
      webPaymentUrl: order.webPaymentUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Webhook Receivers
app.post('/api/webhook/paco', (req, res) => {
  try {
    const rawJwt = req.body?.payload || req.body?.jwt || req.body;
    const paco = getPacoInstance();
    const decoded = typeof rawJwt === 'string' ? paco.verifyAndDecodeToken(rawJwt) : rawJwt;

    const invoiceNo = decoded.merchantReferenceNumber || decoded.invoiceNo;
    const pacoCode = decoded.code || 'PC-0000';

    logEvent('WEBHOOK_RECEIVED', `PACO RS256 Webhook Received (${invoiceNo || 'Unknown'})`, {
      gateway: 'PACO_PREPAYMENT_UI',
      signatureAlgorithm: 'RS256',
      pacoCode,
      decodedPayload: decoded
    });

    if (invoiceNo && orders.has(invoiceNo)) {
      const order = orders.get(invoiceNo);
      const codeInfo = paco.parsePacoCode(pacoCode);

      order.status = codeInfo.status;
      order.respCode = pacoCode;
      order.respDesc = decoded.message || codeInfo.title;
      order.transactionRef = decoded.externalReferenceId || `PACO-TXN-${Date.now()}`;
      order.paymentChannel = 'PACO Payment Page';
      order.updatedAt = new Date().toISOString();
      orders.set(invoiceNo, order);
    }

    res.status(200).json({ status: 'OK', invoiceNo, code: 'PC-0000' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 5. Orders API
app.get('/api/orders/:invoiceNo', (req, res) => {
  const { invoiceNo } = req.params;
  const order = orders.get(invoiceNo);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const paco = getPacoInstance();
  const statusInfo = paco.parsePacoCode(order.respCode || 'PC-0000');

  res.json({ ...order, statusInfo });
});

app.get('/api/orders', (req, res) => {
  const orderList = Array.from(orders.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(orderList);
});

// 6. Logs API
app.get('/api/logs', (req, res) => res.json(inspectorLogs));
app.delete('/api/logs', (req, res) => {
  inspectorLogs.length = 0;
  res.json({ success: true, message: 'Logs cleared' });
});

// 7. Simulator Payment API for PACO PrePaymentUI
app.get('/api/simulator/payment-info', (req, res) => {
  const { paymentToken, invoiceNo } = req.query;
  let order = activeTokens.get(paymentToken) || orders.get(invoiceNo);
  if (!order) return res.status(404).json({ error: 'Session not found' });

  res.json({
    merchantID: currentConfig.merchantID,
    invoiceNo: order.invoiceNo,
    description: order.description,
    amount: order.amount,
    currencyCode: order.currencyCode,
    gateway: order.gateway
  });
});

app.post('/api/simulator/paco-submit-payment', async (req, res) => {
  try {
    const { paymentToken, invoiceNo, pacoCode = 'PC-0000' } = req.body;
    let order = activeTokens.get(paymentToken) || orders.get(invoiceNo);
    if (!order) return res.status(404).json({ error: 'PACO order session not found' });

    const paco = getPacoInstance();
    const webhookPayload = {
      partnerId: currentConfig.merchantID,
      merchantReferenceNumber: order.invoiceNo,
      externalReferenceId: `PACO-TXN-${Date.now()}`,
      amount: order.amount,
      currency: order.currencyCode,
      code: pacoCode,
      message: pacoCode === 'PC-0000' ? 'PACO PrePaymentUI Payment Authorized' : `PACO Error ${pacoCode}`
    };

    const responseJwt = paco.signPayload(webhookPayload);
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    axios.post(`${baseUrl}/api/webhook/paco`, { payload: responseJwt }).catch(() => {});

    res.json({
      success: true,
      returnUrl: `${baseUrl}/payment-complete.html?invoiceNo=${encodeURIComponent(order.invoiceNo)}&pacoCode=${pacoCode}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 2C2P PACO RS256 PEM Key Signing Server`);
  console.log(`🔗 Local URL: http://localhost:3000`);
  console.log(`🔑 RSA Private Key: ${PRIVATE_KEY_PATH}`);
  console.log(`🔑 RSA Public Key:  ${PUBLIC_KEY_PATH}`);
  console.log(`==================================================\n`);
});
