import { db } from "./db.js";
import {
  getAdminAccessMode,
  readAdminSessionFromRequest,
} from "./adminSession.js";

const ENV_KEY = process.env.ADMIN_KEY || "";
const IP_ALLOWLIST = (process.env.ADMIN_IP_ALLOWLIST || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function initAdminUsers() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_key TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  if (ENV_KEY) {
    db.prepare(`
      INSERT INTO admin_users (id, name, api_key, active)
      VALUES ('env-primary', 'Primary (env)', ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        api_key = excluded.api_key,
        active = excluded.active
    `).run(ENV_KEY);
  }
}

initAdminUsers();

export function validateAdminKey(key) {
  if (!key) return false;
  if (ENV_KEY && key === ENV_KEY) return true;
  const row = db.prepare("SELECT 1 FROM admin_users WHERE api_key = ? AND active = 1").get(key);
  return !!row;
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

export function adminAuthMiddleware(req, res, next) {
  if (!ipAllowed(req)) {
    return res.status(403).json({ error: "IP not allowed" });
  }
  const key = req.headers["x-admin-key"];
  if (validateAdminKey(key)) {
    req.adminAuth = { via: "key" };
    return next();
  }
  if (getAdminAccessMode() === "magic-link") {
    const session = readAdminSessionFromRequest(req);
    if (session) {
      req.adminAuth = { via: "session", session };
      if (!req.adminUser) {
        req.adminUser = { id: "admin-session", login: "admin-session" };
      }
      return next();
    }
  }
  return res.status(401).json({ error: "Unauthorized" });
}

export function listAdminUsers() {
  return db
    .prepare("SELECT id, name, api_key as apiKey, active, created_at as createdAt FROM admin_users ORDER BY created_at")
    .all()
    .map((r) => ({ ...r, active: !!r.active }));
}

export function upsertAdminUser({ id, name, apiKey, active = true }) {
  const uid = id || `adm_${Date.now()}`;
  db.prepare(`
    INSERT INTO admin_users (id, name, api_key, active) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, api_key=excluded.api_key, active=excluded.active
  `).run(uid, name, apiKey, active ? 1 : 0);
  return listAdminUsers().find((u) => u.id === uid);
}

export function deactivateAdminUser(id) {
  db.prepare("UPDATE admin_users SET active = 0 WHERE id = ?").run(id);
}
