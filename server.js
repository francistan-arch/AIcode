const express = require('express');
const axios = require('axios');
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const TwoC2PService = require('./lib/2c2p');
const PacoService = require('./lib/paco');

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
  secretKey: process.env.PACO_SECRET_KEY || process.env['2C2P_SECRET_KEY'] || '',
  apiUrl: process.env['2C2P_API_URL'] || 'https://sandbox-pgw.2c2p.com/payment/4.3/paymentToken',
  pacoApiUrl: process.env.PACO_API_URL || 'https://core.demo-paco.2c2p.com/paco/v1/prepaymentui',
  mode: process.env.MODE || 'simulator'
};

function get2C2PInstance() {
  return new TwoC2PService(currentConfig);
}

function getPacoInstance() {
  return new PacoService({
    partnerId: currentConfig.merchantID,
    secretKey: currentConfig.secretKey,
    apiUrl: currentConfig.pacoApiUrl,
    mode: currentConfig.mode
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

// 1. Config API
app.get('/api/config', (req, res) => {
  res.json({
    gatewayType: currentConfig.gatewayType,
    merchantID: currentConfig.merchantID,
    secretKeyMasked: currentConfig.secretKey ? `${currentConfig.secretKey.substring(0, 6)}...${currentConfig.secretKey.substring(currentConfig.secretKey.length - 4)}` : '(Not Set)',
    apiUrl: currentConfig.apiUrl,
    pacoApiUrl: currentConfig.pacoApiUrl,
    mode: currentConfig.mode
  });
});

app.post('/api/config', (req, res) => {
  const { gatewayType, merchantID, secretKey, apiUrl, pacoApiUrl, mode } = req.body;
  if (gatewayType && ['2c2p-pgw', '2c2p-paco'].includes(gatewayType)) currentConfig.gatewayType = gatewayType;
  if (merchantID) currentConfig.merchantID = merchantID;
  if (secretKey) currentConfig.secretKey = secretKey;
  if (apiUrl) currentConfig.apiUrl = apiUrl;
  if (pacoApiUrl) currentConfig.pacoApiUrl = pacoApiUrl;
  if (mode && ['simulator', 'sandbox'].includes(mode)) currentConfig.mode = mode;

  logEvent('CONFIG_UPDATE', 'Gateway Configuration Updated', { currentConfig });
  res.json({ success: true, message: 'Configuration updated successfully', config: currentConfig });
});

// 2. PACO `prepaymentui` Request API
app.post('/api/paco/prepaymentui', async (req, res) => {
  try {
    const { items, customerName, customerEmail, currencyCode = 'THB' } = req.body;

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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      events: []
    };

    orders.set(invoiceNo, newOrder);
    if (result.prepaymentUiToken) {
      activeTokens.set(result.prepaymentUiToken, newOrder);
    }

    logEvent('PREPAYMENT_UI_REQUEST', `PACO PrePaymentUI Requested (${invoiceNo})`, {
      gateway: '2c2p-paco',
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

// 3. Checkout API - Final Confirmation & Redirect
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
app.post('/api/webhook/2c2p', (req, res) => {
  try {
    const rawJwt = req.body?.payload || req.body?.jwt || req.body;
    const twoC2P = get2C2PInstance();
    const decoded = typeof rawJwt === 'string' ? twoC2P.verifyAndDecodeToken(rawJwt) : rawJwt;

    const { invoiceNo, respCode, respDesc, transactionRef, channelCode } = decoded;

    logEvent('WEBHOOK_RECEIVED', `2C2P Webhook Received (${invoiceNo || 'Unknown'})`, {
      decodedPayload: decoded
    });

    if (invoiceNo && orders.has(invoiceNo)) {
      const order = orders.get(invoiceNo);
      const codeInfo = twoC2P.parseResponseCode(respCode);

      order.status = codeInfo.status;
      order.respCode = respCode;
      order.respDesc = respDesc || codeInfo.title;
      order.transactionRef = transactionRef || `TXN-${Date.now()}`;
      order.paymentChannel = channelCode || 'CARD';
      order.updatedAt = new Date().toISOString();
      orders.set(invoiceNo, order);
    }

    res.status(200).json({ status: 'OK', invoiceNo, respCode: '0000' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/webhook/paco', (req, res) => {
  try {
    const rawJwt = req.body?.payload || req.body?.jwt || req.body;
    const paco = getPacoInstance();
    const decoded = typeof rawJwt === 'string' ? paco.verifyAndDecodeToken(rawJwt) : rawJwt;

    const invoiceNo = decoded.merchantReferenceNumber || decoded.invoiceNo;
    const pacoCode = decoded.code || 'PC-0000';

    logEvent('WEBHOOK_RECEIVED', `PACO Webhook Received (${invoiceNo || 'Unknown'})`, {
      gateway: 'PACO_PREPAYMENT_UI',
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

  let statusInfo;
  if (order.gateway === '2c2p-paco') {
    const paco = getPacoInstance();
    statusInfo = paco.parsePacoCode(order.respCode || 'PC-0000');
  } else {
    const twoC2P = get2C2PInstance();
    statusInfo = twoC2P.parseResponseCode(order.respCode || '0001');
  }

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
  console.log(`🚀 2C2P PACO PrePaymentUI Gateway Integration Server`);
  console.log(`🔗 Local URL: http://localhost:${PORT}`);
  console.log(`⚙️  Active Engine: 2C2P PACO PrePaymentUI`);
  console.log(`⚙️  PrePaymentUI Endpoint: ${currentConfig.pacoApiUrl}`);
  console.log(`==================================================\n`);
});
