const { randomBytes, scryptSync, timingSafeEqual } = require("crypto");

// Passwords are stored as "scrypt$<salt>$<hash>" (both base64url).
// scrypt is a memory-hard key derivation function built into Node.js,
// so no native dependency is needed.
const KEY_LENGTH = 64;
const MIN_PASSWORD_LENGTH = 8;

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, KEY_LENGTH);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string") {
    return false;
  }

  const [algorithm, saltPart, hashPart] = stored.split("$");
  if (algorithm !== "scrypt" || !saltPart || !hashPart) {
    return false;
  }

  const expected = Buffer.from(hashPart, "base64url");
  const actual = scryptSync(String(password), Buffer.from(saltPart, "base64url"), expected.length);
  // Constant-time comparison, so the response time does not leak the hash.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function isPasswordStrongEnough(password) {
  return typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH;
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  hashPassword,
  verifyPassword,
  isPasswordStrongEnough
};
