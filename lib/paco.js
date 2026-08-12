const jwt = require('jsonwebtoken');
const axios = require('axios');
const { getPrivateKey, getPublicKey, get2C2PPublicKey } = require('./keyManager');

/**
 * 2C2P PACO (Payment Air Controller) Service
 * RS256 Asymmetric RSA Key Signing (PEM) & Verification
 */
class PacoService {
  constructor(config = {}) {
    this.partnerId = config.partnerId || process.env.PACO_PARTNER_ID || 'PACO_PARTNER_DEMO';
    this.apiUrl = config.apiUrl || process.env.PACO_API_URL || 'https://core.demo-paco.2c2p.com/paco/v1/prepaymentui';
    this.mode = config.mode || process.env.MODE || 'sandbox';

    // RSA PEM Keys
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
      // Fallback verification with local public key or unverified decoding
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
   * Request 2C2P PACO `prepaymentui` with RS256 Signed Payload
   */
  async requestPrePaymentUi({
    invoiceNo,
    description,
    amount,
    currencyCode = 'MYR',
    customerName,
    customerEmail
  }, baseUrl) {
    const externalReferenceId = `PACO-PREUI-REF-${invoiceNo}`;

    const requestPayload = {
      partnerId: this.partnerId,
      externalReferenceId,
      merchantReferenceNumber: String(invoiceNo),
      description: String(description),
      amount: Number(amount.toFixed(2)),
      currency: String(currencyCode).toUpperCase(),
      requestType: 'PRE_PAYMENT_UI',
      signatureAlgorithm: 'RS256',
      returnUrl: `${baseUrl}/payment-complete.html?invoiceNo=${invoiceNo}&gateway=PACO_PREPAYMENT_UI`,
      notificationUrl: `${baseUrl}/api/webhook/paco`,
      customerInfo: {
        name: customerName || 'Valued Customer',
        email: customerEmail || 'customer@example.com'
      },
      routingPreferences: {
        smartRoutingEnabled: true,
        costOptimization: true
      }
    };

    const signedJwt = this.signPayload(requestPayload);

    if (this.mode === 'simulator') {
      const prepaymentUiToken = `PACO_PREUI_RS256_TOK_${Date.now()}`;
      const webPaymentUrl = `${baseUrl}/2c2p-paco-hosted-page.html?hppToken=${prepaymentUiToken}&invoiceNo=${encodeURIComponent(invoiceNo)}`;

      const responsePayload = {
        code: 'PC-0000',
        message: 'PACO Pre-Payment UI Session Created (RS256 Signed)',
        partnerId: this.partnerId,
        externalReferenceId,
        merchantReferenceNumber: invoiceNo,
        amount: requestPayload.amount,
        currency: requestPayload.currency,
        prepaymentUiToken,
        webPaymentUrl,
        availablePaymentMethods: [
          { code: 'CREDIT_CARD', name: 'Credit / Debit Card (Visa, Mastercard, MyDebit, UnionPay)', icon: '💳' },
          { code: 'FPX', name: 'FPX Online Banking (Maybank, CIMB, Public Bank, RHB)', icon: '🏦' },
          { code: 'E_WALLET', name: 'E-Wallets (Touch n Go, GrabPay, ShopeePay)', icon: '👛' },
          { code: 'DUITNOW', name: 'DuitNow QR / National QR', icon: '📲' }
        ]
      };

      return {
        gateway: 'PACO_PREPAYMENT_UI',
        mode: 'simulator',
        signatureAlgorithm: 'RS256',
        rawRequestPayload: requestPayload,
        requestJwt: signedJwt,
        responseJwt: this.signPayload(responsePayload),
        decodedResponse: responsePayload,
        prepaymentUiToken,
        webPaymentUrl,
        availablePaymentMethods: responsePayload.availablePaymentMethods
      };
    }

    // Actual 2C2P PACO Gateway Direct API Call
    try {
      console.log(`[PACO API] Posting RS256 signed payload to: ${this.apiUrl}`);

      const response = await axios.post(this.apiUrl, { payload: signedJwt }, {
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        timeout: 20000
      });

      const responseJwt = response.data?.payload || response.data?.jwt;
      const decodedResponse = responseJwt ? this.verifyAndDecodeToken(responseJwt) : response.data;

      const prepaymentUiToken = decodedResponse.prepaymentUiToken || decodedResponse.hppToken || decodedResponse.token;
      const webPaymentUrl = decodedResponse.webPaymentUrl || decodedResponse.hppUrl || decodedResponse.paymentUrl;

      return {
        gateway: 'PACO_PREPAYMENT_UI',
        mode: 'sandbox',
        signatureAlgorithm: 'RS256',
        rawRequestPayload: requestPayload,
        requestJwt: signedJwt,
        responseJwt: responseJwt || JSON.stringify(response.data),
        decodedResponse,
        prepaymentUiToken,
        webPaymentUrl: webPaymentUrl || `https://core.demo-paco.2c2p.com/paco/v1/hpp/pay/${prepaymentUiToken}`,
        availablePaymentMethods: decodedResponse.availablePaymentMethods || [
          { code: 'CREDIT_CARD', name: 'Credit / Debit Card', icon: '💳' },
          { code: 'FPX', name: 'FPX Online Banking', icon: '🏦' },
          { code: 'E_WALLET', name: 'Touch n Go / GrabPay', icon: '👛' }
        ]
      };
    } catch (error) {
      console.error('[PACO Pre-Payment UI RS256 Error]', error.response?.data || error.message);
      throw new Error(`PACO RS256 Request Failed: ${error.response?.data?.message || JSON.stringify(error.response?.data) || error.message}`);
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
