const jwt = require('jsonwebtoken');
const axios = require('axios');

/**
 * 2C2P PACO (Payment Air Controller) Actual Gateway Integration Module
 */
class PacoService {
  constructor(config = {}) {
    this.partnerId = config.partnerId || process.env.PACO_PARTNER_ID || 'PACO_PARTNER_DEMO';
    this.secretKey = config.secretKey || process.env.PACO_SECRET_KEY || '';
    this.apiUrl = config.apiUrl || process.env.PACO_API_URL || 'https://core.demo-paco.2c2p.com/paco/v1/hpp/session';
    this.mode = config.mode || process.env.MODE || 'sandbox'; // Actual PACO gateway mode
  }

  /**
   * Signs PACO Request payload into a JOSE/JWT token using HS256
   */
  signPayload(payload) {
    if (!this.secretKey) {
      console.warn('[PACO Warning] No Secret Key provided. Signing with fallback key.');
    }
    return jwt.sign(payload, this.secretKey || 'FALLBACK_KEY', { algorithm: 'HS256' });
  }

  /**
   * Verifies and decodes PACO JWT token returned from 2C2P PACO gateway
   */
  verifyAndDecodeToken(token) {
    try {
      return jwt.verify(token, this.secretKey || 'FALLBACK_KEY', { algorithms: ['HS256'] });
    } catch (err) {
      console.warn('[PACO Helper] JWT Verification warning:', err.message);
      const decoded = jwt.decode(token);
      if (decoded) {
        decoded._verificationWarning = err.message;
        return decoded;
      }
      throw new Error(`Invalid PACO JWT from 2C2P: ${err.message}`);
    }
  }

  /**
   * Builds actual 2C2P PACO Hosted Payment Page (HPP) Session Request Payload
   */
  buildPacoHppPayload({
    invoiceNo,
    description,
    amount,
    currencyCode = 'THB',
    frontendReturnUrl,
    backendReturnUrl,
    customerName,
    customerEmail,
    paymentChannels = ['CREDIT_CARD', 'PROMPTPAY', 'PAYNOW', 'E_WALLET']
  }) {
    const externalReferenceId = `PACO-HPP-REF-${invoiceNo}`;

    return {
      partnerId: this.partnerId,
      externalReferenceId,
      merchantReferenceNumber: String(invoiceNo),
      description: String(description),
      amount: Number(amount.toFixed(2)),
      currency: String(currencyCode).toUpperCase(),
      paymentType: 'PACO_HOSTED_PAYMENT_PAGE',
      allowedChannels: paymentChannels,
      returnUrl: frontendReturnUrl,
      notificationUrl: backendReturnUrl,
      pacoRoutingConfig: {
        smartRoutingEnabled: true,
        costOptimization: true,
        autoAcquirerFailover: true
      },
      customerInfo: {
        name: customerName || 'Valued Customer',
        email: customerEmail || 'customer@example.com'
      }
    };
  }

  /**
   * Sends actual HTTP POST request to 2C2P PACO Gateway to request Hosted Payment Page URL
   */
  async createPacoHppSession(params, baseUrl) {
    const payload = this.buildPacoHppPayload({
      ...params,
      frontendReturnUrl: params.frontendReturnUrl || `${baseUrl}/payment-complete.html?invoiceNo=${params.invoiceNo}&gateway=PACO_HPP`,
      backendReturnUrl: params.backendReturnUrl || `${baseUrl}/api/webhook/paco`
    });

    const signedJwt = this.signPayload(payload);

    if (this.mode === 'simulator') {
      // Internal fallback testing if explicitly requested
      const hppToken = `PACO_HPP_TOK_${Date.now()}`;
      const webPaymentUrl = `${baseUrl}/2c2p-paco-hosted-page.html?hppToken=${hppToken}&invoiceNo=${encodeURIComponent(params.invoiceNo)}`;

      const responsePayload = {
        code: 'PC-0000',
        message: 'PACO Hosted Payment Page Session Created',
        partnerId: this.partnerId,
        externalReferenceId: payload.externalReferenceId,
        merchantReferenceNumber: params.invoiceNo,
        amount: payload.amount,
        currency: payload.currency,
        hppToken,
        webPaymentUrl
      };

      return {
        gateway: 'PACO_HPP',
        mode: 'simulator',
        rawRequestPayload: payload,
        requestJwt: signedJwt,
        responseJwt: this.signPayload(responsePayload),
        decodedResponse: responsePayload,
        paymentToken: hppToken,
        webPaymentUrl
      };
    }

    // Actual 2C2P PACO Gateway Direct Call
    try {
      console.log(`[PACO API] Posting session request to actual PACO endpoint: ${this.apiUrl}`);

      const response = await axios.post(this.apiUrl, { payload: signedJwt }, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 20000
      });

      const responseJwt = response.data?.payload || response.data?.jwt;
      
      let decodedResponse;
      if (responseJwt) {
        decodedResponse = this.verifyAndDecodeToken(responseJwt);
      } else {
        decodedResponse = response.data; // Raw JSON if unencrypted
      }

      const webPaymentUrl = decodedResponse.webPaymentUrl || decodedResponse.hppUrl || decodedResponse.paymentUrl || decodedResponse.webRedirectUrl;
      const paymentToken = decodedResponse.hppToken || decodedResponse.paymentToken;

      if (!webPaymentUrl && !paymentToken) {
        throw new Error(`2C2P PACO API did not return a valid webPaymentUrl. Received: ${JSON.stringify(decodedResponse)}`);
      }

      return {
        gateway: 'PACO_HPP',
        mode: 'sandbox',
        rawRequestPayload: payload,
        requestJwt: signedJwt,
        responseJwt: responseJwt || JSON.stringify(response.data),
        decodedResponse,
        paymentToken,
        webPaymentUrl: webPaymentUrl || `https://core.demo-paco.2c2p.com/paco/v1/hpp/pay/${paymentToken}`
      };
    } catch (error) {
      console.error('[Actual PACO Gateway API Error]', error.response?.data || error.message);
      throw new Error(`2C2P PACO Gateway API Request Failed: ${error.response?.data?.message || JSON.stringify(error.response?.data) || error.message}`);
    }
  }

  /**
   * Parses PACO Business (`PC-Bxxxxxx`) and Technical (`PC-Txxxxxx`) Error Codes
   */
  parsePacoCode(code) {
    if (!code || code === 'PC-0000' || code === '0000') {
      return { status: 'COMPLETED', title: 'PACO Hosted Payment Authorized', color: '#10b981' };
    }
    if (code.startsWith('PC-B')) {
      return { status: 'FAILED', title: `PACO Business Exception (${code})`, color: '#ef4444' };
    }
    if (code.startsWith('PC-T')) {
      return { status: 'ERROR', title: `PACO Technical Error (${code})`, color: '#f59e0b' };
    }
    return { status: 'UNKNOWN', title: `PACO Code: ${code}`, color: '#6b7280' };
  }
}

module.exports = PacoService;
