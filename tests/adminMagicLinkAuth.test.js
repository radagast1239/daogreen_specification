import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { createHmac } from "crypto";
import http from "http";

const require = createRequire(import.meta.url);
const express = require("../backend/node_modules/express");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "daogreen-magic-auth-"));
const tempDbPath = path.join(tempDir, "test.db");

function listenApp(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

function parseSetCookie(header) {
  if (!header) return null;
  const first = Array.isArray(header) ? header[0] : String(header).split(/,(?=\s*[^;]+=)/)[0];
  const [pair, ...attrs] = first.split(";").map((s) => s.trim());
  const eq = pair.indexOf("=");
  const name = pair.slice(0, eq);
  const value = pair.slice(eq + 1);
  const flags = Object.create(null);
  for (const a of attrs) {
    const i = a.indexOf("=");
    if (i < 0) flags[a.toLowerCase()] = true;
    else flags[a.slice(0, i).toLowerCase()] = a.slice(i + 1);
  }
  return { name, value, flags, raw: first };
}

function postMagic(base, token, headers = {}) {
  const target = new URL("/api/auth/magic-link", base);
  const body = JSON.stringify({ token });
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...headers },
    }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

describe("temporary magic-link admin access", () => {
  let adminAuthMiddleware;
  let authApi;
  let getAdminAccessMode;
  let safeEqualString;
  let createAdminSessionToken;
  let verifyAdminSessionToken;
  let ADMIN_SESSION_COOKIE;
  let serializeAdminSessionCookie;
  let getAdminSessionTtlDays;

  beforeAll(async () => {
    process.env.DATABASE_PATH = tempDbPath;
    process.env.DB_PATH = tempDbPath;
    process.env.ADMIN_KEY = "magic-key-fallback";
    process.env.ADMIN_ACCESS_MODE = "magic-link";
    process.env.ADMIN_MAGIC_LINK_TOKEN = "test-only-random-value";
    process.env.ADMIN_SESSION_SECRET = "test-only-session-secret";
    process.env.ADMIN_SESSION_TTL_DAYS = "30";
    process.env.NODE_ENV = "test";
    vi.resetModules();
    const dbMod = await import("../backend/src/db.js");
    dbMod.initDb();
    const authMod = await import("../backend/src/auth.js");
    const sessionMod = await import("../backend/src/adminSession.js");
    const authApiMod = await import("../backend/src/routes/authApi.js");
    adminAuthMiddleware = authMod.adminAuthMiddleware;
    authApi = authApiMod.default;
    getAdminAccessMode = sessionMod.getAdminAccessMode;
    safeEqualString = sessionMod.safeEqualString;
    createAdminSessionToken = sessionMod.createAdminSessionToken;
    verifyAdminSessionToken = sessionMod.verifyAdminSessionToken;
    ADMIN_SESSION_COOKIE = sessionMod.ADMIN_SESSION_COOKIE;
    serializeAdminSessionCookie = sessionMod.serializeAdminSessionCookie;
    getAdminSessionTtlDays = sessionMod.getAdminSessionTtlDays;
  });

  beforeEach(() => {
    process.env.ADMIN_ACCESS_MODE = "magic-link";
    process.env.ADMIN_MAGIC_LINK_TOKEN = "test-only-random-value";
    process.env.ADMIN_SESSION_SECRET = "test-only-session-secret";
    process.env.ADMIN_KEY = "magic-key-fallback";
    process.env.NODE_ENV = "test";
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

  it("default mode is key when unset or invalid", async () => {
    const prev = process.env.ADMIN_ACCESS_MODE;
    delete process.env.ADMIN_ACCESS_MODE;
    expect(getAdminAccessMode()).toBe("key");
    process.env.ADMIN_ACCESS_MODE = "weird";
    expect(getAdminAccessMode()).toBe("key");
    process.env.ADMIN_ACCESS_MODE = prev;
  });

  it("defaults session TTL to 7 days", () => {
    const previous = process.env.ADMIN_SESSION_TTL_DAYS;
    delete process.env.ADMIN_SESSION_TTL_DAYS;
    expect(getAdminSessionTtlDays()).toBe(7);
    process.env.ADMIN_SESSION_TTL_DAYS = previous;
  });

  it("fails closed when either magic secret is empty", async () => {
    const app = express();
    app.use(express.json({ limit: "32kb" }));
    app.use("/api/auth", authApi);
    const { server, base } = await listenApp(app);
    try {
      for (const missing of ["ADMIN_MAGIC_LINK_TOKEN", "ADMIN_SESSION_SECRET"]) {
        const saved = process.env[missing];
        delete process.env[missing];
        const res = await fetch(`${base}/api/auth/magic-link`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
          body: JSON.stringify({ token: "test-only-random-value" }),
        });
        expect(res.status).toBe(503);
        expect(res.headers.get("set-cookie")).toBeNull();
        process.env[missing] = saved;
      }
    } finally {
      server.close();
    }
  });

  it("production accepts 256-bit secrets and rejects weak secrets without a cookie", async () => {
    const app = express();
    app.use(express.json({ limit: "32kb" }));
    app.use("/api/auth", authApi);
    const { server, base } = await listenApp(app);
    const strongToken = "a".repeat(64);
    const strongSession = "b".repeat(64);
    try {
      process.env.NODE_ENV = "production";
      for (const [token, secret] of [["weak", strongSession], [strongToken, "weak"]]) {
        process.env.ADMIN_MAGIC_LINK_TOKEN = token;
        process.env.ADMIN_SESSION_SECRET = secret;
        const res = await postMagic(base, token, { Origin: "https://spec.nikita-daogreen.ru", Host: "spec.nikita-daogreen.ru" });
        expect(res.status).toBe(503);
        expect(res.headers["set-cookie"]).toBeUndefined();
      }
      process.env.ADMIN_MAGIC_LINK_TOKEN = strongToken;
      process.env.ADMIN_SESSION_SECRET = strongSession;
      const ok = await postMagic(base, strongToken, { Origin: "https://spec.nikita-daogreen.ru", Host: "spec.nikita-daogreen.ru" });
      expect(ok.status).toBe(200);
      expect(ok.headers["set-cookie"].join(";")).toContain("Secure");
    } finally {
      server.close();
    }
  });

  it("production requires exact HTTPS Origin and approved Host", async () => {
    const app = express();
    app.use(express.json({ limit: "32kb" }));
    app.use("/api/auth", authApi);
    const { server, base } = await listenApp(app);
    const strongToken = "a".repeat(64);
    try {
      process.env.NODE_ENV = "production";
      process.env.ADMIN_MAGIC_LINK_TOKEN = strongToken;
      process.env.ADMIN_SESSION_SECRET = "b".repeat(64);
      for (const headers of [
        { Host: "spec.nikita-daogreen.ru" },
        { Origin: "null", Host: "spec.nikita-daogreen.ru" },
        { Origin: "http://spec.nikita-daogreen.ru", Host: "spec.nikita-daogreen.ru" },
        { Origin: "https://evil.example", Host: "spec.nikita-daogreen.ru" },
        { Origin: "https://spec.nikita-daogreen.ru", Host: "evil.example" },
      ]) {
        const res = await postMagic(base, strongToken, headers);
        expect(res.status).toBe(401);
        expect(res.headers["set-cookie"]).toBeUndefined();
      }
    } finally {
      server.close();
    }
  });

  it("uses constant-time helper for string compare", () => {
    expect(safeEqualString("abc", "abc")).toBe(true);
    expect(safeEqualString("abc", "abd")).toBe(false);
    expect(safeEqualString("", "x")).toBe(false);
  });

  it("existing ADMIN_KEY auth still works in magic-link mode", async () => {
    const app = express();
    app.get("/api/admin/ping", adminAuthMiddleware, (_req, res) => res.json({ ok: true }));
    const { server, base } = await listenApp(app);
    try {
      const bad = await fetch(`${base}/api/admin/ping`);
      expect(bad.status).toBe(401);
      const ok = await fetch(`${base}/api/admin/ping`, { headers: { "x-admin-key": "magic-key-fallback" } });
      expect(ok.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it("magic endpoint disabled in key mode", async () => {
    process.env.ADMIN_ACCESS_MODE = "key";
    const app = express();
    app.use(express.json({ limit: "32kb" }));
    app.use("/api/auth", authApi);
    const { server, base } = await listenApp(app);
    try {
      const res = await fetch(`${base}/api/auth/magic-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
        body: JSON.stringify({ token: "test-only-random-value" }),
      });
      expect(res.status).toBe(404);
      expect(res.headers.get("set-cookie")).toBeNull();
    } finally {
      server.close();
      process.env.ADMIN_ACCESS_MODE = "magic-link";
    }
  });

  it("correct magic token creates HttpOnly SameSite session cookie without token leakage", async () => {
    const app = express();
    app.use(express.json({ limit: "32kb" }));
    app.use("/api/auth", authApi);
    const { server, base } = await listenApp(app);
    try {
      const res = await fetch(`${base}/api/auth/magic-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
        body: JSON.stringify({ token: "test-only-random-value" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body).not.toHaveProperty("token");
      expect(JSON.stringify(body)).not.toContain("test-only-random-value");

      const cookie = parseSetCookie(res.headers.get("set-cookie"));
      expect(cookie.name).toBe(ADMIN_SESSION_COOKIE);
      expect(cookie.flags.httponly).toBe(true);
      expect(String(cookie.flags.samesite).toLowerCase()).toBe("strict");
      expect(cookie.flags["max-age"]).toBeTruthy();
      expect(Number(cookie.flags["max-age"])).toBeGreaterThan(0);
      expect(cookie.raw.toLowerCase()).not.toContain("test-only-random-value");
      expect(decodeURIComponent(cookie.value)).not.toContain("test-only-random-value");
      expect(cookie.flags.secure).toBeUndefined();
    } finally {
      server.close();
    }
  });

  it("cookie Secure flag in production", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const raw = serializeAdminSessionCookie("abc", { isProd: true });
    expect(raw.toLowerCase()).toContain("secure");
    process.env.NODE_ENV = prev;
  });

  it("rejects wrong / empty / oversized tokens with same public response", async () => {
    const app = express();
    app.use(express.json({ limit: "32kb" }));
    app.use("/api/auth", authApi);
    const { server, base } = await listenApp(app);
    try {
      for (const body of [
        { token: "wrong" },
        { token: "" },
        { token: "x".repeat(600) },
        {},
      ]) {
        const res = await fetch(`${base}/api/auth/magic-link`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
          body: JSON.stringify(body),
        });
        expect(res.status).toBe(401);
        const json = await res.json();
        expect(json).toEqual({ error: "Unauthorized" });
        expect(res.headers.get("set-cookie")).toBeNull();
      }
    } finally {
      server.close();
    }
  });

  it("valid cookie grants admin access; tampered/expired denied", async () => {
    const app = express();
    app.use(express.json({ limit: "32kb" }));
    app.use("/api/auth", authApi);
    app.get("/api/admin/ping", adminAuthMiddleware, (_req, res) => res.json({ ok: true }));
    const { server, base } = await listenApp(app);
    try {
      const exchange = await fetch(`${base}/api/auth/magic-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
        body: JSON.stringify({ token: "test-only-random-value" }),
      });
      const cookie = parseSetCookie(exchange.headers.get("set-cookie"));
      const sessionPair = `${cookie.name}=${cookie.value}`;

      const ok = await fetch(`${base}/api/admin/ping`, { headers: { Cookie: sessionPair } });
      expect(ok.status).toBe(200);

      const tampered = sessionPair.replace(/\.[^.]+$/, ".aaaa");
      const bad = await fetch(`${base}/api/admin/ping`, { headers: { Cookie: tampered } });
      expect(bad.status).toBe(401);

      const expired = createAdminSessionToken(Date.now() - 40 * 24 * 60 * 60 * 1000);
      const expiredCookie = `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(expired)}`;
      const expiredRes = await fetch(`${base}/api/admin/ping`, { headers: { Cookie: expiredCookie } });
      expect(expiredRes.status).toBe(401);
      expect(verifyAdminSessionToken(expired, Date.now())).toBeNull();
    } finally {
      server.close();
    }
  });

  it("rejects oversized, malformed and temporally invalid session cookies without throwing", async () => {
    const app = express();
    app.get("/api/admin/ping", adminAuthMiddleware, (_req, res) => res.json({ ok: true }));
    const { server, base } = await listenApp(app);
    const signed = (payload) => {
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const sig = createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(`v1.${payloadB64}`).digest("base64url");
      return `v1.${payloadB64}.${sig}`;
    };
    const now = Math.floor(Date.now() / 1000);
    try {
      for (const token of [
        "x".repeat(3000),
        "v1.%%%.$$$",
        signed({ v: 1, iat: now, exp: now, nonce: "n" }),
        signed({ v: 1, iat: now + 3600, exp: now + 7200, nonce: "n" }),
      ]) {
        const res = await fetch(`${base}/api/admin/ping`, {
          headers: { Cookie: `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}` },
        });
        expect(res.status).toBe(401);
      }
    } finally {
      server.close();
    }
  });

  it("valid ADMIN_KEY overrides an invalid cookie", async () => {
    const app = express();
    app.get("/api/admin/ping", adminAuthMiddleware, (_req, res) => res.json({ ok: true }));
    const { server, base } = await listenApp(app);
    try {
      const res = await fetch(`${base}/api/admin/ping`, {
        headers: { "x-admin-key": "magic-key-fallback", Cookie: `${ADMIN_SESSION_COOKIE}=malformed` },
      });
      expect(res.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it("admin session cookie does not satisfy client-token authentication", async () => {
    const { clientAuthMiddleware } = await import("../backend/src/services/clientAuth.js");
    const session = createAdminSessionToken();
    const app = express();
    const clientRouter = express.Router();
    clientRouter.use(clientAuthMiddleware);
    clientRouter.get("/items", (_req, res) => res.json({ ok: true }));
    app.use("/api/client", clientRouter);
    const { server, base } = await listenApp(app);
    try {
      const res = await fetch(`${base}/api/client/items`, {
        headers: { Cookie: `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(session)}` },
      });
      expect(res.status).toBe(401);
    } finally {
      server.close();
    }
  });

  it("logout clears cookie; client token cannot get admin", async () => {
    const app = express();
    app.use(express.json({ limit: "32kb" }));
    app.use("/api/auth", authApi);
    app.get("/api/admin/ping", adminAuthMiddleware, (_req, res) => res.json({ ok: true }));
    const { server, base } = await listenApp(app);
    try {
      const exchange = await fetch(`${base}/api/auth/magic-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:5173" },
        body: JSON.stringify({ token: "test-only-random-value" }),
      });
      const cookie = parseSetCookie(exchange.headers.get("set-cookie"));
      const sessionPair = `${cookie.name}=${cookie.value}`;

      const logout = await fetch(`${base}/api/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionPair },
        body: "{}",
      });
      expect(logout.status).toBe(200);
      const cleared = parseSetCookie(logout.headers.get("set-cookie"));
      expect(cleared.flags["max-age"]).toBe("0");

      const after = await fetch(`${base}/api/admin/ping`, { headers: { Cookie: sessionPair } });
      // logout clears browser cookie; server still accepts old token until expiry (stateless).
      // Second logout is safe:
      const logout2 = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      expect(logout2.status).toBe(200);

      const client = await fetch(`${base}/api/admin/ping`, { headers: { "x-client-token": "client-secret" } });
      expect(client.status).toBe(401);
      // keep after unused for lint
      void after;
    } finally {
      server.close();
    }
  });

  it("magic exchange is POST-only", async () => {
    const app = express();
    app.use(express.json({ limit: "32kb" }));
    app.use("/api/auth", authApi);
    const { server, base } = await listenApp(app);
    try {
      const get = await fetch(`${base}/api/auth/magic-link`);
      expect(get.status).toBe(404);
    } finally {
      server.close();
    }
  });
});

describe("magic-link frontend hash helpers", () => {
  it("reads fragment access and ignores query access", async () => {
    const {
      parseAccessTokenFromHash,
      parseAccessTokenFromSearch,
      clearAccessHashFromUrl,
    } = await import("../src/lib/adminAccessHash.js");

    expect(parseAccessTokenFromHash("#access=test-only-random-value")).toBe("test-only-random-value");
    expect(parseAccessTokenFromHash("#access=abc&x=1")).toBe("abc");
    expect(parseAccessTokenFromSearch("?access=should-not-work")).toBe("");
    expect(parseAccessTokenFromHash("")).toBe("");

    const calls = [];
    const historyLike = {
      state: null,
      replaceState(_s, _t, url) {
        calls.push(url);
      },
    };
    clearAccessHashFromUrl(historyLike, {
      pathname: "/spec/",
      search: "?view=design",
      hash: "#access=secret",
    });
    expect(calls[0]).toBe("/spec/?view=design");
    expect(calls[0]).not.toContain("access=");
  });

  it("fragment token is not written to localStorage by helpers", async () => {
    const store = new Map();
    const fakeLocal = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    globalThis.localStorage = fakeLocal;
    const { takeAccessTokenFromLocation } = await import("../src/lib/adminAccessHash.js");
    const token = takeAccessTokenFromLocation({ hash: "#access=no-store-please", search: "", pathname: "/" });
    expect(token).toBe("no-store-please");
    expect([...store.values()].join("")).not.toContain("no-store-please");
  });

  it("login screen remains as reserve; Phase A routes helpers unchanged", () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    const login = fs.readFileSync(path.join(root, "src/pages/admin/LoginPage.jsx"), "utf8");
    expect(login).toContain("Ключ из");
    expect(login).toContain("персональную ссылку доступа");
    const routing = fs.readFileSync(path.join(root, "src/lib/projectWorkspaceView.js"), "utf8");
    expect(routing).toContain("design");
    expect(routing).toContain("spec");
    expect(routing).toContain("publish");
  });

  it("waits for magic bootstrap before rendering protected application code", () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    const main = fs.readFileSync(path.join(root, "src/main.jsx"), "utf8");
    expect(main).toContain("bootstrapAdminAccess().finally(renderApp)");
    expect(main.indexOf("bootstrapAdminAccess().finally(renderApp)")).toBeGreaterThan(main.indexOf("function renderApp()"));
  });

  it("keeps admin credentials scoped to internal API calls", () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    const apiSource = fs.readFileSync(path.join(root, "src/lib/api.js"), "utf8");
    expect(apiSource).toContain('credentials: admin ? "include" : "same-origin"');
    expect(apiSource).not.toMatch(/credentials:\s*"include"[\s\S]{0,120}X-Client-Token/);

    const imageSource = fs.readFileSync(path.join(root, "src/lib/pdfImageHelpers.js"), "utf8");
    expect(imageSource).toContain('credentials: "same-origin"');
    expect(imageSource).not.toContain('credentials: "include"');
  });

  it("admin request helper sends credentials include for admin calls only", () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    const apiSource = fs.readFileSync(path.join(root, "src/lib/api.js"), "utf8");
    expect(apiSource).toContain('credentials: admin ? "include" : "same-origin"');
    expect(apiSource).toContain("revokeAllSessions");
    expect(apiSource).not.toMatch(/credentials:\s*"include"[\s\S]{0,120}X-Client-Token/);
  });

  it("SettingsPage shows keyHint and one-time key copy UX", () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    const settings = fs.readFileSync(path.join(root, "src/pages/admin/SettingsPage.jsx"), "utf8");
    expect(settings).toContain("keyHint");
    expect(settings).toContain("Скопируйте ключ сейчас");
    expect(settings).toContain("Выйти на всех устройствах");
    expect(settings).toContain("revokeAllSessions");
    expect(settings).not.toContain("apiKey.slice");
  });

  it("login screen remains available as key fallback", () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    const login = fs.readFileSync(path.join(root, "src/pages/admin/LoginPage.jsx"), "utf8");
    expect(login).toContain("Ключ из");
    expect(login).toContain("ADMIN_KEY");
  });

  it("magic exchange rate limiter returns 429 at the non-production threshold", async () => {
    const { default: rateLimitedAuthApi } = await import("../backend/src/routes/authApi.js");
    const app = express();
    app.use(express.json({ limit: "32kb" }));
    app.use("/api/auth", rateLimitedAuthApi);
    const { server, base } = await listenApp(app);
    try {
      let last;
      for (let i = 0; i <= 200; i += 1) {
        last = await postMagic(base, "wrong", { Origin: "http://127.0.0.1:5173" });
      }
      expect(last.status).toBe(429);
    } finally {
      server.close();
    }
  });
});
