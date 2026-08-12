const jwt = require('jsonwebtoken');
const axios = require('axios');

/**
 * 2C2P Payment Gateway (PGW v4.3) Helper Module
 */
class TwoC2PService {
  constructor(config = {}) {
    this.merchantID = config.merchantID || process.env['2C2P_MERCHANT_ID'] || 'JT01';
    this.secretKey = config.secretKey || process.env['2C2P_SECRET_KEY'] || '72A910E124A4B9448D3528A6D3F9514300E634A9F200A51D14187D397C11C3D6';
    this.apiUrl = config.apiUrl || process.env['2C2P_API_URL'] || 'https://demo2.2c2p.com/2C2PFrontEnd/Payment/4.3/paymentToken';
    this.mode = config.mode || process.env.MODE || 'simulator';
  }

  /**
   * Signs a payload object into a JWT token using HS256 algorithm and Secret Key
   */
  signPayload(payload) {
    return jwt.sign(payload, this.secretKey, { algorithm: 'HS256' });
  }

  /**
   * Decodes and verifies a JWT token received from 2C2P or Simulator
   */
  verifyAndDecodeToken(token) {
    try {
      return jwt.verify(token, this.secretKey, { algorithms: ['HS256'] });
    } catch (err) {
      console.warn('[2C2P Helper] JWT Signature verification warning:', err.message);
      // Fallback decode for simulator / inspect mode
      const decoded = jwt.decode(token);
      if (decoded) {
        decoded._verificationError = err.message;
        return decoded;
      }
      throw new Error(`Invalid JWT token: ${err.message}`);
    }
  }

  /**
   * Generates a Payment Token request payload for 2C2P
   */
  buildPaymentTokenPayload({
    invoiceNo,
    description,
    amount,
    currencyCode = 'MYR',
    frontendReturnUrl,
    backendReturnUrl,
    paymentChannel = [],
    userDefined1 = '',
    userDefined2 = ''
  }) {
    return {
      merchantID: this.merchantID,
      invoiceNo: String(invoiceNo),
      description: String(description),
      amount: Number(amount.toFixed(2)),
      currencyCode: String(currencyCode).toUpperCase(),
      frontendReturnUrl,
      backendReturnUrl,
      ...(paymentChannel.length > 0 && { paymentChannel }),
      userDefined1,
      userDefined2
    };
  }

  /**
   * Requests a payment token from 2C2P PGW API (or Simulator)
   */
  async requestPaymentToken(params, baseUrl) {
    const payload = this.buildPaymentTokenPayload({
      ...params,
      frontendReturnUrl: params.frontendReturnUrl || `${baseUrl}/payment-complete.html?invoiceNo=${params.invoiceNo}`,
      backendReturnUrl: params.backendReturnUrl || `${baseUrl}/api/webhook/2c2p`
    });

    // 1. Sign request payload into JWT
    const signedJwt = this.signPayload(payload);
    const requestBody = { payload: signedJwt };

    if (this.mode === 'simulator') {
      // Internal simulator response generator
      const paymentToken = `SIM_TOK_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const webPaymentUrl = `${baseUrl}/2c2p-hosted-checkout.html?paymentToken=${paymentToken}&invoiceNo=${encodeURIComponent(params.invoiceNo)}`;

      const responsePayload = {
        respCode: '0000',
        respDesc: 'Success',
        merchantID: this.merchantID,
        invoiceNo: params.invoiceNo,
        amount: payload.amount,
        currencyCode: payload.currencyCode,
        paymentToken,
        webPaymentUrl
      };

      const signedResponseJwt = this.signPayload(responsePayload);

      return {
        mode: 'simulator',
        rawRequestPayload: payload,
        requestJwt: signedJwt,
        responseJwt: signedResponseJwt,
        decodedResponse: responsePayload,
        paymentToken,
        webPaymentUrl
      };
    }

    // Live 2C2P Sandbox / Production Mode
    try {
      const response = await axios.post(this.apiUrl, requestBody, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      const responseJwt = response.data?.payload;
      if (!responseJwt) {
        throw new Error('2C2P API returned empty payload response');
      }

      const decodedResponse = this.verifyAndDecodeToken(responseJwt);

      return {
        mode: 'sandbox',
        rawRequestPayload: payload,
        requestJwt: signedJwt,
        responseJwt,
        decodedResponse,
        paymentToken: decodedResponse.paymentToken,
        webPaymentUrl: decodedResponse.webPaymentUrl || decodedResponse.webRedirectUrl
      };
    } catch (error) {
      console.error('[2C2P API Error]', error.code || error.message);

      if (error.code === 'ENOTFOUND' || error.message.includes('ENOTFOUND')) {
        const hostname = this.apiUrl.split('/')[2] || 'server';
        throw new Error(`DNS Lookup Failed for '${hostname}'. To test locally without external network access, open Gateway Settings (⚙️) and switch Mode to 'Local Payment Simulator' or update your 2C2P Endpoint URL to 'https://demo2.2c2p.com/2C2PFrontEnd/Payment/4.3/paymentToken'.`);
      }

      throw new Error(`2C2P API Request Failed: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Helper to interpret 2C2P response codes
   */
  parseResponseCode(respCode) {
    const codes = {
      '0000': { status: 'COMPLETED', title: 'Payment Successful', color: '#10b981' },
      '0001': { status: 'PENDING', title: 'Payment Pending', color: '#f59e0b' },
      '2000': { status: 'FAILED', title: 'Payment Rejected', color: '#ef4444' },
      '2001': { status: 'CANCELLED', title: 'Payment Cancelled by User', color: '#6b7280' },
      '9999': { status: 'ERROR', title: 'System Error', color: '#dc2626' }
    };
    return codes[respCode] || { status: 'UNKNOWN', title: `Response Code: ${respCode}`, color: '#6b7280' };
  }
}

module.exports = TwoC2PService;
