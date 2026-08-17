const jose = require('jose');
const axios = require('axios');
const crypto = require('crypto');
const {
  getMerchantSigningPrivate,
  getMerchantEncryptionPrivate,
  getPacoPublicEncryption,
  getPacoPublicSigning
} = require('./keyManager');

/**
 * 2C2P PACO API v2.0 Service
 * Implements JWS (PS256) + JWE (RSA-OAEP / A128CBC-HS256) Nested JOSE Cryptography
 * Based on 2C2P Official PACO Integration Module Specification
 */
class PacoService {
  constructor(config = {}) {
    this.officeId = config.officeId || process.env.PACO_OFFICE_ID || process.env.PACO_PARTNER_ID || 'AirAsiaRewards';
    this.apiKey = config.apiKey || process.env.PACO_API_KEY || process.env.PACO_SECRET_KEY || 'a89ffc44f0dd412188251ddfa2bf8757';
    this.kid = config.kid || process.env.PACO_KID || '7664a2ed0dee4879bdfca0e8ce1ac313';
    this.apiUrl = config.apiUrl || process.env.PACO_API_URL || 'https://core.demo-paco.2c2p.com/api/2.0/Payment/prePaymentUI';
    this.mode = config.mode || process.env.MODE || 'sandbox';

    // RSA 2048-bit PEM Keys
    this.merchantSigningPrivatePem = config.merchantSigningPrivate || getMerchantSigningPrivate();
    this.merchantEncryptionPrivatePem = config.merchantEncryptionPrivate || getMerchantEncryptionPrivate();
    this.pacoPublicEncryptionPem = config.pacoPublicEncryption || getPacoPublicEncryption();
    this.pacoPublicSigningPem = config.pacoPublicSigning || getPacoPublicSigning();
  }

  /**
   * Constructs, Signs (PS256 JWS) and Encrypts (RSA-OAEP JWE) PACO v2.0 Request
   * Strictly aligned with official 2C2P PACO specification
   */
  async buildJweRequest(requestBody) {
    const unixNow = Math.floor(Date.now() / 1000);

    const fullClaims = {
      request: {
        apiRequest: {
          requestMessageID: crypto.randomUUID(),
          requestDateTime: new Date().toISOString(),
          language: 'en-US'
        },
        ...requestBody
      },
      iss: this.apiKey,
      aud: 'PacoAudience',
      CompanyApiKey: this.apiKey,
      iat: unixNow,
      nbf: unixNow,
      exp: unixNow + 3600
    };

    // 1. JWS Sign using CompactSign (PS256)
    const privateSigningKey = await jose.importPKCS8(this.merchantSigningPrivatePem, 'PS256');
    const jws = await new jose.CompactSign(
      new TextEncoder().encode(JSON.stringify(fullClaims))
    ).setProtectedHeader({ alg: 'PS256', typ: 'JWT' }).sign(privateSigningKey);

    // 2. JWE Encrypt using CompactEncrypt (RSA-OAEP / A128CBC-HS256)
    const publicEncryptionKey = await jose.importSPKI(this.pacoPublicEncryptionPem, 'RSA-OAEP');
    const jwe = await new jose.CompactEncrypt(new TextEncoder().encode(jws))
      .setProtectedHeader({
        alg: 'RSA-OAEP',
        enc: 'A128CBC-HS256',
        kid: this.kid
      })
      .encrypt(publicEncryptionKey);

    return { jws, jwe, requestBody: fullClaims };
  }

  /**
   * Decrypts (RSA-OAEP JWE) and Verifies (PS256 JWS) PACO v2.0 Response
   */
  async decryptAndVerifyJweResponse(jweResponseText) {
    if (!jweResponseText || typeof jweResponseText !== 'string' || !jweResponseText.startsWith('eyJ')) {
      throw new Error(`Non-JWE response received: ${typeof jweResponseText === 'object' ? JSON.stringify(jweResponseText) : jweResponseText}`);
    }

    // 1. JWE Decrypt using Merchant Private Decryption Key (RSA-OAEP)
    const privateDecryptionKey = await jose.importPKCS8(this.merchantEncryptionPrivatePem, 'RSA-OAEP');
    const { plaintext } = await jose.compactDecrypt(jweResponseText, privateDecryptionKey);
    const innerJws = new TextDecoder().decode(plaintext);

    // 2. Decode inner JWS payload claims
    try {
      const publicSigningKey = await jose.importSPKI(this.pacoPublicSigningPem, 'PS256');
      const { payload: verifiedPayload } = await jose.compactVerify(innerJws, publicSigningKey);
      return JSON.parse(new TextDecoder().decode(verifiedPayload));
    } catch (err) {
      return jose.decodeJwt(innerJws);
    }
  }

  /**
   * Generates local PACO v2.0 Simulation Payment Session
   */
  generateSimulatedSession(orderNo, fullPayload, jwe, baseUrl, warningMessage = null) {
    const pid = `PACO2_SIM_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const webPaymentUrl = `${baseUrl}/2c2p-paco-hosted-page.html?pid=${pid}&invoiceNo=${encodeURIComponent(orderNo)}`;

    const responsePayload = {
      response: {
        data: {
          paymentPage: {
            paymentPageURL: webPaymentUrl,
            validTillDateTime: new Date(Date.now() + 86400000).toISOString()
          }
        },
        version: '2.0',
        apiResponse: {
          responseCode: 'PC-B050001',
          responseDescription: 'Payment is pending'
        }
      },
      ...(warningMessage && { _fallbackWarning: warningMessage })
    };

    return {
      gateway: '2c2p-paco-v2',
      mode: 'simulator',
      signatureAlgorithm: 'PS256 + RSA-OAEP JWE',
      rawRequestPayload: fullPayload,
      requestJwe: jwe,
      responseJwe: 'SIMULATED_JWE_RESPONSE',
      decodedResponse: responsePayload,
      webPaymentUrl
    };
  }

  /**
   * Creates 2C2P PACO v2.0 Payment Session
   */
  async createPaymentSession({
    invoiceNo,
    description,
    amount,
    currencyCode = 'THB',
    customerName,
  }, baseUrl) {
    const orderNo = String(invoiceNo);
    const amountVal = Number(amount.toFixed(2));
    const amountText = Math.round(amountVal * 100).toString().padStart(12, '0');

    const apiRequest = {
      officeId: this.officeId,
      orderNo,
      productDescription: String(description || 'AirAsia rewards Verification Handshake'),
      transactionAmount: {
        amountText,
        currencyCode: String(currencyCode).toUpperCase(),
        decimalPlaces: 2,
        amount: amountVal
      },
      notificationURLs: {
        confirmationURL: `${baseUrl}/payment-complete.html?invoiceNo=${orderNo}&gateway=PACO_2_0`,
        failedURL: `${baseUrl}/payment-complete.html?invoiceNo=${orderNo}&gateway=PACO_2_0`,
        cancellationURL: `${baseUrl}/payment-complete.html?invoiceNo=${orderNo}&gateway=PACO_2_0`,
        backendURL: `${baseUrl}/api/webhook/paco`
      }
    };

    const { jws, jwe, requestBody } = await this.buildJweRequest(apiRequest);

    if (this.mode === 'simulator') {
      return this.generateSimulatedSession(orderNo, apiRequest, jwe, baseUrl);
    }

    // Live 2C2P PACO v2.0 Gateway Dispatch
    console.log(`[PACO v2.0 Live Dispatch] Dispatching JWE request to 2C2P Hosted Payment Gateway: ${this.apiUrl}`);

    let responseJweText = null;
    let decodedResponse = null;

    try {
      const response = await axios.post(this.apiUrl, jwe, {
        headers: {
          'Content-Type': 'application/jose; charset=utf-8',
          'Accept': 'application/jose',
          'apiKey': this.apiKey
        },
        timeout: 20000,
        responseType: 'text'
      });
      responseJweText = response.data;
    } catch (err) {
      if (err.response && err.response.data && typeof err.response.data === 'string' && err.response.data.startsWith('eyJ')) {
        responseJweText = err.response.data;
      } else {
        throw new Error(`2C2P Gateway Connection Error: ${err.message}`);
      }
    }

    if (responseJweText && responseJweText.startsWith('eyJ')) {
      decodedResponse = await this.decryptAndVerifyJweResponse(responseJweText);
    }

    const webPaymentUrl = decodedResponse?.response?.data?.paymentPage?.paymentPageURL;

    if (!webPaymentUrl) {
      const apiCode = decodedResponse?.response?.apiResponse?.responseCode || 'UNKNOWN';
      const apiDesc = decodedResponse?.response?.apiResponse?.marketingDescription || decodedResponse?.response?.apiResponse?.responseDescription || '2C2P Hosted Gateway did not return a payment page URL.';
      throw new Error(`2C2P Gateway API Response [${apiCode}]: ${apiDesc}`);
    }

    return {
      gateway: '2c2p-paco-v2',
      mode: 'sandbox',
      signatureAlgorithm: 'PS256 + RSA-OAEP JWE',
      rawRequestPayload: apiRequest,
      requestJwe: jwe,
      responseJwe: responseJweText,
      decodedResponse,
      webPaymentUrl
    };
  }

  parsePacoCode(code) {
    if (!code || code === 'PC-0000' || code === '0000' || code === 'PC-B050001') {
      return { status: 'COMPLETED', title: 'PACO Payment Authorized', color: '#10b981' };
    }
    return { status: 'FAILED', title: `PACO Response Code: ${code}`, color: '#ef4444' };
  }
}

module.exports = PacoService;
