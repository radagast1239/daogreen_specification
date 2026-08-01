/**
 * T6B — Settings PATCH must use an explicit allowlist/schema and reject mass-assignment.
 * Temp SQLite only. No production DB/secrets.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../backend/package.json"),
);
const express = require("express");

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-settings-patch-${testId}`);
const tempDbPath = path.join(tempDir, "daogreen-test.db");

let db;
let initDb;
let adminRouter;
let adminAuthMiddleware;
let ADMIN_KEY;

function httpRequest(app, method, urlPath, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const payload = body != null ? JSON.stringify(body) : null;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: urlPath,
          method,
          headers: {
            ...(payload
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(payload),
                }
              : {}),
            ...headers,
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            server.close();
            const buf = Buffer.concat(chunks);
            let parsed = null;
            const ct = String(res.headers["content-type"] || "");
            if (ct.includes("application/json")) {
              try {
                parsed = JSON.parse(buf.toString("utf8") || "null");
              } catch {
                parsed = null;
              }
            }
            resolve({
              status: res.statusCode,
              body: parsed,
              text: buf.toString("utf8"),
            });
          });
        },
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function adminApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", (req, res, next) => adminAuthMiddleware(req, res, next), adminRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Server error" });
  });
  return app;
}

function getSetting(key) {
  return db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
}

beforeAll(async () => {
  fs.mkdirSync(tempDir, { recursive: true });
  process.env.DATABASE_PATH = tempDbPath;
  process.env.DB_PATH = tempDbPath;
  process.env.UPLOAD_ROOT = path.join(tempDir, "uploads");
  process.env.NODE_ENV = "test";
  process.env.ADMIN_KEY = "test-admin-key-settings-patch";
  ADMIN_KEY = process.env.ADMIN_KEY;
  vi.resetModules();

  const dbMod = await import("../backend/src/db.js");
  const adminMod = await import("../backend/src/routes/admin.js");
  const authMod = await import("../backend/src/auth.js");

  db = dbMod.db;
  initDb = dbMod.initDb;
  adminRouter = adminMod.default;
  adminAuthMiddleware = authMod.adminAuthMiddleware;
  initDb();
});

beforeEach(() => {
  db.prepare("DELETE FROM settings").run();
});

afterAll(() => {
  delete process.env.DATABASE_PATH;
  delete process.env.DB_PATH;
  delete process.env.UPLOAD_ROOT;
  delete process.env.ADMIN_KEY;
  vi.resetModules();
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

const UI_KEY_VALID_VALUES = {
  companyName: "ok",
  contactPhone: "ok",
  contactEmail: "ok",
  contactTelegram: "ok",
  brandColor: "#116355",
  brandAccentColor: "#7fc9a8",
  brandBgColor: "#f0f7f4",
  logoUrl: "/uploads/public/logo.png",
  clientHeroEyebrow: "ok",
  clientTrustLines: JSON.stringify(["Фото и цены"]),
  clientVisibleTabs: JSON.stringify(["overview", "purchase", "docs"]),
  clientPdfColumns: JSON.stringify(["name", "qty", "unit", "price", "sum"]),
  clientPdfFooter: "ok",
  clientPdfShowQr: "true",
  clientSectionsJson: JSON.stringify([{ id: "purchase", label: "Закупка" }]),
  materialCategories: JSON.stringify(["Каркас"]),
  clientLinkTtlDays: "30",
  publishRules: JSON.stringify({ requirePrice: true }),
  clientLinkTemplate: "ok",
  refTags: JSON.stringify(["электрика"]),
  refUnits: JSON.stringify(["шт."]),
  refPurchaseStatuses: JSON.stringify([{ id: "bought", label: "Куплено" }]),
  refResponsibleRoles: JSON.stringify([{ id: "manager", label: "Менеджер" }]),
  refFarmTypes: JSON.stringify(["NFT"]),
  refStellageGroups: JSON.stringify([{ id: "karkas", label: "Каркас" }]),
  refFarmSectionGroups: JSON.stringify([{ id: "other", label: "Прочее" }]),
  farmSections: JSON.stringify([{ id: "sec_1", name: "Каркас" }]),
  farmSectionCatalogs: JSON.stringify({ sec_1: [] }),
  farmSectionVersions: JSON.stringify({ sec_1: [] }),
  stellageModuleCatalogs: JSON.stringify({}),
  stellageModuleMeta: JSON.stringify({}),
};

const UI_EDITABLE_KEYS = Object.keys(UI_KEY_VALID_VALUES);

describe("T6B settings PATCH schema", () => {
  it.each(UI_EDITABLE_KEYS)("allows UI key: %s", async (key) => {
    const value = UI_KEY_VALID_VALUES[key];
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: { [key]: value },
    });
    expect(res.status).toBe(200);
    expect(getSetting(key).value).toBe(value);
  });

  it.each([
    "adminSessionVersion",
    "migration_client_visible_default_v2",
    "farmSectionOrder",
    "farmSectionNames",
  ])("rejects server-owned key: %s", async (key) => {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(key, "secret-or-state");
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: { [key]: "attacker" },
    });
    expect(res.status).toBe(422);
    expect(res.body.forbiddenKeys).toContain(key);
    expect(getSetting(key).value).toBe("secret-or-state");
  });

  it("rejects unknown key", async () => {
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: { attackerKey: "x" },
    });
    expect(res.status).toBe(422);
    expect(res.body.forbiddenKeys).toContain("attackerKey");
  });

  it("mixed payload is rejected atomically", async () => {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("companyName", "Daogreen");
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: {
        companyName: "NewCo",
        adminSessionVersion: "99",
      },
    });
    expect(res.status).toBe(422);
    expect(getSetting("companyName").value).toBe("Daogreen");
  });

  it("rejects array as top-level payload", async () => {
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: [{ companyName: "x" }],
    });
    expect(res.status).toBe(422);
    expect(res.body.forbiddenKeys).toContain("__invalid_body_type");
  });

  it("rejects nested object instead of scalar", async () => {
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: { companyName: { evil: "x" } },
    });
    expect(res.status).toBe(422);
    expect(res.body.invalidKeys).toContainEqual({ key: "companyName", reason: "type" });
  });

  it("rejects invalid enum for clientPdfShowQr", async () => {
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: { clientPdfShowQr: "maybe" },
    });
    expect(res.status).toBe(422);
    expect(res.body.invalidKeys).toContainEqual({ key: "clientPdfShowQr", reason: "enum" });
  });

  it("rejects non-numeric clientLinkTtlDays", async () => {
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: { clientLinkTtlDays: "abc" },
    });
    expect(res.status).toBe(422);
    expect(res.body.invalidKeys).toContainEqual({ key: "clientLinkTtlDays", reason: "pattern" });
  });

  it("allows null and treats it as empty string", async () => {
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: { companyName: null },
    });
    expect(res.status).toBe(200);
    expect(getSetting("companyName").value).toBe("");
  });

  it("allows empty string", async () => {
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: { contactEmail: "" },
    });
    expect(res.status).toBe(200);
    expect(getSetting("contactEmail").value).toBe("");
  });

  it("rejects value exceeding maxLength", async () => {
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: { companyName: "x".repeat(1000) },
    });
    expect(res.status).toBe(422);
    expect(res.body.invalidKeys).toContainEqual({ key: "companyName", reason: "maxLength" });
  });

  it.each(["__proto__", "constructor", "prototype"])("rejects prototype pollution key: %s", async (key) => {
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: { [key]: "pollute" },
    });
    expect(res.status).toBe(422);
    expect(res.body.forbiddenKeys).toContain(key);
  });

  it("accepts current SettingsPage links-tab payload", async () => {
    const app = adminApp();
    // Links-tab owns only clientLinkTtlDays (explicit allowlist; never ...form).
    const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: {
        clientLinkTtlDays: "30",
      },
    });
    expect(res.status).toBe(200);
    expect(getSetting("clientLinkTtlDays").value).toBe("30");
  });

  it("accepts current PublishRulesTab payload", async () => {
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: {
        publishRules: JSON.stringify({ requirePrice: true }),
        clientLinkTemplate: "Hello {clientName}",
        clientSectionsJson: JSON.stringify([{ id: "purchase", label: "Закупка" }]),
      },
    });
    expect(res.status).toBe(200);
  });

  it("accepts current DirectoriesTab payload", async () => {
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: {
        refTags: JSON.stringify(["электрика"]),
        refUnits: JSON.stringify(["шт.", "м"]),
        refPurchaseStatuses: JSON.stringify([{ id: "bought", label: "Куплено", chip: "ok" }]),
        refResponsibleRoles: JSON.stringify([{ id: "manager", label: "Менеджер" }]),
        refFarmTypes: JSON.stringify(["NFT"]),
        refStellageGroups: JSON.stringify([{ id: "karkas", label: "Каркас", order: 1 }]),
        materialCategories: JSON.stringify(["Каркас"]),
        clientSectionsJson: JSON.stringify([]),
        refFarmSectionGroups: JSON.stringify([{ id: "irrigation", label: "Полив", icon: "💧" }]),
      },
    });
    expect(res.status).toBe(200);
  });

  it("accepts current ClientBrandTab payload", async () => {
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: {
        companyName: "Daogreen",
        contactPhone: "",
        contactEmail: "",
        contactTelegram: "",
        brandColor: "#116355",
        brandAccentColor: "#7fc9a8",
        brandBgColor: "#f0f7f4",
        logoUrl: "/uploads/public/logo.png",
        clientHeroEyebrow: "",
        clientTrustLines: JSON.stringify(["Фото и цены"]),
        clientVisibleTabs: JSON.stringify(["overview", "purchase", "docs"]),
        clientPdfColumns: JSON.stringify(["name", "qty", "unit", "price", "sum"]),
        clientPdfFooter: "",
        clientPdfShowQr: "true",
      },
    });
    expect(res.status).toBe(200);
    expect(getSetting("clientPdfShowQr").value).toBe("true");
  });

  it("accepts current ModulesPage farm/stellage payload", async () => {
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: {
        farmSections: JSON.stringify([{ id: "sec_1", name: "Каркас" }]),
        farmSectionCatalogs: JSON.stringify({ sec_1: [] }),
        farmSectionVersions: JSON.stringify({ sec_1: [] }),
        stellageModuleCatalogs: JSON.stringify({}),
        stellageModuleMeta: JSON.stringify({}),
      },
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(getSetting("farmSectionCatalogs").value)).toEqual({ sec_1: [] });
  });

  it("does not leak secret values in error responses", async () => {
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: {
        adminSessionVersion: "super-secret-session-version-12345",
        attackerPath: "/etc/passwd",
      },
    });
    expect(res.status).toBe(422);
    expect(res.text).not.toContain("super-secret-session-version-12345");
    expect(res.text).not.toContain("/etc/passwd");
  });

  it("SQLite round-trip returns written values", async () => {
    const app = adminApp();
    await httpRequest(app, "PATCH", "/api/admin/settings", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: {
        companyName: "RoundTrip",
        clientLinkTtlDays: "42",
        clientPdfShowQr: "false",
      },
    });
    const getRes = await httpRequest(app, "GET", "/api/admin/settings", {
      headers: { "X-Admin-Key": ADMIN_KEY },
    });
    expect(getRes.status).toBe(200);
    expect(getRes.body.companyName).toBe("RoundTrip");
    expect(getRes.body.clientLinkTtlDays).toBe("42");
    expect(getRes.body.clientPdfShowQr).toBe("false");
  });

  it("artificial rollback: invalid payload does not change existing settings", async () => {
    const app = adminApp();
    await httpRequest(app, "PATCH", "/api/admin/settings", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: { companyName: "Before" },
    });
    const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: { companyName: "After", adminSessionVersion: "99" },
    });
    expect(res.status).toBe(422);
    expect(getSetting("companyName").value).toBe("Before");
  });

  it("production-shape fixture with anonymized real keys", async () => {
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: {
        companyName: "AnonCo",
        contactPhone: "+00000000000",
        contactEmail: "anon@example.com",
        contactTelegram: "@anon",
        brandColor: "#000000",
        brandAccentColor: "#111111",
        brandBgColor: "#222222",
        logoUrl: "",
        clientHeroEyebrow: "",
        clientTrustLines: JSON.stringify(["Line 1", "Line 2"]),
        clientVisibleTabs: JSON.stringify(["overview", "purchase", "docs"]),
        clientPdfColumns: JSON.stringify(["name", "qty", "unit", "price", "sum"]),
        clientPdfFooter: "",
        clientPdfShowQr: "true",
        materialCategories: JSON.stringify(["Каркас", "Полив", "Свет"]),
        clientSectionsJson: JSON.stringify([{ id: "purchase", label: "Закупка", subsections: [], hidden: false, order: 0 }]),
        clientLinkTtlDays: "0",
        publishRules: JSON.stringify({ requirePrice: true, requirePhoto: false }),
        clientLinkTemplate: "Hello",
        refTags: JSON.stringify(["tag"]),
        refUnits: JSON.stringify(["шт."]),
        refPurchaseStatuses: JSON.stringify([{ id: "bought", label: "Куплено" }]),
        refResponsibleRoles: JSON.stringify([{ id: "manager", label: "Менеджер" }]),
        refFarmTypes: JSON.stringify(["NFT"]),
        refStellageGroups: JSON.stringify([{ id: "karkas", label: "Каркас" }]),
        refFarmSectionGroups: JSON.stringify([{ id: "other", label: "Прочее" }]),
        farmSections: JSON.stringify([{ id: "sec_1", name: "Каркас" }]),
        farmSectionCatalogs: JSON.stringify({ sec_1: [] }),
        farmSectionVersions: JSON.stringify({ sec_1: [] }),
        stellageModuleCatalogs: JSON.stringify({}),
        stellageModuleMeta: JSON.stringify({}),
      },
    });
    expect(res.status).toBe(200);
  });

  describe("structured settings JSON validation", () => {
    it.each([
      ["clientTrustLines", "{"],
      ["clientTrustLines", "["],
      ["clientTrustLines", '{"x":'],
      ["clientTrustLines", ""],
      ["clientTrustLines", "   "],
      ["clientTrustLines", "undefined"],
      ["clientTrustLines", "NaN"],
      ["publishRules", "{"],
      ["farmSectionCatalogs", "{"],
      ["stellageModuleMeta", "{"],
    ])("rejects malformed JSON for structured key %s: %p", async (key, badValue) => {
      const app = adminApp();
      const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
        headers: { "X-Admin-Key": ADMIN_KEY },
        body: { [key]: badValue },
      });
      expect(res.status).toBe(422);
      expect(res.body.invalidKeys).toContainEqual({ key, reason: "json_parse" });
      // Response must only contain the key name and a safe reason code, never the value.
      expect(res.body.invalidKeys).not.toContainEqual(
        expect.objectContaining({ value: expect.anything() }),
      );
    });

    it.each([
      ["clientTrustLines", JSON.stringify({}), "array"],
      ["clientVisibleTabs", JSON.stringify("overview"), "array"],
      ["clientPdfColumns", JSON.stringify(123), "array"],
      ["clientSectionsJson", JSON.stringify(true), "array"],
      ["materialCategories", JSON.stringify(null), "array"],
      ["publishRules", JSON.stringify([]), "object"],
      ["publishRules", JSON.stringify("x"), "object"],
      ["publishRules", JSON.stringify(123), "object"],
      ["publishRules", JSON.stringify(true), "object"],
      ["publishRules", JSON.stringify(null), "object"],
      ["farmSectionCatalogs", JSON.stringify([]), "object"],
      ["stellageModuleMeta", JSON.stringify("x"), "object"],
    ])("rejects wrong top-level type for %s (expects %s)", async (key, badValue) => {
      const app = adminApp();
      const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
        headers: { "X-Admin-Key": ADMIN_KEY },
        body: { [key]: badValue },
      });
      expect(res.status).toBe(422);
      expect(res.body.invalidKeys).toContainEqual({ key, reason: "json_type" });
    });

    it.each([
      ["publishRules", '{"__proto__":{"polluted":true}}'],
      ["publishRules", JSON.stringify({ nested: { constructor: { polluted: true } } })],
      ["farmSectionCatalogs", JSON.stringify({ constructor: [] })],
      ["farmSectionVersions", '{"__proto__":{}}'],
      ["stellageModuleCatalogs", JSON.stringify({ prototype: {} })],
      ["stellageModuleMeta", JSON.stringify({ mod_1: { prototype: { polluted: true } } })],
    ])("rejects recursive magic keys in %s", async (key, badValue) => {
      const app = adminApp();
      const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
        headers: { "X-Admin-Key": ADMIN_KEY },
        body: { [key]: badValue },
      });
      expect(res.status).toBe(422);
      expect(res.body.invalidKeys).toContainEqual({ key, reason: "json_magic_key" });
      expect(res.text).not.toContain("polluted");
    });

    it("allows plain string value containing magic word", async () => {
      const app = adminApp();
      const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
        headers: { "X-Admin-Key": ADMIN_KEY },
        body: { companyName: "constructor" },
      });
      expect(res.status).toBe(200);
      expect(getSetting("companyName").value).toBe("constructor");
    });

    it("rejects mixed payload with malformed JSON atomically", async () => {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("companyName", "Before");
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("clientTrustLines", JSON.stringify(["Before"]));
      const app = adminApp();
      const res = await httpRequest(app, "PATCH", "/api/admin/settings", {
        headers: { "X-Admin-Key": ADMIN_KEY },
        body: {
          companyName: "After",
          clientTrustLines: "{broken",
        },
      });
      expect(res.status).toBe(422);
      expect(getSetting("companyName").value).toBe("Before");
      expect(getSetting("clientTrustLines").value).toBe(JSON.stringify(["Before"]));
    });

    it("SQLite round-trip preserves structured setting string", async () => {
      const app = adminApp();
      const payload = {
        clientTrustLines: JSON.stringify(["Line 1", "Line 2"]),
        publishRules: JSON.stringify({ requirePrice: true }),
        farmSectionCatalogs: JSON.stringify({ sec_1: [{ materialId: "m1", qty: 1 }] }),
      };
      await httpRequest(app, "PATCH", "/api/admin/settings", {
        headers: { "X-Admin-Key": ADMIN_KEY },
        body: payload,
      });
      // The DB stores the exact JSON string sent by the frontend.
      expect(getSetting("clientTrustLines").value).toBe(payload.clientTrustLines);
      expect(getSetting("publishRules").value).toBe(payload.publishRules);
      expect(getSetting("farmSectionCatalogs").value).toBe(payload.farmSectionCatalogs);

      // GET merges publishRules defaults, so only the raw stored values are compared above.
      const getRes = await httpRequest(app, "GET", "/api/admin/settings", {
        headers: { "X-Admin-Key": ADMIN_KEY },
      });
      expect(getRes.status).toBe(200);
      expect(getRes.body.clientTrustLines).toBe(payload.clientTrustLines);
      expect(getRes.body.farmSectionCatalogs).toBe(payload.farmSectionCatalogs);
    });
  });
});
