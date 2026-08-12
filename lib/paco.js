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
 * Based on 2C2P PACO API v2.0 Handshake Specification
 */
class PacoService {
  constructor(config = {}) {
    this.officeId = config.officeId || process.env.PACO_OFFICE_ID || process.env.PACO_PARTNER_ID || 'AirAsiaRewards';
    this.apiKey = config.apiKey || process.env.PACO_API_KEY || process.env.PACO_SECRET_KEY || 'a89ffc44f0dd412188251ddfa2bf8757';
    this.kid = config.kid || process.env.PACO_KID || '7664a2ed0dee4879bdfca0e8ce1ac313';
    this.apiUrl = config.apiUrl || process.env.PACO_API_URL || 'https://core.demo-paco.2c2p.com/api/2.0/Payment/prePaymentUI';
    this.mode = config.mode || process.env.MODE || 'simulator';

    // RSA 2048-bit PEM Keys
    this.merchantSigningPrivatePem = config.merchantSigningPrivate || getMerchantSigningPrivate();
    this.merchantEncryptionPrivatePem = config.merchantEncryptionPrivate || getMerchantEncryptionPrivate();
    this.pacoPublicEncryptionPem = config.pacoPublicEncryption || getPacoPublicEncryption();
    this.pacoPublicSigningPem = config.pacoPublicSigning || getPacoPublicSigning();
  }

  /**
   * Constructs, Signs (PS256 JWS) and Encrypts (RSA-OAEP JWE) PACO v2.0 Request
   */
  async buildJweRequest(requestPayload) {
    const unixNow = Math.floor(Date.now() / 1000);

    const fullPayload = {
      request: requestPayload,
      iss: this.apiKey,
      aud: 'PacoAudience',
      CompanyApiKey: this.apiKey,
      iat: unixNow,
      nbf: unixNow,
      exp: unixNow + 3600
    };

    // 1. JWS Sign using Merchant Private Signing Key (PS256)
    const privateSigningKey = await jose.importPKCS8(this.merchantSigningPrivatePem, 'PS256');
    const jws = await new jose.CompactSign(
      new TextEncoder().encode(JSON.stringify(fullPayload))
    )
      .setProtectedHeader({ alg: 'PS256', typ: 'JWT' })
      .sign(privateSigningKey);

    // 2. JWE Encrypt using 2C2P Public Encryption Key (RSA-OAEP / A128CBC-HS256)
    const publicEncryptionKey = await jose.importSPKI(this.pacoPublicEncryptionPem, 'RSA-OAEP');
    const jwe = await new jose.CompactEncrypt(
      new TextEncoder().encode(jws)
    )
      .setProtectedHeader({
        alg: 'RSA-OAEP',
        enc: 'A128CBC-HS256',
        kid: this.kid
      })
      .encrypt(publicEncryptionKey);

    return { jws, jwe, fullPayload };
  }

  /**
   * Decrypts (RSA-OAEP JWE) and Verifies (PS256 JWS) PACO v2.0 Response
   */
  async decryptAndVerifyJweResponse(jweResponseText) {
    if (!jweResponseText || !jweResponseText.startsWith('eyJ')) {
      throw new Error(`Non-JWE response received: ${jweResponseText}`);
    }

    // 1. JWE Decrypt using Merchant Private Decryption Key (RSA-OAEP)
    const privateDecryptionKey = await jose.importPKCS8(this.merchantEncryptionPrivatePem, 'RSA-OAEP');
    const { plaintext } = await jose.compactDecrypt(jweResponseText, privateDecryptionKey);
    const innerJws = new TextDecoder().decode(plaintext);

    // 2. JWS Verify using 2C2P Public Signing Key (PS256)
    const publicSigningKey = await jose.importSPKI(this.pacoPublicSigningPem, 'PS256');
    const { payload: verifiedPayload } = await jose.compactVerify(innerJws, publicSigningKey);

    return JSON.parse(new TextDecoder().decode(verifiedPayload));
  }

  /**
   * Creates 2C2P PACO v2.0 Payment Session
   */
  async createPaymentSession({
    invoiceNo,
    description,
    amount,
    currencyCode = 'MYR',
    customerName,
    customerEmail
  }, baseUrl) {
    const requestMessageID = crypto.randomUUID();
    const orderNo = String(invoiceNo);

    // Format PACO v2.0 transaction amount with padded string representation
    const amountVal = Number(amount.toFixed(2));
    const amountCents = Math.round(amountVal * 100);
    const amountText = String(amountCents).padStart(12, '0');

    const requestPayload = {
      apiRequest: {
        requestMessageID,
        requestDateTime: new Date().toISOString(),
        language: 'en-US'
      },
      officeId: this.officeId,
      orderNo,
      productDescription: String(description || 'Purchase at Nexus Gear Store'),
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

    const { jws, jwe, fullPayload } = await this.buildJweRequest(requestPayload);

    if (this.mode === 'simulator') {
      const pid = `PACO2_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
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
        }
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

    // Live 2C2P PACO v2.0 Gateway Dispatch
    try {
      console.log(`[PACO v2.0 API] Dispatching JWE request to: ${this.apiUrl}`);

      const response = await axios.post(this.apiUrl, jwe, {
        headers: {
          'Content-Type': 'application/jose; charset=utf-8',
          'Accept': 'application/jose',
          'apiKey': this.apiKey
        },
        timeout: 25000
      });

      const responseJweText = response.data;
      const decodedResponse = await this.decryptAndVerifyJweResponse(responseJweText);

      const webPaymentUrl = decodedResponse.response?.data?.paymentPage?.paymentPageURL;

      return {
        gateway: '2c2p-paco-v2',
        mode: 'sandbox',
        signatureAlgorithm: 'PS256 + RSA-OAEP JWE',
        rawRequestPayload: fullPayload,
        requestJwe: jwe,
        responseJwe: responseJweText,
        decodedResponse,
        webPaymentUrl: webPaymentUrl || `${baseUrl}/2c2p-paco-hosted-page.html?orderNo=${orderNo}`
      };
    } catch (error) {
      console.error('[PACO v2.0 API Error]', error.code || error.message);

      if (error.code === 'ENOTFOUND' || error.message.includes('ENOTFOUND')) {
        const hostname = this.apiUrl.split('/')[2] || 'server';
        throw new Error(`DNS Lookup Failed for '${hostname}'. To test locally without external network access, open Gateway Settings (⚙️) and switch Mode to 'Local Payment Simulator'.`);
      }

      throw new Error(`2C2P PACO v2.0 Request Failed: ${error.response?.data || error.message}`);
    }
  }

  parsePacoCode(code) {
    if (!code || code === 'PC-0000' || code === '0000' || code === 'PC-B050001') {
      return { status: 'COMPLETED', title: 'PACO Payment Authorized', color: '#10b981' };
    }
    return { status: 'FAILED', title: `PACO Response Code: ${code}`, color: '#ef4444' };
  }
}

module.exports = PacoService;
