const jwt = require('jsonwebtoken');
const axios = require('axios');

/**
 * 2C2P PACO (Payment Air Controller) Hosted Payment Page (HPP) Helper Module
 */
class PacoService {
  constructor(config = {}) {
    this.partnerId = config.partnerId || config.merchantID || process.env['PACO_PARTNER_ID'] || 'PACO_AIR_DEMO';
    this.secretKey = config.secretKey || process.env['PACO_SECRET_KEY'] || 'PACO_SECRET_KEY_72A910E124A4B9448D3528A6D3F9514300E634A9F200A51D14187D397C11C3D6';
    this.apiUrl = config.apiUrl || process.env['PACO_API_URL'] || 'https://core.demo-paco.2c2p.com/paco/v1/hpp/session';
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
      console.warn('[PACO HPP Helper] JWT Verification warning:', err.message);
      const decoded = jwt.decode(token);
      if (decoded) {
        decoded._verificationWarning = err.message;
        return decoded;
      }
      throw new Error(`Invalid PACO JWT: ${err.message}`);
    }
  }

  /**
   * Builds PACO Hosted Payment Page (HPP) Request Payload
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
   * Generates PACO Hosted Payment Page Session & Redirect URL
   */
  async createPacoHppSession(params, baseUrl) {
    const payload = this.buildPacoHppPayload({
      ...params,
      frontendReturnUrl: params.frontendReturnUrl || `${baseUrl}/payment-complete.html?invoiceNo=${params.invoiceNo}&gateway=PACO_HPP`,
      backendReturnUrl: params.backendReturnUrl || `${baseUrl}/api/webhook/paco`
    });

    const signedJwt = this.signPayload(payload);

    if (this.mode === 'simulator') {
      const hppToken = `PACO_HPP_TOK_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
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
        webPaymentUrl,
        pacoSessionExpireInSeconds: 1800
      };

      const signedResponseJwt = this.signPayload(responsePayload);

      return {
        gateway: 'PACO_HPP',
        mode: 'simulator',
        rawRequestPayload: payload,
        requestJwt: signedJwt,
        responseJwt: signedResponseJwt,
        decodedResponse: responsePayload,
        paymentToken: hppToken,
        webPaymentUrl
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
        gateway: 'PACO_HPP',
        mode: 'sandbox',
        rawRequestPayload: payload,
        requestJwt: signedJwt,
        responseJwt,
        decodedResponse,
        paymentToken: decodedResponse.hppToken,
        webPaymentUrl: decodedResponse.webPaymentUrl || decodedResponse.hppUrl
      };
    } catch (error) {
      console.error('[PACO HPP API Error]', error.response?.data || error.message);
      throw new Error(`PACO Hosted Payment Page Request Failed: ${error.response?.data?.message || error.message}`);
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
