const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEYS_DIR = path.join(__dirname, '..', 'keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'public.pem');
const TWO2C2P_PUBLIC_KEY_PATH = path.join(KEYS_DIR, '2c2p_public.pem');

/**
 * Ensures PEM RSA Keys exist in /keys directory
 */
function initPemKeys() {
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
  }

  if (!fs.existsSync(PRIVATE_KEY_PATH) || !fs.existsSync(PUBLIC_KEY_PATH)) {
    console.log('[Keys Init] Generating 2048-bit RSA PEM keypair for RS256 signing...');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, 'utf8');
    fs.writeFileSync(PUBLIC_KEY_PATH, publicKey, 'utf8');
    fs.writeFileSync(TWO2C2P_PUBLIC_KEY_PATH, publicKey, 'utf8'); // Default 2C2P public key for demo
  }
}

/**
 * Reads Private PEM Key
 */
function getPrivateKey() {
  initPemKeys();
  if (process.env.PACO_PRIVATE_PEM) {
    return process.env.PACO_PRIVATE_PEM.replace(/\\n/g, '\n');
  }
  return fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
}

/**
 * Reads Merchant Public PEM Key
 */
function getPublicKey() {
  initPemKeys();
  if (process.env.PACO_PUBLIC_PEM) {
    return process.env.PACO_PUBLIC_PEM.replace(/\\n/g, '\n');
  }
  return fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
}

/**
 * Reads 2C2P Gateway Public PEM Key for response verification
 */
function get2C2PPublicKey() {
  initPemKeys();
  if (process.env.TWO2C2P_PUBLIC_PEM) {
    return process.env.TWO2C2P_PUBLIC_PEM.replace(/\\n/g, '\n');
  }
  if (fs.existsSync(TWO2C2P_PUBLIC_KEY_PATH)) {
    return fs.readFileSync(TWO2C2P_PUBLIC_KEY_PATH, 'utf8');
  }
  return getPublicKey();
}

module.exports = {
  initPemKeys,
  getPrivateKey,
  getPublicKey,
  get2C2PPublicKey,
  PRIVATE_KEY_PATH,
  PUBLIC_KEY_PATH,
  TWO2C2P_PUBLIC_KEY_PATH
};
