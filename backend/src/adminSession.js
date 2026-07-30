import { createHmac, createHash, randomBytes, timingSafeEqual } from "crypto";
import { db } from "./db.js";

export const ADMIN_SESSION_COOKIE = "daogreen_admin_session";
export const ADMIN_SESSION_VERSION_KEY = "adminSessionVersion";
export const ADMIN_SESSION_REVOKED = Symbol("ADMIN_SESSION_REVOKED");

const MAX_MAGIC_TOKEN_CHARS = 512;
const MAX_SESSION_TOKEN_CHARS = 2048;
const MAX_FUTURE_IAT_SECONDS = 5 * 60;
/** Token format / HMAC version (not the revocable session version). */
const TOKEN_FORMAT_VERSION = 1;

const DEFAULT_PROD_ORIGINS = [
  "http://62.233.35.206",
  "https://62.233.35.206",
  "http://spec.nikita-daogreen.ru",
  "https://spec.nikita-daogreen.ru",
];

const DEFAULT_DEV_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
];

export function getAdminAccessMode() {
  const raw = String(process.env.ADMIN_ACCESS_MODE || "key").trim().toLowerCase();
  return raw === "magic-link" ? "magic-link" : "key";
}

export function getAdminSessionTtlDays() {
  const n = Number(process.env.ADMIN_SESSION_TTL_DAYS);
  if (!Number.isFinite(n) || n < 1) return 7;
  return Math.min(Math.floor(n), 365);
}

export function getAdminSessionTtlSeconds() {
  return getAdminSessionTtlDays() * 24 * 60 * 60;
}

export function safeEqualString(a, b) {
  const left = createHash("sha256").update(String(a ?? ""), "utf8").digest();
  const right = createHash("sha256").update(String(b ?? ""), "utf8").digest();
  return timingSafeEqual(left, right);
}

function isStrongProductionSecret(value) {
  if (/^[a-f0-9]{64,}$/i.test(value)) return true;
  return /^[A-Za-z0-9_-]{43,}$/.test(value);
}

export function getMagicLinkConfigurationError() {
  const token = String(process.env.ADMIN_MAGIC_LINK_TOKEN || "");
  const secret = String(process.env.ADMIN_SESSION_SECRET || "");
  if (!token || !secret) return "Magic-link authentication is not configured";
  if (process.env.NODE_ENV === "production" && (!isStrongProductionSecret(token) || !isStrongProductionSecret(secret))) {
    return "Magic-link authentication is not securely configured";
  }
  return "";
}

export function isMagicLinkConfigured() {
  return !getMagicLinkConfigurationError();
}

export function validateMagicLinkToken(token) {
  if (typeof token !== "string") return false;
  if (!token || token.length > MAX_MAGIC_TOKEN_CHARS) return false;
  const expected = String(process.env.ADMIN_MAGIC_LINK_TOKEN || "");
  if (!expected) return false;
  return safeEqualString(token, expected);
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromB64url(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

function sessionSecret() {
  return String(process.env.ADMIN_SESSION_SECRET || "");
}

function ensureSettingsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );
  `);
}

export function getAdminSessionVersion() {
  ensureSettingsTable();
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(ADMIN_SESSION_VERSION_KEY);
  const n = Number(row?.value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

export function bumpAdminSessionVersion() {
  ensureSettingsTable();
  const current = getAdminSessionVersion();
  const next = current + 1;
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(ADMIN_SESSION_VERSION_KEY, String(next));
  return next;
}

function signPayload(payloadB64) {
  const secret = sessionSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(`v${TOKEN_FORMAT_VERSION}.${payloadB64}`).digest();
}

export function createAdminSessionToken(nowMs = Date.now(), sessionVersion = getAdminSessionVersion()) {
  const secret = sessionSecret();
  if (!secret) return null;
  const ttlSec = getAdminSessionTtlSeconds();
  const payload = {
    v: TOKEN_FORMAT_VERSION,
    sv: sessionVersion,
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor(nowMs / 1000) + ttlSec,
    nonce: randomBytes(16).toString("hex"),
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = signPayload(payloadB64);
  if (!sig) return null;
  return `v${TOKEN_FORMAT_VERSION}.${payloadB64}.${b64url(sig)}`;
}

/**
 * @returns {object|null|typeof ADMIN_SESSION_REVOKED}
 *   payload on success, ADMIN_SESSION_REVOKED when signature-valid but sv mismatch, else null
 */
export function verifyAdminSessionToken(token, nowMs = Date.now(), currentVersion = getAdminSessionVersion()) {
  if (typeof token !== "string" || !token || token.length > MAX_SESSION_TOKEN_CHARS) return null;
  if (getMagicLinkConfigurationError()) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [ver, payloadB64, sigB64] = parts;
  if (ver !== `v${TOKEN_FORMAT_VERSION}` || !payloadB64 || !sigB64) return null;
  if (!sessionSecret()) return null;
  let expected;
  try {
    expected = signPayload(payloadB64);
  } catch {
    return null;
  }
  if (!expected) return null;
  let provided;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(sigB64)) return null;
    provided = fromB64url(sigB64);
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  let payload;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(payloadB64)) return null;
    const decoded = fromB64url(payloadB64);
    if (b64url(decoded) !== payloadB64) return null;
    payload = JSON.parse(decoded.toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || payload.v !== TOKEN_FORMAT_VERSION) return null;
  if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) return null;
  const nowSec = Math.floor(nowMs / 1000);
  if (payload.iat > nowSec + MAX_FUTURE_IAT_SECONDS) return null;
  if (payload.exp <= payload.iat) return null;
  if (payload.exp * 1000 <= nowMs) return null;
  if (typeof payload.nonce !== "string" || !payload.nonce) return null;
  const sv = Number(payload.sv);
  if (!Number.isFinite(sv) || Math.floor(sv) !== currentVersion) {
    return ADMIN_SESSION_REVOKED;
  }
  return payload;
}

export function parseCookieHeader(header) {
  const out = Object.create(null);
  if (typeof header !== "string" || !header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

export function readAdminSessionFromRequest(req, nowMs = Date.now()) {
  const cookies = parseCookieHeader(req.headers?.cookie);
  const raw = cookies[ADMIN_SESSION_COOKIE];
  if (!raw) return null;
  return verifyAdminSessionToken(raw, nowMs);
}

export function buildAdminSessionCookieOptions({ isProd, clear = false } = {}) {
  const maxAge = clear ? 0 : getAdminSessionTtlSeconds();
  const parts = [
    `${ADMIN_SESSION_COOKIE}=${clear ? "" : "__VALUE__"}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
  ];
  if (isProd) parts.push("Secure");
  return { parts, maxAge, httpOnly: true, sameSite: "Strict", secure: Boolean(isProd), path: "/" };
}

export function serializeAdminSessionCookie(token, { isProd, clear = false } = {}) {
  const maxAge = clear ? 0 : getAdminSessionTtlSeconds();
  const segments = [
    `${ADMIN_SESSION_COOKIE}=${clear ? "" : encodeURIComponent(token || "")}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
  ];
  if (isProd) segments.push("Secure");
  return segments.join("; ");
}

export function clearAdminSessionCookie({ isProd } = {}) {
  return serializeAdminSessionCookie("", { isProd, clear: true });
}

export function cookieContainsMagicToken(setCookieHeader, magicToken) {
  if (!setCookieHeader || !magicToken) return false;
  return String(setCookieHeader).includes(String(magicToken));
}

/**
 * Allowed browser Origins for admin cookie CSRF guard and magic-link exchange.
 * Production: CORS_ORIGIN or default prod list (exact match).
 * Dev/test: localhost / 127.0.0.1 explicitly allowed (not a silent prod bypass).
 */
export function getAllowedAdminOrigins() {
  const isProduction = process.env.NODE_ENV === "production";
  const corsOrigins = process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()).filter(Boolean);
  if (isProduction) {
    return corsOrigins?.length ? corsOrigins : DEFAULT_PROD_ORIGINS;
  }
  return corsOrigins?.length ? corsOrigins : DEFAULT_DEV_ORIGINS;
}

export function isAllowedAdminOrigin(origin) {
  if (!origin || origin === "null") return false;
  const allowed = getAllowedAdminOrigins();
  if (allowed.includes(origin)) return true;
  if (process.env.NODE_ENV === "production") return false;
  try {
    const u = new URL(origin);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export const __test = {
  MAX_MAGIC_TOKEN_CHARS,
  MAX_SESSION_TOKEN_CHARS,
  MAX_FUTURE_IAT_SECONDS,
  TOKEN_FORMAT_VERSION,
  SESSION_VERSION: TOKEN_FORMAT_VERSION,
  safeEqualString,
  createAdminSessionToken,
  verifyAdminSessionToken,
  parseCookieHeader,
  serializeAdminSessionCookie,
  ADMIN_SESSION_REVOKED,
};
