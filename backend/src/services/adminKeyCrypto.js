import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

/**
 * Versioned admin API-key storage format:
 *   scrypt$N$r$p$saltB64$urlsafe$hashB64
 *
 * - N/r/p: Node scrypt parameters (interactive login budget)
 * - saltB64 / hashB64: base64url (no padding)
 * - literal "urlsafe" marks encoding
 *
 * Defaults: N=16384 (2^14), r=8, p=1 — reasonable for interactive admin login.
 */
export const ADMIN_KEY_SCRYPT_N = 16384;
export const ADMIN_KEY_SCRYPT_R = 8;
export const ADMIN_KEY_SCRYPT_P = 1;
export const ADMIN_KEY_SCRYPT_KEYLEN = 32;
export const ADMIN_KEY_SALT_BYTES = 16;
export const ADMIN_KEY_PREFIX = "scrypt$";

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromB64url(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = String(str).replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

export function isHashedAdminKey(stored) {
  return typeof stored === "string" && stored.startsWith(ADMIN_KEY_PREFIX);
}

export function isLegacyPlaintextAdminKey(stored) {
  return typeof stored === "string" && stored.length > 0 && !isHashedAdminKey(stored);
}

export function keyHintFromPlaintext(plaintext) {
  const s = String(plaintext || "");
  if (s.length < 4) return s;
  return s.slice(-4);
}

export function generateAdminApiKey() {
  return randomBytes(32).toString("base64url");
}

export function hashAdminKey(plaintext, { N = ADMIN_KEY_SCRYPT_N, r = ADMIN_KEY_SCRYPT_R, p = ADMIN_KEY_SCRYPT_P } = {}) {
  if (typeof plaintext !== "string" || !plaintext) {
    throw new Error("Admin key plaintext required");
  }
  const salt = randomBytes(ADMIN_KEY_SALT_BYTES);
  const derived = scryptSync(plaintext, salt, ADMIN_KEY_SCRYPT_KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${b64url(salt)}$urlsafe$${b64url(derived)}`;
}

function parseStoredHash(stored) {
  if (!isHashedAdminKey(stored)) return null;
  const parts = stored.split("$");
  // scrypt $ N $ r $ p $ salt $ urlsafe $ hash
  if (parts.length !== 7) return null;
  const [, nStr, rStr, pStr, saltB64, enc, hashB64] = parts;
  if (enc !== "urlsafe") return null;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (![N, r, p].every((x) => Number.isFinite(x) && x > 0)) return null;
  if (!saltB64 || !hashB64 || !/^[A-Za-z0-9_-]+$/.test(saltB64) || !/^[A-Za-z0-9_-]+$/.test(hashB64)) {
    return null;
  }
  let salt;
  let expected;
  try {
    salt = fromB64url(saltB64);
    expected = fromB64url(hashB64);
  } catch {
    return null;
  }
  if (!salt.length || !expected.length) return null;
  return { N, r, p, salt, expected };
}

export function verifyAdminKey(plaintext, stored) {
  if (typeof plaintext !== "string" || !plaintext || typeof stored !== "string" || !stored) {
    return false;
  }
  if (!isHashedAdminKey(stored)) {
    return false;
  }
  const parsed = parseStoredHash(stored);
  if (!parsed) return false;
  let derived;
  try {
    derived = scryptSync(plaintext, parsed.salt, parsed.expected.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
    });
  } catch {
    return false;
  }
  if (derived.length !== parsed.expected.length) return false;
  return timingSafeEqual(derived, parsed.expected);
}
