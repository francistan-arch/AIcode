const fs = require('fs');
const path = require('path');
const jose = require('jose');
const crypto = require('crypto');
const axios = require('axios');
const { initPemKeys } = require('./lib/keyManager');

async function runLiveTest() {
  console.log('======================================================');
  console.log('2C2P PACO v2.0 Live AirAsiaRewards Handshake Test');
  console.log('======================================================\n');

  initPemKeys();

  const officeId = "AirAsiaRewards";
  const apiKey = "a89ffc44f0dd412188251ddfa2bf8757";
  const kid = "7664a2ed0dee4879bdfca0e8ce1ac313";
  const baseUrl = "https://core.demo-paco.2c2p.com/api/2.0";

  const keyDir = path.resolve(__dirname, 'keys');
  const merchantSigningPath = path.join(keyDir, 'merchant_signing_private.pem');
  const merchantDecryptionPath = path.join(keyDir, 'merchant_encryption_private.pem');

  const merchantPrivateSigningKey = fs.readFileSync(merchantSigningPath, 'utf8');
  const merchantPrivateDecryptionKey = fs.readFileSync(merchantDecryptionPath, 'utf8');
  const pacoEncryptionPath = path.join(keyDir, '2c2p_public_encryption.pem');
  const pacoPublicEncryptionKey = fs.readFileSync(pacoEncryptionPath, 'utf8');

  const orderNo = "diagnose_" + Date.now();
  const requestMessageID = crypto.randomUUID();
  const requestDateTime = new Date().toISOString();

  const request = {
    apiRequest: {
      requestMessageID,
      requestDateTime,
      language: "en-US"
    },
    officeId,
    orderNo,
    productDescription: "AirAsia rewards Verification Handshake",
    transactionAmount: {
      amountText: "000000005050",
      currencyCode: "THB",
      decimalPlaces: 2,
      amount: 50.5
    },
    notificationURLs: {
      confirmationURL: "http://localhost:3000/subscriptions/callback",
      failedURL: "http://localhost:3000/subscriptions/callback",
      cancellationURL: "http://localhost:3000/subscriptions/callback",
      backendURL: "http://localhost:3000/subscriptions/callback"
    }
  };

  const unixNow = Math.floor(Date.now() / 1000);
  const payload = {
    request,
    iss: apiKey,
    aud: "PacoAudience",
    CompanyApiKey: apiKey,
    iat: unixNow,
    nbf: unixNow,
    exp: unixNow + 3600
  };

  console.log('1. Constructing JWS payload claims (PS256)...');
  const privateSigningKey = await jose.importPKCS8(merchantPrivateSigningKey, 'PS256');
  const jws = await new jose.CompactSign(
    new TextEncoder().encode(JSON.stringify(payload))
  )
    .setProtectedHeader({ alg: 'PS256', typ: 'JWT' })
    .sign(privateSigningKey);

  console.log('2. Encrypting to JWE (RSA-OAEP / A128CBC-HS256)...');
  const publicEncryptionKey = await jose.importSPKI(pacoPublicEncryptionKey, 'RSA-OAEP');
  const jwe = await new jose.CompactEncrypt(
    new TextEncoder().encode(jws)
  )
    .setProtectedHeader({
      alg: 'RSA-OAEP',
      enc: 'A128CBC-HS256',
      kid
    })
    .encrypt(publicEncryptionKey);

  console.log('3. Dispatching raw JWE POST body to 2C2P PACO Live Gateway...');
  console.log(`   URL: ${baseUrl}/Payment/prePaymentUI\n`);

  let responseJwe = null;
  try {
    const response = await axios.post(`${baseUrl}/Payment/prePaymentUI`, jwe, {
      headers: {
        'Content-Type': 'application/jose; charset=utf-8',
        'Accept': 'application/jose',
        'apiKey': apiKey
      },
      timeout: 20000
    });
    responseJwe = response.data;
  } catch (err) {
    if (err.response && err.response.data && typeof err.response.data === 'string' && err.response.data.startsWith('eyJ')) {
      responseJwe = err.response.data;
    } else {
      console.error('Network Error:', err.message);
      return;
    }
  }

  if (responseJwe) {
    console.log('🔐 Intercepted JWE response token from 2C2P Sandbox.');
    const privateDecryptionKey = await jose.importPKCS8(merchantPrivateDecryptionKey, 'RSA-OAEP');
    const { plaintext } = await jose.compactDecrypt(responseJwe, privateDecryptionKey);
    const innerJws = new TextDecoder().decode(plaintext);

    const decodedClaims = jose.decodeJwt(innerJws);

    console.log('\n🎉 LIVE 2C2P PACO SANDBOX DECRYPTED RESPONSE CLAIMS:');
    console.log(JSON.stringify(decodedClaims, null, 2));

    const paymentUrl = decodedClaims?.response?.data?.paymentPage?.paymentPageURL;
    if (paymentUrl) {
      console.log('\n🔗 LIVE HOSTED PAYMENT PAGE URL GENERATED:');
      console.log(paymentUrl);
    }
  }
}

runLiveTest();
