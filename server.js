const express = require('express');
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const TwoC2PService = require('./lib/2c2p');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// In-Memory Database & Inspector Logs
const orders = new Map(); // invoiceNo -> order details
const inspectorLogs = []; // Array of logged API events & webhooks
const activeTokens = new Map(); // paymentToken -> order details (for simulator)

let currentConfig = {
  merchantID: process.env['2C2P_MERCHANT_ID'] || 'JT01',
  secretKey: process.env['2C2P_SECRET_KEY'] || '72A910E124A4B9448D3528A6D3F9514300E634A9F200A51D14187D397C11C3D6',
  apiUrl: process.env['2C2P_API_URL'] || 'https://sandbox-pgw.2c2p.com/payment/4.3/paymentToken',
  mode: process.env.MODE || 'simulator'
};

function get2C2PInstance() {
  return new TwoC2PService(currentConfig);
}

function logEvent(type, title, details) {
  const log = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    type, // 'CHECKOUT_REQUEST', '2C2P_RESPONSE', 'WEBHOOK_RECEIVED', 'SIMULATOR_ACTION'
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
    merchantID: currentConfig.merchantID,
    secretKeyMasked: currentConfig.secretKey ? `${currentConfig.secretKey.substring(0, 6)}...${currentConfig.secretKey.substring(currentConfig.secretKey.length - 4)}` : '',
    apiUrl: currentConfig.apiUrl,
    mode: currentConfig.mode
  });
});

app.post('/api/config', (req, res) => {
  const { merchantID, secretKey, apiUrl, mode } = req.body;
  if (merchantID) currentConfig.merchantID = merchantID;
  if (secretKey) currentConfig.secretKey = secretKey;
  if (apiUrl) currentConfig.apiUrl = apiUrl;
  if (mode && ['simulator', 'sandbox'].includes(mode)) currentConfig.mode = mode;

  logEvent('CONFIG_UPDATE', '2C2P Configuration Updated', { currentConfig });
  res.json({ success: true, message: 'Configuration updated successfully', config: currentConfig });
});

// 2. Checkout API - Initiates 2C2P Payment Token Request
app.post('/api/checkout', async (req, res) => {
  try {
    const { items, customerName, customerEmail, currencyCode = 'THB' } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart must contain at least one item' });
    }

    const totalAmount = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const invoiceNo = `INV-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const description = items.map(i => `${i.name} x${i.quantity}`).join(', ');

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const twoC2P = get2C2PInstance();

    // Request payment token from 2C2P or Simulator
    const result = await twoC2P.requestPaymentToken({
      invoiceNo,
      description,
      amount: totalAmount,
      currencyCode,
      userDefined1: customerName || 'Valued Customer',
      userDefined2: customerEmail || 'customer@example.com'
    }, baseUrl);

    const newOrder = {
      invoiceNo,
      description,
      items,
      amount: totalAmount,
      currencyCode,
      customerName,
      customerEmail,
      status: 'PENDING_PAYMENT',
      paymentToken: result.paymentToken,
      webPaymentUrl: result.webPaymentUrl,
      mode: result.mode,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      events: []
    };

    orders.set(invoiceNo, newOrder);
    if (result.paymentToken) {
      activeTokens.set(result.paymentToken, newOrder);
    }

    logEvent('CHECKOUT_REQUEST', `Order Checkout Initiated (${invoiceNo})`, {
      invoiceNo,
      amount: totalAmount,
      currencyCode,
      mode: result.mode,
      rawRequestPayload: result.rawRequestPayload,
      requestJwt: result.requestJwt,
      responseJwt: result.responseJwt,
      decodedResponse: result.decodedResponse,
      webPaymentUrl: result.webPaymentUrl
    });

    res.json({
      success: true,
      invoiceNo,
      amount: totalAmount,
      currencyCode,
      webPaymentUrl: result.webPaymentUrl,
      paymentToken: result.paymentToken,
      mode: result.mode,
      requestJwt: result.requestJwt,
      responseJwt: result.responseJwt,
      decodedResponse: result.decodedResponse
    });
  } catch (err) {
    console.error('Checkout error:', err);
    logEvent('CHECKOUT_ERROR', 'Checkout Creation Failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// 3. Webhook Receiver (Backend Return URL)
app.post('/api/webhook/2c2p', (req, res) => {
  try {
    const rawJwt = req.body?.payload || req.body?.jwt || req.body;
    
    let decoded;
    const twoC2P = get2C2PInstance();

    if (typeof rawJwt === 'string') {
      decoded = twoC2P.verifyAndDecodeToken(rawJwt);
    } else {
      decoded = rawJwt; // JSON object directly
    }

    const { invoiceNo, respCode, respDesc, amount, currencyCode, transactionRef, channelCode } = decoded;

    logEvent('WEBHOOK_RECEIVED', `2C2P Webhook Received (${invoiceNo || 'Unknown'})`, {
      rawPayload: req.body,
      decodedPayload: decoded
    });

    if (invoiceNo && orders.has(invoiceNo)) {
      const order = orders.get(invoiceNo);
      const codeInfo = twoC2P.parseResponseCode(respCode);

      order.status = codeInfo.status;
      order.respCode = respCode;
      order.respDesc = respDesc || codeInfo.title;
      order.transactionRef = transactionRef || `TXN-${Date.now()}`;
      order.paymentChannel = channelCode || decoded.paymentChannel || 'CARD';
      order.updatedAt = new Date().toISOString();
      order.events.push({
        type: 'WEBHOOK',
        timestamp: new Date().toISOString(),
        respCode,
        respDesc,
        status: codeInfo.status
      });

      orders.set(invoiceNo, order);
    }

    // 2C2P expects HTTP 200 OK
    res.status(200).json({ status: 'OK', invoiceNo, respCode: '0000', message: 'Webhook processed successfully' });
  } catch (err) {
    console.error('Webhook processing error:', err);
    logEvent('WEBHOOK_ERROR', 'Webhook Processing Failed', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// 4. Get order status by invoice number
app.get('/api/orders/:invoiceNo', (req, res) => {
  const { invoiceNo } = req.params;
  const order = orders.get(invoiceNo);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  const twoC2P = get2C2PInstance();
  const statusInfo = twoC2P.parseResponseCode(order.respCode || '0001');

  res.json({
    ...order,
    statusInfo
  });
});

// 5. Get all orders
app.get('/api/orders', (req, res) => {
  const orderList = Array.from(orders.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(orderList);
});

// 6. Get Inspector Logs
app.get('/api/logs', (req, res) => {
  res.json(inspectorLogs);
});

app.delete('/api/logs', (req, res) => {
  inspectorLogs.length = 0;
  res.json({ success: true, message: 'Logs cleared' });
});

// 7. Simulator API - Fetch order details by payment token or invoiceNo
app.get('/api/simulator/payment-info', (req, res) => {
  const { paymentToken, invoiceNo } = req.query;
  let order = null;

  if (paymentToken && activeTokens.has(paymentToken)) {
    order = activeTokens.get(paymentToken);
  } else if (invoiceNo && orders.has(invoiceNo)) {
    order = orders.get(invoiceNo);
  }

  if (!order) {
    return res.status(404).json({ error: 'Payment transaction session not found' });
  }

  res.json({
    merchantID: currentConfig.merchantID,
    invoiceNo: order.invoiceNo,
    description: order.description,
    amount: order.amount,
    currencyCode: order.currencyCode,
    customerName: order.customerName,
    paymentToken: order.paymentToken,
    status: order.status
  });
});

// 8. Simulator API - Submit payment on 2C2P Hosted Simulator
app.post('/api/simulator/submit-payment', async (req, res) => {
  try {
    const { paymentToken, invoiceNo, outcome = 'SUCCESS', paymentMethod = 'CREDIT_CARD', cardDetails } = req.body;

    let order = null;
    if (paymentToken && activeTokens.has(paymentToken)) {
      order = activeTokens.get(paymentToken);
    } else if (invoiceNo && orders.has(invoiceNo)) {
      order = orders.get(invoiceNo);
    }

    if (!order) {
      return res.status(404).json({ error: 'Payment order session not found' });
    }

    const twoC2P = get2C2PInstance();
    const respCode = outcome === 'SUCCESS' ? '0000' : (outcome === 'CANCELLED' ? '2001' : '2000');
    const respDesc = outcome === 'SUCCESS' ? 'Success' : (outcome === 'CANCELLED' ? 'Cancelled by customer' : 'Payment Authorization Failed');

    const webhookPayload = {
      merchantID: currentConfig.merchantID,
      invoiceNo: order.invoiceNo,
      amount: order.amount,
      currencyCode: order.currencyCode,
      respCode,
      respDesc,
      transactionRef: `2C2P-SIM-${Date.now()}`,
      channelCode: paymentMethod,
      approvalCode: outcome === 'SUCCESS' ? Math.floor(100000 + Math.random() * 900000).toString() : '',
      paymentDateTime: new Date().toISOString()
    };

    // Sign response payload as JWT
    const responseJwt = twoC2P.signPayload(webhookPayload);

    logEvent('SIMULATOR_ACTION', `Hosted Simulator Payment Submitted (${outcome})`, {
      invoiceNo: order.invoiceNo,
      paymentMethod,
      outcome,
      respCode,
      respDesc,
      webhookPayload,
      responseJwt
    });

    // Invoke merchant server webhook directly
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    axios.post(`${baseUrl}/api/webhook/2c2p`, { payload: responseJwt }).catch(err => {
      console.error('Simulator webhook dispatch error:', err.message);
    });

    const returnUrl = `${baseUrl}/payment-complete.html?invoiceNo=${encodeURIComponent(order.invoiceNo)}&respCode=${respCode}`;

    res.json({
      success: true,
      respCode,
      respDesc,
      returnUrl,
      jwt: responseJwt,
      webhookPayload
    });
  } catch (err) {
    console.error('Simulator payment error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start express server
app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 2C2P Hosted Payment Integration Demo Server`);
  console.log(`🔗 Local URL: http://localhost:${PORT}`);
  console.log(`⚙️  Current Mode: ${currentConfig.mode.toUpperCase()}`);
  console.log(`==================================================\n`);
});
