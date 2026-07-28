import { db, getDbPath } from "./db.js";
import {
  getAdminAccessMode,
  readAdminSessionFromRequest,
  safeEqualString,
  isAllowedAdminOrigin,
  ADMIN_SESSION_REVOKED,
  clearAdminSessionCookie,
  bumpAdminSessionVersion,
} from "./adminSession.js";
import {
  hashAdminKey,
  verifyAdminKey,
  isHashedAdminKey,
  isLegacyPlaintextAdminKey,
  generateAdminApiKey,
  keyHintFromPlaintext,
} from "./services/adminKeyCrypto.js";
import { ensurePreMigrationBackup } from "./sqliteBackup.js";

const ENV_KEY = process.env.ADMIN_KEY || "";
const IP_ALLOWLIST = (process.env.ADMIN_IP_ALLOWLIST || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function addCol(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.length) return;
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
}

/**
 * Idempotent migration:
 * 1. Remove auto-created env-primary row (ENV key must not live in SQLite)
 * 2. Hash any remaining plaintext api_key values
 * 3. Ensure key_hint column exists
 *
 * When plaintext keys or env-primary exist, a verified pre-migration backup is required
 * (marker: preMigrationBackup.adminKeys.v1). Failure aborts with PRE_MIGRATION_BACKUP_REQUIRED.
 */
export function migrateAdminKeys() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_key TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  addCol("admin_users", "key_hint", "TEXT DEFAULT ''");

  const envPrimary = db.prepare("SELECT 1 AS ok FROM admin_users WHERE id = ?").get("env-primary");
  const rowsPreview = db.prepare("SELECT id, api_key FROM admin_users").all();
  const hasPlaintext = rowsPreview.some((row) => isLegacyPlaintextAdminKey(row.api_key));
  if (envPrimary || hasPlaintext) {
    ensurePreMigrationBackup(getDbPath(), "preMigrationBackup.adminKeys.v1");
  }

  const migrate = db.transaction(() => {
    db.prepare("DELETE FROM admin_users WHERE id = ?").run("env-primary");

    const rows = db.prepare("SELECT id, api_key, key_hint FROM admin_users").all();
    const update = db.prepare("UPDATE admin_users SET api_key = ?, key_hint = ? WHERE id = ?");
    for (const row of rows) {
      if (!isLegacyPlaintextAdminKey(row.api_key)) continue;
      const plaintext = row.api_key;
      const hashed = hashAdminKey(plaintext);
      const hint = row.key_hint && String(row.key_hint).trim()
        ? String(row.key_hint)
        : keyHintFromPlaintext(plaintext);
      update.run(hashed, hint, row.id);
    }
  });
  migrate();
}

function initAdminUsers() {
  migrateAdminKeys();
  // Never insert ADMIN_KEY / env-primary into SQLite.
}

initAdminUsers();

/**
 * Validate admin API key against ENV_KEY (timing-safe) and/or hashed admin_users rows.
 * Disabled / corrupt hashes fail closed.
 */
export function validateAdminKey(key) {
  if (!key || typeof key !== "string") return false;
  if (ENV_KEY && safeEqualString(key, ENV_KEY)) return true;

  const rows = db.prepare("SELECT api_key FROM admin_users WHERE active = 1").all();
  for (const row of rows) {
    if (!isHashedAdminKey(row.api_key)) continue;
    if (verifyAdminKey(key, row.api_key)) return true;
  }
  return false;
}

export function clientIp(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || "");
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

export function ipAllowed(req) {
  if (!IP_ALLOWLIST.length) return true;
  const ip = clientIp(req);
  return IP_ALLOWLIST.some((a) => ip === a);
}

/**
 * CSRF Origin guard for cookie-authenticated write methods.
 * API-key auth skips (CSRF N/A). GET/HEAD/OPTIONS not blocked.
 * Production: exact Origin match from allowed CORS/prod origins.
 * Dev/test: localhost / 127.0.0.1 allowed explicitly.
 */
export function adminOriginGuard(req, res, next) {
  if (req.adminAuth?.via !== "session") return next();
  const method = String(req.method || "").toUpperCase();
  if (!WRITE_METHODS.has(method)) return next();
  const origin = req.headers.origin;
  if (!origin || !isAllowedAdminOrigin(origin)) {
    return res.status(403).json({ error: "Forbidden", code: "ADMIN_ORIGIN_FORBIDDEN" });
  }
  return next();
}

export function adminAuthMiddleware(req, res, next) {
  if (!ipAllowed(req)) {
    return res.status(403).json({ error: "IP not allowed" });
  }

  const key = req.headers["x-admin-key"];
  if (validateAdminKey(key)) {
    req.adminAuth = { via: "key" };
    return adminOriginGuard(req, res, next);
  }

  if (getAdminAccessMode() === "magic-link") {
    const session = readAdminSessionFromRequest(req);
    if (session === ADMIN_SESSION_REVOKED) {
      return res.status(401).json({ error: "Unauthorized", code: "ADMIN_SESSION_REVOKED" });
    }
    if (session) {
      req.adminAuth = { via: "session", session };
      if (!req.adminUser) {
        req.adminUser = { id: "admin-session", login: "admin-session" };
      }
      return adminOriginGuard(req, res, next);
    }
  }

  if (key) {
    return res.status(401).json({ error: "Unauthorized", code: "ADMIN_KEY_INVALID" });
  }
  return res.status(401).json({ error: "Unauthorized" });
}

export function listAdminUsers() {
  return db
    .prepare(
      "SELECT id, name, active, created_at as createdAt, key_hint as keyHint FROM admin_users ORDER BY created_at"
    )
    .all()
    .map((r) => ({
      id: r.id,
      name: r.name,
      active: !!r.active,
      createdAt: r.createdAt,
      keyHint: r.keyHint || "",
    }));
}

/**
 * Always server-generates the API key (client-supplied apiKey ignored).
 * Returns { user, apiKey } with plaintext once.
 */
export function createAdminUser({ name, active = true } = {}) {
  if (!name || !String(name).trim()) {
    throw Object.assign(new Error("name required"), { status: 400, code: "ADMIN_USER_NAME_REQUIRED" });
  }
  const plaintext = generateAdminApiKey();
  if (!plaintext || plaintext.length < 32) {
    throw Object.assign(new Error("Failed to generate admin key"), { status: 500 });
  }
  const hashed = hashAdminKey(plaintext);
  const hint = keyHintFromPlaintext(plaintext);
  const uid = `adm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO admin_users (id, name, api_key, active, key_hint)
    VALUES (?, ?, ?, ?, ?)
  `).run(uid, String(name).trim(), hashed, active ? 1 : 0, hint);

  const user = listAdminUsers().find((u) => u.id === uid);
  return { user, apiKey: plaintext };
}

/** @deprecated Prefer createAdminUser — kept for callers that still upsert by id without rotating key. */
export function upsertAdminUser({ id, name, apiKey, active = true }) {
  if (!id) {
    return createAdminUser({ name, active }).user;
  }
  const uid = id;
  if (apiKey && String(apiKey).trim()) {
    const plaintext = String(apiKey).trim();
    const hashed = hashAdminKey(plaintext);
    const hint = keyHintFromPlaintext(plaintext);
    db.prepare(`
      INSERT INTO admin_users (id, name, api_key, active, key_hint) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, api_key=excluded.api_key, active=excluded.active, key_hint=excluded.key_hint
    `).run(uid, name, hashed, active ? 1 : 0, hint);
  } else {
    db.prepare(`
      UPDATE admin_users SET name = ?, active = ? WHERE id = ?
    `).run(name, active ? 1 : 0, uid);
  }
  return listAdminUsers().find((u) => u.id === uid);
}

export function deactivateAdminUser(id) {
  db.prepare("UPDATE admin_users SET active = 0 WHERE id = ?").run(id);
}

export function revokeAllAdminSessions({ isProd = process.env.NODE_ENV === "production" } = {}) {
  const version = bumpAdminSessionVersion();
  return {
    version,
    clearCookie: clearAdminSessionCookie({ isProd }),
  };
}
