const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEYS_DIR = path.join(__dirname, '..', 'keys');

// 2C2P PACO API v2.0 Key Paths
const PATHS = {
  merchantSigningPrivate: path.join(KEYS_DIR, 'merchant_signing_private.pem'),
  merchantSigningPublic: path.join(KEYS_DIR, 'merchant_signing_public.pem'),
  merchantEncryptionPrivate: path.join(KEYS_DIR, 'merchant_encryption_private.pem'),
  merchantEncryptionPublic: path.join(KEYS_DIR, 'merchant_encryption_public.pem'),
  pacoPublicEncryption: path.join(KEYS_DIR, '2c2p_public_encryption.pem'),
  pacoPublicSigning: path.join(KEYS_DIR, '2c2p_public_signing.pem'),
  // Fallbacks
  stdPrivate: path.join(KEYS_DIR, 'private.pem'),
  stdPublic: path.join(KEYS_DIR, 'public.pem')
};

/**
 * Ensures all PACO 2.0 RSA PEM Keys exist in /keys directory
 */
function initPemKeys() {
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
  }

  // Generate merchant signing key pair if missing
  if (!fs.existsSync(PATHS.merchantSigningPrivate) || !fs.existsSync(PATHS.merchantSigningPublic)) {
    console.log('[Keys Init] Generating 2048-bit RSA PEM Merchant Signing Keys...');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    fs.writeFileSync(PATHS.merchantSigningPrivate, privateKey, 'utf8');
    fs.writeFileSync(PATHS.merchantSigningPublic, publicKey, 'utf8');
    fs.writeFileSync(PATHS.stdPrivate, privateKey, 'utf8');
    fs.writeFileSync(PATHS.stdPublic, publicKey, 'utf8');
  }

  // Generate merchant encryption key pair if missing
  if (!fs.existsSync(PATHS.merchantEncryptionPrivate) || !fs.existsSync(PATHS.merchantEncryptionPublic)) {
    console.log('[Keys Init] Generating 2048-bit RSA PEM Merchant Encryption Keys...');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    fs.writeFileSync(PATHS.merchantEncryptionPrivate, privateKey, 'utf8');
    fs.writeFileSync(PATHS.merchantEncryptionPublic, publicKey, 'utf8');
  }

  // Generate default 2C2P PACO Public Encryption and Signing Keys if missing (for demo/simulator)
  if (!fs.existsSync(PATHS.pacoPublicEncryption)) {
    const pubEnc = fs.readFileSync(PATHS.merchantEncryptionPublic, 'utf8');
    fs.writeFileSync(PATHS.pacoPublicEncryption, pubEnc, 'utf8');
  }

  if (!fs.existsSync(PATHS.pacoPublicSigning)) {
    const pubSign = fs.readFileSync(PATHS.merchantSigningPublic, 'utf8');
    fs.writeFileSync(PATHS.pacoPublicSigning, pubSign, 'utf8');
  }
}

function getMerchantSigningPrivate() {
  initPemKeys();
  if (process.env.PACO_MERCHANT_SIGNING_PRIVATE) {
    return process.env.PACO_MERCHANT_SIGNING_PRIVATE.replace(/\\n/g, '\n');
  }
  return fs.readFileSync(PATHS.merchantSigningPrivate, 'utf8');
}

function getMerchantEncryptionPrivate() {
  initPemKeys();
  if (process.env.PACO_MERCHANT_ENCRYPTION_PRIVATE) {
    return process.env.PACO_MERCHANT_ENCRYPTION_PRIVATE.replace(/\\n/g, '\n');
  }
  return fs.readFileSync(PATHS.merchantEncryptionPrivate, 'utf8');
}

function getPacoPublicEncryption() {
  initPemKeys();
  if (process.env.PACO_PUBLIC_ENCRYPTION) {
    return process.env.PACO_PUBLIC_ENCRYPTION.replace(/\\n/g, '\n');
  }
  return fs.readFileSync(PATHS.pacoPublicEncryption, 'utf8');
}

function getPacoPublicSigning() {
  initPemKeys();
  if (process.env.PACO_PUBLIC_SIGNING) {
    return process.env.PACO_PUBLIC_SIGNING.replace(/\\n/g, '\n');
  }
  return fs.readFileSync(PATHS.pacoPublicSigning, 'utf8');
}

function getKeyDetails() {
  initPemKeys();
  const results = {};
  const hashList = {};

  const fileMap = {
    merchantSigningPrivate: { path: PATHS.merchantSigningPrivate, name: 'merchant_signing_private.pem', label: 'Merchant Private Signing Key (PS256)' },
    merchantSigningPublic: { path: PATHS.merchantSigningPublic, name: 'merchant_signing_public.pem', label: 'Merchant Public Signing Key (Given to 2C2P)' },
    merchantEncryptionPrivate: { path: PATHS.merchantEncryptionPrivate, name: 'merchant_encryption_private.pem', label: 'Merchant Private Decryption Key (RSA-OAEP)' },
    merchantEncryptionPublic: { path: PATHS.merchantEncryptionPublic, name: 'merchant_encryption_public.pem', label: 'Merchant Public Encryption Key (Given to 2C2P)' },
    pacoPublicEncryption: { path: PATHS.pacoPublicEncryption, name: '2c2p_public_encryption.pem', label: '2C2P Public Encryption Key (Provided by 2C2P)' },
    pacoPublicSigning: { path: PATHS.pacoPublicSigning, name: '2c2p_public_signing.pem', label: '2C2P Public Signing Key (Provided by 2C2P)' }
  };

  for (const [key, meta] of Object.entries(fileMap)) {
    try {
      const content = fs.readFileSync(meta.path, 'utf8').trim();
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      
      results[key] = {
        key,
        fileName: meta.name,
        label: meta.label,
        exists: true,
        length: content.length,
        hash,
        shortHash: hash.substring(0, 16) + '...',
        pem: content
      };

      if (!hashList[hash]) hashList[hash] = [];
      hashList[hash].push(meta.name);
    } catch (e) {
      results[key] = { key, fileName: meta.name, label: meta.label, exists: false, error: e.message };
    }
  }

  // Check for duplicate keys
  for (const item of Object.values(results)) {
    if (item.hash && hashList[item.hash] && hashList[item.hash].length > 1) {
      item.isDuplicate = true;
      item.duplicateWith = hashList[item.hash].filter(f => f !== item.fileName);
    } else {
      item.isDuplicate = false;
    }
  }

  return results;
}

module.exports = {
  initPemKeys,
  getMerchantSigningPrivate,
  getMerchantEncryptionPrivate,
  getPacoPublicEncryption,
  getPacoPublicSigning,
  getKeyDetails,
  // Backward compatibility exports
  getPrivateKey: getMerchantSigningPrivate,
  getPublicKey: () => fs.readFileSync(PATHS.merchantSigningPublic, 'utf8'),
  get2C2PPublicKey: getPacoPublicSigning,
  PRIVATE_KEY_PATH: PATHS.merchantSigningPrivate,
  PUBLIC_KEY_PATH: PATHS.merchantSigningPublic
};

