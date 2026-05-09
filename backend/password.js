// backend/password.js
// Password hashing and verification helpers.
// argon2id is the canonical scheme; legacy SHA-256 hashes are accepted on
// verify so existing accounts keep working, and the caller is told to rehash.

const crypto = require('crypto');
const argon2 = require('argon2');

async function hashPassword(plaintext) {
  return argon2.hash(String(plaintext), { type: argon2.argon2id });
}

function legacySha256(plaintext) {
  return crypto.createHash('sha256').update(String(plaintext)).digest('hex');
}

function isArgonHash(stored) {
  return typeof stored === 'string' && stored.startsWith('$argon2');
}

async function verifyPassword(plaintext, storedHash) {
  if (typeof storedHash !== 'string' || storedHash.length === 0) {
    return { valid: false, needsRehash: false };
  }
  if (isArgonHash(storedHash)) {
    let ok = false;
    try {
      ok = await argon2.verify(storedHash, String(plaintext));
    } catch (_) {
      ok = false;
    }
    return { valid: ok, needsRehash: false };
  }
  // Legacy SHA-256 hex digest. Compare in constant time when lengths match.
  const computed = legacySha256(plaintext);
  if (computed.length !== storedHash.length) {
    return { valid: false, needsRehash: false };
  }
  const a = Buffer.from(computed, 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  const equal = crypto.timingSafeEqual(a, b);
  if (equal) return { valid: true, needsRehash: true };
  return { valid: false, needsRehash: false };
}

module.exports = {
  hashPassword,
  verifyPassword,
  isArgonHash
};
