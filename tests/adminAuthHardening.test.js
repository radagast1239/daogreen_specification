import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { createHmac } from "crypto";
import http from "http";

const require = createRequire(import.meta.url);
const express = require("../backend/node_modules/express");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "daogreen-admin-auth-hard-"));
const tempDbPath = path.join(tempDir, "test.db");

function listenApp(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

describe("admin auth hardening", () => {
  let db;
  let hashAdminKey;
  let verifyAdminKey;
  let isHashedAdminKey;
  let isLegacyPlaintextAdminKey;
  let migrateAdminKeys;
  let validateAdminKey;
  let listAdminUsers;
  let createAdminUser;
  let deactivateAdminUser;
  let adminAuthMiddleware;
  let revokeAllAdminSessions;
  let createAdminSessionToken;
  let verifyAdminSessionToken;
  let ADMIN_SESSION_COOKIE;
  let ADMIN_SESSION_REVOKED;
  let bumpAdminSessionVersion;
  let getAdminSessionVersion;
  let serializeAdminSessionCookie;
  let authApi;

  beforeAll(async () => {
    process.env.DATABASE_PATH = tempDbPath;
    process.env.DB_PATH = tempDbPath;
    process.env.ADMIN_KEY = "env-admin-key-hardening-test-32chars!!";
    process.env.ADMIN_ACCESS_MODE = "key";
    process.env.ADMIN_MAGIC_LINK_TOKEN = "test-only-random-value";
    process.env.ADMIN_SESSION_SECRET = "test-only-session-secret";
    process.env.ADMIN_SESSION_TTL_DAYS = "7";
    process.env.NODE_ENV = "test";
    vi.resetModules();

    const dbMod = await import("../backend/src/db.js");
    dbMod.initDb();
    db = dbMod.db;

    const cryptoMod = await import("../backend/src/services/adminKeyCrypto.js");
    hashAdminKey = cryptoMod.hashAdminKey;
    verifyAdminKey = cryptoMod.verifyAdminKey;
    isHashedAdminKey = cryptoMod.isHashedAdminKey;
    isLegacyPlaintextAdminKey = cryptoMod.isLegacyPlaintextAdminKey;

    const authMod = await import("../backend/src/auth.js");
    migrateAdminKeys = authMod.migrateAdminKeys;
    validateAdminKey = authMod.validateAdminKey;
    listAdminUsers = authMod.listAdminUsers;
    createAdminUser = authMod.createAdminUser;
    deactivateAdminUser = authMod.deactivateAdminUser;
    adminAuthMiddleware = authMod.adminAuthMiddleware;
    revokeAllAdminSessions = authMod.revokeAllAdminSessions;

    const sessionMod = await import("../backend/src/adminSession.js");
    createAdminSessionToken = sessionMod.createAdminSessionToken;
    verifyAdminSessionToken = sessionMod.verifyAdminSessionToken;
    ADMIN_SESSION_COOKIE = sessionMod.ADMIN_SESSION_COOKIE;
    ADMIN_SESSION_REVOKED = sessionMod.ADMIN_SESSION_REVOKED;
    bumpAdminSessionVersion = sessionMod.bumpAdminSessionVersion;
    getAdminSessionVersion = sessionMod.getAdminSessionVersion;
    serializeAdminSessionCookie = sessionMod.serializeAdminSessionCookie;

    const authApiMod = await import("../backend/src/routes/authApi.js");
    authApi = authApiMod.default;
  });

  beforeEach(() => {
    process.env.ADMIN_KEY = "env-admin-key-hardening-test-32chars!!";
    process.env.ADMIN_ACCESS_MODE = "key";
    process.env.NODE_ENV = "test";
    db.prepare("DELETE FROM admin_users").run();
    migrateAdminKeys();
  });

  afterAll(() => {
    delete process.env.DATABASE_PATH;
    delete process.env.DB_PATH;
    delete process.env.ADMIN_KEY;
    delete process.env.ADMIN_ACCESS_MODE;
    delete process.env.ADMIN_MAGIC_LINK_TOKEN;
    delete process.env.ADMIN_SESSION_SECRET;
    delete process.env.ADMIN_SESSION_TTL_DAYS;
    vi.resetModules();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("hashes with scrypt$ versioned format and verifies timing-safe", () => {
    const plain = "super-secret-admin-key-value-aaaa";
    const stored = hashAdminKey(plain);
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(stored).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$urlsafe\$[A-Za-z0-9_-]+$/);
    expect(verifyAdminKey(plain, stored)).toBe(true);
    expect(verifyAdminKey("wrong", stored)).toBe(false);
    expect(isHashedAdminKey(stored)).toBe(true);
    expect(isLegacyPlaintextAdminKey(stored)).toBe(false);
    expect(isLegacyPlaintextAdminKey(plain)).toBe(true);
  });

  it("migration deletes env-primary and hashes plaintext rows idempotently", () => {
    db.prepare(`
      INSERT INTO admin_users (id, name, api_key, active, key_hint)
      VALUES ('env-primary', 'Primary (env)', 'plain-env-key', 1, '')
    `).run();
    db.prepare(`
      INSERT INTO admin_users (id, name, api_key, active, key_hint)
      VALUES ('named-1', 'Named', 'plain-named-key-abcdefgh', 1, '')
    `).run();

    migrateAdminKeys();
    expect(db.prepare("SELECT 1 FROM admin_users WHERE id = ?").get("env-primary")).toBeUndefined();

    const named = db.prepare("SELECT api_key, key_hint FROM admin_users WHERE id = ?").get("named-1");
    expect(isHashedAdminKey(named.api_key)).toBe(true);
    expect(named.key_hint).toBe("efgh");
    expect(JSON.stringify(named)).not.toContain("plain-named-key");

    const again = named.api_key;
    migrateAdminKeys();
    const named2 = db.prepare("SELECT api_key FROM admin_users WHERE id = ?").get("named-1");
    expect(named2.api_key).toBe(again);
  });

  it("never inserts env-primary from ADMIN_KEY", () => {
    migrateAdminKeys();
    expect(db.prepare("SELECT COUNT(*) as c FROM admin_users WHERE id = 'env-primary'").get().c).toBe(0);
  });

  it("validateAdminKey accepts ENV_KEY and hashed DB keys; rejects disabled/corrupt", () => {
    expect(validateAdminKey(process.env.ADMIN_KEY)).toBe(true);
    expect(validateAdminKey("wrong")).toBe(false);

    const { user, apiKey } = createAdminUser({ name: "Ops" });
    expect(validateAdminKey(apiKey)).toBe(true);
    expect(listAdminUsers().find((u) => u.id === user.id).keyHint).toBeTruthy();
    expect(listAdminUsers()[0]).not.toHaveProperty("apiKey");
    expect(JSON.stringify(listAdminUsers())).not.toContain(apiKey);
    expect(JSON.stringify(listAdminUsers())).not.toMatch(/scrypt\$/);

    deactivateAdminUser(user.id);
    expect(validateAdminKey(apiKey)).toBe(false);

    db.prepare("INSERT INTO admin_users (id, name, api_key, active, key_hint) VALUES (?,?,?,?,?)").run(
      "corrupt-1",
      "Corrupt",
      "scrypt$bad",
      1,
      "xxxx"
    );
    expect(validateAdminKey("anything")).toBe(false);
  });

  it("create returns plaintext once; list never returns secrets", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => adminAuthMiddleware(req, res, next));
    const { default: adminApi } = await import("../backend/src/routes/admin.js");
    app.use("/api/admin", adminApi);
    const { server, base } = await listenApp(app);
    try {
      const created = await fetch(`${base}/api/admin/admin-users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": process.env.ADMIN_KEY,
        },
        body: JSON.stringify({ name: "CI Key", apiKey: "client-supplied-ignored" }),
      });
      expect(created.status).toBe(201);
      const body = await created.json();
      expect(body.apiKey).toBeTruthy();
      expect(body.apiKey.length).toBeGreaterThanOrEqual(32);
      expect(body.user.keyHint).toBe(body.apiKey.slice(-4));
      expect(body.user).not.toHaveProperty("apiKey");

      const listed = await fetch(`${base}/api/admin/admin-users`, {
        headers: { "X-Admin-Key": process.env.ADMIN_KEY },
      });
      const users = await listed.json();
      const raw = JSON.stringify(users);
      expect(raw).not.toContain(body.apiKey);
      expect(raw).not.toMatch(/scrypt\$/);
      expect(users.some((u) => u.keyHint === body.user.keyHint)).toBe(true);

      const ok = await fetch(`${base}/api/admin/admin-users`, {
        headers: { "X-Admin-Key": body.apiKey },
      });
      expect(ok.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it("session revoke-all bumps version and returns ADMIN_SESSION_REVOKED", async () => {
    process.env.ADMIN_ACCESS_MODE = "magic-link";
    const v0 = getAdminSessionVersion();
    const token = createAdminSessionToken();
    expect(verifyAdminSessionToken(token)).toBeTruthy();
    expect(verifyAdminSessionToken(token)).not.toBe(ADMIN_SESSION_REVOKED);

    const app = express();
    app.use(express.json());
    app.post("/api/admin/session/revoke-all", adminAuthMiddleware, (req, res) => {
      const { version, clearCookie } = revokeAllAdminSessions({ isProd: false });
      res.setHeader("Set-Cookie", clearCookie);
      res.json({ ok: true, version });
    });
    app.get("/api/admin/ping", adminAuthMiddleware, (_req, res) => res.json({ ok: true }));
    const { server, base } = await listenApp(app);
    try {
      const cookie = `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`;
      const before = await fetch(`${base}/api/admin/ping`, { headers: { Cookie: cookie } });
      expect(before.status).toBe(200);

      const rev = await fetch(`${base}/api/admin/session/revoke-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": process.env.ADMIN_KEY,
          Origin: "http://127.0.0.1:5173",
        },
        body: "{}",
      });
      expect(rev.status).toBe(200);
      const revBody = await rev.json();
      expect(revBody.version).toBeGreaterThan(v0);

      expect(verifyAdminSessionToken(token)).toBe(ADMIN_SESSION_REVOKED);
      const after = await fetch(`${base}/api/admin/ping`, { headers: { Cookie: cookie } });
      expect(after.status).toBe(401);
      const afterBody = await after.json();
      expect(afterBody.code).toBe("ADMIN_SESSION_REVOKED");
    } finally {
      server.close();
      process.env.ADMIN_ACCESS_MODE = "key";
    }
  });

  it("origin guard blocks session writes without/wrong Origin; allows key auth writes", async () => {
    process.env.ADMIN_ACCESS_MODE = "magic-link";
    const token = createAdminSessionToken();
    const cookie = `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`;

    const app = express();
    app.use(express.json());
    app.post("/api/admin/write", adminAuthMiddleware, (_req, res) => res.json({ ok: true }));
    app.get("/api/admin/read", adminAuthMiddleware, (_req, res) => res.json({ ok: true }));
    const { server, base } = await listenApp(app);
    try {
      const missing = await fetch(`${base}/api/admin/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: "{}",
      });
      expect(missing.status).toBe(403);
      expect((await missing.json()).code).toBe("ADMIN_ORIGIN_FORBIDDEN");

      const wrong = await fetch(`${base}/api/admin/write`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          Origin: "https://evil.example",
        },
        body: "{}",
      });
      expect(wrong.status).toBe(403);

      const okGet = await fetch(`${base}/api/admin/read`, { headers: { Cookie: cookie } });
      expect(okGet.status).toBe(200);

      const okWrite = await fetch(`${base}/api/admin/write`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          Origin: "http://127.0.0.1:5173",
        },
        body: "{}",
      });
      expect(okWrite.status).toBe(200);

      const keyWrite = await fetch(`${base}/api/admin/write`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": process.env.ADMIN_KEY,
        },
        body: "{}",
      });
      expect(keyWrite.status).toBe(200);
    } finally {
      server.close();
      process.env.ADMIN_ACCESS_MODE = "key";
    }
  });

  it("client token does not grant admin access", async () => {
    const app = express();
    app.get("/api/admin/ping", adminAuthMiddleware, (_req, res) => res.json({ ok: true }));
    const { server, base } = await listenApp(app);
    try {
      const res = await fetch(`${base}/api/admin/ping`, {
        headers: { "X-Client-Token": "client-secret" },
      });
      expect(res.status).toBe(401);
    } finally {
      server.close();
    }
  });

  it("production origin guard rejects missing Origin for session writes", async () => {
    process.env.ADMIN_ACCESS_MODE = "magic-link";
    process.env.NODE_ENV = "production";
    const prevToken = process.env.ADMIN_MAGIC_LINK_TOKEN;
    const prevSecret = process.env.ADMIN_SESSION_SECRET;
    process.env.ADMIN_MAGIC_LINK_TOKEN = "a".repeat(64);
    process.env.ADMIN_SESSION_SECRET = "b".repeat(64);
    const token = createAdminSessionToken();
    expect(token).toBeTruthy();
    const cookie = `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`;
    const app = express();
    app.use(express.json());
    app.post("/api/admin/write", adminAuthMiddleware, (_req, res) => res.json({ ok: true }));
    const { server, base } = await listenApp(app);
    try {
      const res = await fetch(`${base}/api/admin/write`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          Origin: "https://spec.nikita-daogreen.ru",
        },
        body: "{}",
      });
      expect(res.status).toBe(200);

      const missing = await fetch(`${base}/api/admin/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: "{}",
      });
      expect(missing.status).toBe(403);
    } finally {
      server.close();
      process.env.NODE_ENV = "test";
      process.env.ADMIN_ACCESS_MODE = "key";
      process.env.ADMIN_MAGIC_LINK_TOKEN = prevToken;
      process.env.ADMIN_SESSION_SECRET = prevSecret;
    }
  });

  it("index.js startup log does not print ADMIN_KEY prefix", async () => {
    const { readFileSync } = await import("fs");
    const { fileURLToPath } = await import("url");
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    const src = readFileSync(path.join(root, "backend/src/index.js"), "utf8");
    expect(src).toContain("Admin authentication configured: magic-link");
    expect(src).toContain("Admin authentication configured: key fallback");
    expect(src).not.toMatch(/Admin key:/);
    expect(src).not.toMatch(/keyHint\.slice\(0,\s*8\)/);
  });

  it("logout clears cookie header", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/auth", authApi);
    const { server, base } = await listenApp(app);
    try {
      const res = await fetch(`${base}/api/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(200);
      const setCookie = res.headers.get("set-cookie") || "";
      expect(setCookie.toLowerCase()).toContain("max-age=0");
      expect(setCookie).toContain(ADMIN_SESSION_COOKIE);
    } finally {
      server.close();
    }
  });
});
