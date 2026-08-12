const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEYS_DIR = path.join(__dirname, '..', 'keys');

// Support multiple key naming conventions
const PRIVATE_KEY_PATHS = [
  path.join(KEYS_DIR, 'merchant_signing_private.pem'),
  path.join(KEYS_DIR, 'private.pem')
];

const PUBLIC_KEY_PATHS = [
  path.join(KEYS_DIR, 'merchant_signing_public.pem'),
  path.join(KEYS_DIR, 'public.pem')
];

const TWO2C2P_PUBLIC_KEY_PATHS = [
  path.join(KEYS_DIR, '2c2p_public.pem'),
  path.join(KEYS_DIR, '2c2p_public_key.pem'),
  path.join(KEYS_DIR, 'merchant_signing_public.pem')
];

/**
 * Ensures PEM RSA Keys exist in /keys directory and copies aliases if needed
 */
function initPemKeys() {
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
  }

  // Ensure standard aliases exist if merchant_signing_*.pem files are present
  const signingPrivate = path.join(KEYS_DIR, 'merchant_signing_private.pem');
  const signingPublic = path.join(KEYS_DIR, 'merchant_signing_public.pem');
  const stdPrivate = path.join(KEYS_DIR, 'private.pem');
  const stdPublic = path.join(KEYS_DIR, 'public.pem');
  const std2c2p = path.join(KEYS_DIR, '2c2p_public.pem');

  if (fs.existsSync(signingPrivate) && !fs.existsSync(stdPrivate)) {
    fs.copyFileSync(signingPrivate, stdPrivate);
  }
  if (fs.existsSync(signingPublic) && !fs.existsSync(stdPublic)) {
    fs.copyFileSync(signingPublic, stdPublic);
  }
  if (fs.existsSync(signingPublic) && !fs.existsSync(std2c2p)) {
    fs.copyFileSync(signingPublic, std2c2p);
  }

  // If no keys exist at all, generate fresh 2048-bit RSA pair
  if (!fs.existsSync(stdPrivate) || !fs.existsSync(stdPublic)) {
    console.log('[Keys Init] Generating 2048-bit RSA PEM keypair for RS256 signing...');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    fs.writeFileSync(stdPrivate, privateKey, 'utf8');
    fs.writeFileSync(stdPublic, publicKey, 'utf8');
    fs.writeFileSync(signingPrivate, privateKey, 'utf8');
    fs.writeFileSync(signingPublic, publicKey, 'utf8');
    fs.writeFileSync(std2c2p, publicKey, 'utf8');
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
  for (const p of PRIVATE_KEY_PATHS) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  return fs.readFileSync(PRIVATE_KEY_PATHS[1], 'utf8');
}

/**
 * Reads Merchant Public PEM Key
 */
function getPublicKey() {
  initPemKeys();
  if (process.env.PACO_PUBLIC_PEM) {
    return process.env.PACO_PUBLIC_PEM.replace(/\\n/g, '\n');
  }
  for (const p of PUBLIC_KEY_PATHS) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  return fs.readFileSync(PUBLIC_KEY_PATHS[1], 'utf8');
}

/**
 * Reads 2C2P Gateway Public PEM Key for response verification
 */
function get2C2PPublicKey() {
  initPemKeys();
  if (process.env.TWO2C2P_PUBLIC_PEM) {
    return process.env.TWO2C2P_PUBLIC_PEM.replace(/\\n/g, '\n');
  }
  for (const p of TWO2C2P_PUBLIC_KEY_PATHS) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  return getPublicKey();
}

module.exports = {
  initPemKeys,
  getPrivateKey,
  getPublicKey,
  get2C2PPublicKey,
  PRIVATE_KEY_PATH: PRIVATE_KEY_PATHS[0],
  PUBLIC_KEY_PATH: PUBLIC_KEY_PATHS[0]
};
