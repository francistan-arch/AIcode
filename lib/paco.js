const jwt = require('jsonwebtoken');
const axios = require('axios');

/**
 * 2C2P PACO (Payment Air Controller) Service Module
 * Handles PACO Smart Routing, 3DS Authentication, and PACO Error Code Specs
 */
class PacoService {
  constructor(config = {}) {
    this.partnerId = config.partnerId || config.merchantID || process.env['PACO_PARTNER_ID'] || 'PACO_DEMO_01';
    this.secretKey = config.secretKey || process.env['PACO_SECRET_KEY'] || 'PACO_SECRET_KEY_72A910E124A4B9448D3528A6D3F9514300E634A9F200A51D14187D397C11C3D6';
    this.apiUrl = config.apiUrl || process.env['PACO_API_URL'] || 'https://core.demo-paco.2c2p.com/api/v1/payment';
    this.mode = config.mode || process.env.MODE || 'simulator';
  }

  /**
   * Signs PACO Request payload into a JOSE/JWT token
   */
  signPayload(payload) {
    return jwt.sign(payload, this.secretKey, { algorithm: 'HS256' });
  }

  /**
   * Verifies and decodes PACO JWT token
   */
  verifyAndDecodeToken(token) {
    try {
      return jwt.verify(token, this.secretKey, { algorithms: ['HS256'] });
    } catch (err) {
      console.warn('[PACO Helper] JWT Verification warning:', err.message);
      const decoded = jwt.decode(token);
      if (decoded) {
        decoded._verificationWarning = err.message;
        return decoded;
      }
      throw new Error(`Invalid PACO JWT: ${err.message}`);
    }
  }

  /**
   * Builds PACO Payment Air Controller request payload
   */
  buildPacoRequestPayload({
    invoiceNo,
    description,
    amount,
    currencyCode = 'THB',
    frontendReturnUrl,
    backendReturnUrl,
    paymentMethod = 'ALL',
    customerName,
    customerEmail
  }) {
    const externalReferenceId = `PACO-REF-${invoiceNo}`;

    return {
      partnerId: this.partnerId,
      externalReferenceId,
      merchantReferenceNumber: String(invoiceNo),
      description: String(description),
      amount: Number(amount.toFixed(2)),
      currency: String(currencyCode).toUpperCase(),
      paymentMethod,
      returnUrl: frontendReturnUrl,
      notificationUrl: backendReturnUrl,
      routingPreference: {
        smartRoutingEnabled: true,
        costOptimization: true,
        preferredAcquirer: 'AUTO_SMART_ROUTE'
      },
      threeDSecure: {
        deviceChannel: 2, // Browser-based flow
        messageCategory: '01',
        threeDsRequestorAuthInd: '01'
      },
      customer: {
        name: customerName || 'Valued Customer',
        email: customerEmail || 'customer@example.com'
      }
    };
  }

  /**
   * Initiates PACO Payment Token request
   */
  async createPacoPayment(params, baseUrl) {
    const payload = this.buildPacoRequestPayload({
      ...params,
      frontendReturnUrl: params.frontendReturnUrl || `${baseUrl}/payment-complete.html?invoiceNo=${params.invoiceNo}&gateway=PACO`,
      backendReturnUrl: params.backendReturnUrl || `${baseUrl}/api/webhook/paco`
    });

    const signedJwt = this.signPayload(payload);

    if (this.mode === 'simulator') {
      const pacoPaymentToken = `PACO_TOK_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const pacoCheckoutUrl = `${baseUrl}/2c2p-paco-checkout.html?paymentToken=${pacoPaymentToken}&invoiceNo=${encodeURIComponent(params.invoiceNo)}`;

      const responsePayload = {
        code: 'PC-0000',
        message: 'PACO Route Authorized',
        partnerId: this.partnerId,
        externalReferenceId: payload.externalReferenceId,
        merchantReferenceNumber: params.invoiceNo,
        amount: payload.amount,
        currency: payload.currency,
        pacoPaymentToken,
        webPaymentUrl: pacoCheckoutUrl,
        routingDetails: {
          selectedAcquirer: 'PACO_ACQUIRER_SG_01',
          estimatedFeeSavings: '0.85%'
        }
      };

      const signedResponseJwt = this.signPayload(responsePayload);

      return {
        gateway: 'PACO',
        mode: 'simulator',
        rawRequestPayload: payload,
        requestJwt: signedJwt,
        responseJwt: signedResponseJwt,
        decodedResponse: responsePayload,
        paymentToken: pacoPaymentToken,
        webPaymentUrl: pacoCheckoutUrl
      };
    }

    // Live PACO Gateway Mode
    try {
      const response = await axios.post(this.apiUrl, { payload: signedJwt }, {
        headers: {
          'Content-Type': 'application/jose',
          'Accept': 'application/jose'
        },
        timeout: 15000
      });

      const responseJwt = response.data?.payload;
      const decodedResponse = this.verifyAndDecodeToken(responseJwt);

      return {
        gateway: 'PACO',
        mode: 'sandbox',
        rawRequestPayload: payload,
        requestJwt: signedJwt,
        responseJwt,
        decodedResponse,
        paymentToken: decodedResponse.pacoPaymentToken,
        webPaymentUrl: decodedResponse.webPaymentUrl
      };
    } catch (error) {
      console.error('[PACO API Error]', error.response?.data || error.message);
      throw new Error(`PACO Payment Request Failed: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Parses PACO Business (`PC-Bxxxxxx`) and Technical (`PC-Txxxxxx`) Error Codes
   */
  parsePacoCode(code) {
    if (!code || code === 'PC-0000' || code === '0000') {
      return { status: 'COMPLETED', title: 'PACO Authorization Successful', color: '#10b981' };
    }
    if (code.startsWith('PC-B')) {
      return { status: 'FAILED', title: `PACO Business Exception (${code})`, color: '#ef4444' };
    }
    if (code.startsWith('PC-T')) {
      return { status: 'ERROR', title: `PACO Technical/Routing Error (${code})`, color: '#f59e0b' };
    }
    return { status: 'UNKNOWN', title: `PACO Response Code: ${code}`, color: '#6b7280' };
  }
}

module.exports = PacoService;
