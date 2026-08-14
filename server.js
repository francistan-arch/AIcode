const express = require('express');
const axios = require('axios');
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const TwoC2PService = require('./lib/2c2p');
const PacoService = require('./lib/paco');
const { getPrivateKey, getPublicKey, getKeyDetails, PRIVATE_KEY_PATH, PUBLIC_KEY_PATH } = require('./lib/keyManager');

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
  merchantID: process.env.PACO_OFFICE_ID || 'AirAsiaRewards',
  officeId: process.env.PACO_OFFICE_ID || 'AirAsiaRewards',
  apiKey: process.env.PACO_API_KEY || 'a89ffc44f0dd412188251ddfa2bf8757',
  kid: process.env.PACO_KID || '7664a2ed0dee4879bdfca0e8ce1ac313',
  apiUrl: process.env['2C2P_API_URL'] || 'https://demo2.2c2p.com/2C2PFrontEnd/Payment/4.3/paymentToken',
  pacoApiUrl: process.env.PACO_API_URL || 'https://core.demo-paco.2c2p.com/api/2.0/Payment/prePaymentUI',
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
    officeId: currentConfig.officeId,
    apiKey: currentConfig.apiKey,
    kid: currentConfig.kid,
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

app.get('/api/keys-status', (req, res) => {
  try {
    const keys = getKeyDetails();
    res.json({ success: true, keys });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Checkout API - Silently handles RS256 PEM signed request and returns direct redirect URL
app.post('/api/checkout', async (req, res) => {
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
    const result = await paco.createPaymentSession({
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
      status: 'PENDING_PAYMENT',
      webPaymentUrl: result.webPaymentUrl,
      mode: result.mode,
      signatureAlgorithm: 'RS256',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      events: []
    };

    orders.set(invoiceNo, newOrder);

    logEvent('SILENT_CHECKOUT_RS256', `2C2P PACO RS256 Silent Checkout (${invoiceNo})`, {
      gateway: '2c2p-paco',
      signatureAlgorithm: 'RS256 (RSA PEM)',
      invoiceNo,
      amount: totalAmount,
      currencyCode,
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
      webPaymentUrl: result.webPaymentUrl
    });
  } catch (err) {
    console.error('Silent Checkout Error:', err);
    logEvent('CHECKOUT_ERROR', '2C2P PACO Silent Checkout Failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// 3. Webhook Receiver
app.post('/api/webhook/paco', (req, res) => {
  try {
    const rawJwt = req.body?.payload || req.body?.jwt || req.body;
    const paco = getPacoInstance();
    const decoded = typeof rawJwt === 'string' ? paco.verifyAndDecodeToken(rawJwt) : rawJwt;

    const invoiceNo = decoded.merchantReferenceNumber || decoded.invoiceNo;
    const pacoCode = decoded.code || 'PC-0000';

    logEvent('WEBHOOK_RECEIVED', `PACO RS256 Webhook Received (${invoiceNo || 'Unknown'})`, {
      gateway: '2c2p-paco',
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
      order.paymentChannel = '2C2P Payment Page';
      order.updatedAt = new Date().toISOString();
      orders.set(invoiceNo, order);
    }

    res.status(200).json({ status: 'OK', invoiceNo, code: 'PC-0000' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 4. Orders API
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

// 5. Logs API
app.get('/api/logs', (req, res) => res.json(inspectorLogs));
app.delete('/api/logs', (req, res) => {
  inspectorLogs.length = 0;
  res.json({ success: true, message: 'Logs cleared' });
});

// 6. Simulator Payment API
app.get('/api/simulator/payment-info', (req, res) => {
  const { paymentToken, invoiceNo, hppToken } = req.query;
  let order = orders.get(invoiceNo);
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
    const { invoiceNo, pacoCode = 'PC-0000' } = req.body;
    let order = orders.get(invoiceNo);
    if (!order) return res.status(404).json({ error: 'PACO order session not found' });

    const paco = getPacoInstance();
    const webhookPayload = {
      partnerId: currentConfig.merchantID,
      merchantReferenceNumber: order.invoiceNo,
      externalReferenceId: `PACO-TXN-${Date.now()}`,
      amount: order.amount,
      currency: order.currencyCode,
      code: pacoCode,
      message: pacoCode === 'PC-0000' ? 'PACO Payment Authorized' : `PACO Error ${pacoCode}`
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

const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 2C2P PACO Silent Gateway Server Running`);
  console.log(`🔗 Bound to: http://${HOST}:${PORT}`);
  console.log(`🔗 Local Access: http://localhost:${PORT}`);
  console.log(`🔑 RSA Private Key: ${PRIVATE_KEY_PATH}`);
  console.log(`🔑 RSA Public Key:  ${PUBLIC_KEY_PATH}`);
  console.log(`==================================================\n`);
});
