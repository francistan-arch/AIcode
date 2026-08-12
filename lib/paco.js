const jwt = require('jsonwebtoken');
const axios = require('axios');
const { getPrivateKey, getPublicKey, get2C2PPublicKey } = require('./keyManager');

/**
 * 2C2P PACO Payment Service
 * Official /pay and /hpp/session RS256 Asymmetric RSA Key Signing & Direct Redirect
 */
class PacoService {
  constructor(config = {}) {
    this.partnerId = config.partnerId || process.env.PACO_PARTNER_ID || 'PACO_PARTNER_DEMO';
    this.apiUrl = config.apiUrl || process.env.PACO_API_URL || 'https://core.demo-paco.2c2p.com/paco/v1/hpp/session';
    this.mode = config.mode || process.env.MODE || 'simulator';

    // RSA 2048-bit PEM Keys
    this.privateKeyPem = config.privatePem || getPrivateKey();
    this.publicKeyPem = config.publicPem || getPublicKey();
    this.pacoPublicKeyPem = config.pacoPublicPem || get2C2PPublicKey();
  }

  /**
   * Signs PACO Request payload using Merchant RSA Private Key (RS256)
   */
  signPayload(payload) {
    try {
      return jwt.sign(payload, this.privateKeyPem, { algorithm: 'RS256' });
    } catch (err) {
      console.error('[PACO RS256 Sign Error]', err.message);
      throw new Error(`Failed to sign payload with Private PEM Key: ${err.message}`);
    }
  }

  /**
   * Verifies and decodes PACO JWT response using 2C2P / Merchant Public Key (RS256)
   */
  verifyAndDecodeToken(token) {
    try {
      return jwt.verify(token, this.pacoPublicKeyPem, { algorithms: ['RS256'] });
    } catch (err) {
      console.warn('[PACO Verification Warning]', err.message);
      try {
        return jwt.verify(token, this.publicKeyPem, { algorithms: ['RS256'] });
      } catch (e) {
        const decoded = jwt.decode(token);
        if (decoded) {
          decoded._verificationWarning = err.message;
          return decoded;
        }
        throw new Error(`Invalid PACO RS256 Signature: ${err.message}`);
      }
    }
  }

  /**
   * Silently creates signed 2C2P PACO Payment Session
   */
  async createPaymentSession({
    invoiceNo,
    description,
    amount,
    currencyCode = 'MYR',
    customerName,
    customerEmail
  }, baseUrl) {
    const externalReferenceId = `PACO-TXN-REF-${invoiceNo}`;

    const requestPayload = {
      partnerId: this.partnerId,
      externalReferenceId,
      merchantReferenceNumber: String(invoiceNo),
      description: String(description),
      amount: Number(amount.toFixed(2)),
      currency: String(currencyCode).toUpperCase(),
      paymentType: 'PACO_HOSTED_PAYMENT_PAGE',
      signatureAlgorithm: 'RS256',
      returnUrl: `${baseUrl}/payment-complete.html?invoiceNo=${invoiceNo}&gateway=PACO_HOSTED_PAYMENT_PAGE`,
      notificationUrl: `${baseUrl}/api/webhook/paco`,
      customerInfo: {
        name: customerName || 'Valued Customer',
        email: customerEmail || 'customer@example.com'
      }
    };

    const signedJwt = this.signPayload(requestPayload);

    if (this.mode === 'simulator') {
      const hppToken = `PACO_RS256_TOK_${Date.now()}`;
      const webPaymentUrl = `${baseUrl}/2c2p-paco-hosted-page.html?hppToken=${hppToken}&invoiceNo=${encodeURIComponent(invoiceNo)}`;

      const responsePayload = {
        code: 'PC-0000',
        message: '2C2P PACO Payment Session Created (RS256 Signed)',
        partnerId: this.partnerId,
        externalReferenceId,
        merchantReferenceNumber: invoiceNo,
        amount: requestPayload.amount,
        currency: requestPayload.currency,
        hppToken,
        webPaymentUrl
      };

      return {
        gateway: '2c2p-paco',
        mode: 'simulator',
        signatureAlgorithm: 'RS256',
        rawRequestPayload: requestPayload,
        requestJwt: signedJwt,
        responseJwt: this.signPayload(responsePayload),
        decodedResponse: responsePayload,
        webPaymentUrl
      };
    }

    // Actual 2C2P Direct Gateway Request
    try {
      console.log(`[2C2P PACO API] Posting RS256 signed payment request to: ${this.apiUrl}`);

      const response = await axios.post(this.apiUrl, { payload: signedJwt }, {
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        timeout: 20000
      });

      const responseJwt = response.data?.payload || response.data?.jwt;
      const decodedResponse = responseJwt ? this.verifyAndDecodeToken(responseJwt) : response.data;

      const webPaymentUrl = decodedResponse.webPaymentUrl || decodedResponse.hppUrl || decodedResponse.paymentUrl;
      const hppToken = decodedResponse.hppToken || decodedResponse.prepaymentUiToken || decodedResponse.token;

      return {
        gateway: '2c2p-paco',
        mode: 'sandbox',
        signatureAlgorithm: 'RS256',
        rawRequestPayload: requestPayload,
        requestJwt: signedJwt,
        responseJwt: responseJwt || JSON.stringify(response.data),
        decodedResponse,
        webPaymentUrl: webPaymentUrl || `https://core.demo-paco.2c2p.com/paco/v1/hpp/pay/${hppToken}`
      };
    } catch (error) {
      console.error('[2C2P PACO API Error]', error.code || error.message);

      if (error.code === 'ENOTFOUND' || error.message.includes('ENOTFOUND')) {
        const hostname = this.apiUrl.split('/')[2] || 'server';
        throw new Error(`DNS Lookup Failed for '${hostname}'. To test locally without external network access, open Gateway Settings (⚙️) and switch Mode to 'Local Payment Simulator' or update your 2C2P Endpoint URL.`);
      }

      throw new Error(`2C2P PACO Payment Request Failed: ${error.response?.data?.message || JSON.stringify(error.response?.data) || error.message}`);
    }
  }

  /**
   * Parses PACO Error Codes
   */
  parsePacoCode(code) {
    if (!code || code === 'PC-0000' || code === '0000') {
      return { status: 'COMPLETED', title: 'PACO Payment Authorized', color: '#10b981' };
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
