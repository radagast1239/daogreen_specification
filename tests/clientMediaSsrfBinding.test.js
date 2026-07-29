/**
 * Client media authorization binding + SSRF regression.
 * Temp SQLite + temp UPLOAD_ROOT only.
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
const tempDir = path.join(os.tmpdir(), `daogreen-client-media-${testId}`);
const tempDbPath = path.join(tempDir, "daogreen-test.db");
const tempUploads = path.join(tempDir, "uploads");

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
]);

let db;
let initDb;
let saveItems;
let createVersion;
let loadProject;
let clientRouter;
let adminAuthMiddleware;
let mediaRouter;
let ADMIN_KEY;

function writeUpload(rel, contents = JPEG) {
  const abs = path.join(tempUploads, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.isBuffer(contents) ? contents : Buffer.from(contents));
  return `/uploads/${rel.replace(/\\/g, "/")}`;
}

function seedProject(id = "p1", extras = {}) {
  db.prepare(`
    INSERT INTO projects (id, name, client, city, client_token, status, manual_params, rooms, currency, vat, version, comment, stellage_configs, revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    extras.name || "Proj",
    extras.client || "Client",
    extras.city || "City",
    extras.token || `token-${id}`,
    extras.status || "sent_to_client",
    JSON.stringify(extras.manualParams || {}),
    JSON.stringify(extras.rooms || []),
    "₽",
    1,
    1,
    "",
    JSON.stringify(extras.stellageConfigs || []),
    extras.revision ?? 1,
  );
  if (extras.items?.length) saveItems(id, extras.items);
}

function clientItem(id = "it1", extra = {}) {
  return {
    id,
    materialId: "mat1",
    name: "Bolt",
    unit: "шт.",
    module: "general",
    qty: 1,
    price: 10,
    visibleToClient: true,
    includedInProject: true,
    enabled: true,
    approved: true,
    itemType: "material",
    status: "not_bought",
    ...extra,
  };
}

function httpRequest(app, method, urlPath, { headers } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const req = http.request(
        { hostname: "127.0.0.1", port, path: urlPath, method, headers: { ...headers } },
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
              headers: res.headers,
              body: parsed,
              buffer: buf,
              text: buf.toString("utf8"),
            });
          });
        },
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      req.end();
    });
  });
}

function clientApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/client", clientRouter);
  app.use("/uploads/public", express.static(path.join(tempUploads, "public")));
  app.use("/uploads", (_req, res) => res.status(404).json({ error: "closed" }));
  return app;
}

function adminApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/media", (req, res, next) => adminAuthMiddleware(req, res, next), mediaRouter);
  return app;
}

beforeAll(async () => {
  fs.mkdirSync(tempUploads, { recursive: true });
  process.env.DATABASE_PATH = tempDbPath;
  process.env.DB_PATH = tempDbPath;
  process.env.UPLOAD_ROOT = tempUploads;
  process.env.NODE_ENV = "test";
  process.env.ADMIN_KEY = "test-admin-key-client-media";
  ADMIN_KEY = process.env.ADMIN_KEY;
  vi.resetModules();

  const dbMod = await import("../backend/src/db.js");
  const activityMod = await import("../backend/src/services/activityLog.js");
  activityMod.initActivityLog();
  const projectsMod = await import("../backend/src/routes/projects.js");
  const mediaMod = await import("../backend/src/routes/media.js");
  const authMod = await import("../backend/src/auth.js");

  db = dbMod.db;
  initDb = dbMod.initDb;
  saveItems = projectsMod.saveItems;
  createVersion = projectsMod.createVersion;
  loadProject = dbMod.loadProject;
  clientRouter = projectsMod.clientRouter;
  mediaRouter = mediaMod.default;
  adminAuthMiddleware = authMod.adminAuthMiddleware;
  initDb();

  db.prepare(`
    INSERT INTO materials (id, name, unit, category, base_price, module, supplier, link, photo_url)
    VALUES ('mat1', 'Bolt', 'шт.', 'Каркас', 10, 'general', 'Sup', '', '')
  `).run();
});

beforeEach(() => {
  db.prepare("DELETE FROM spec_versions").run();
  db.prepare("DELETE FROM project_items").run();
  db.prepare("DELETE FROM files").run();
  db.prepare("DELETE FROM projects").run();
  for (const name of fs.readdirSync(tempUploads)) {
    fs.rmSync(path.join(tempUploads, name), { recursive: true, force: true });
  }
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

describe("client media authorization / binding", () => {
  it("empty token → 401", async () => {
    const app = clientApp();
    const res = await httpRequest(app, "GET", "/api/client/p//media?url=/uploads/public/x.jpg");
    expect([401, 404]).toContain(res.status);
  });

  it("random token → 404 (not open proxy)", async () => {
    const photo = writeUpload("public/open.jpg", JPEG);
    const app = clientApp();
    const res = await httpRequest(
      app,
      "GET",
      `/api/client/p/not-a-real-token/media?url=${encodeURIComponent(photo)}`,
    );
    expect(res.status).toBe(404);
    expect(res.body?.error).toBe("Not found");
  });

  it("valid token + own visible public asset → 200", async () => {
    const photo = writeUpload("public/own.jpg", JPEG);
    seedProject("p1", {
      token: "token-p1",
      items: [clientItem("it1", { imageUrl: photo, photoUrl: photo })],
    });
    createVersion("p1", "admin", { force: true });
    const app = clientApp();
    const res = await httpRequest(
      app,
      "GET",
      `/api/client/p/token-p1/media?url=${encodeURIComponent(photo)}`,
    );
    expect(res.status).toBe(200);
    expect(res.buffer[0]).toBe(0xff);
    expect(res.headers["cache-control"]).toMatch(/no-store/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("valid token + frozen legacy catalog photo → 200; foreign legacy → 404", async () => {
    const own = writeUpload("m_own.jpg", JPEG);
    const foreign = writeUpload("m_foreign.jpg", JPEG);
    seedProject("p1", {
      token: "token-p1",
      items: [clientItem("it1", { imageUrl: own, photoUrl: own })],
    });
    createVersion("p1", "admin", { force: true });
    const app = clientApp();
    expect(
      (
        await httpRequest(
          app,
          "GET",
          `/api/client/p/token-p1/media?url=${encodeURIComponent(own)}`,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await httpRequest(
          app,
          "GET",
          `/api/client/p/token-p1/media?url=${encodeURIComponent(foreign)}`,
        )
      ).status,
    ).toBe(404);
  });

  it("valid token + arbitrary public URL not in release → 404", async () => {
    const own = writeUpload("public/own.jpg", JPEG);
    const other = writeUpload("public/other.jpg", JPEG);
    seedProject("p1", {
      token: "token-p1",
      items: [clientItem("it1", { imageUrl: own, photoUrl: own })],
    });
    createVersion("p1", "admin", { force: true });
    const app = clientApp();
    const res = await httpRequest(
      app,
      "GET",
      `/api/client/p/token-p1/media?url=${encodeURIComponent(other)}`,
    );
    expect(res.status).toBe(404);
  });

  it("valid token + asset of another release/project → 404", async () => {
    const a = writeUpload("public/a.jpg", JPEG);
    const b = writeUpload("public/b.jpg", JPEG);
    seedProject("p1", {
      token: "token-p1",
      items: [clientItem("it1", { imageUrl: a, photoUrl: a })],
    });
    createVersion("p1", "admin", { force: true });
    seedProject("p2", {
      token: "token-p2",
      items: [clientItem("it2", { imageUrl: b, photoUrl: b })],
    });
    createVersion("p2", "admin", { force: true });

    const app = clientApp();
    const cross = await httpRequest(
      app,
      "GET",
      `/api/client/p/token-p1/media?url=${encodeURIComponent(b)}`,
    );
    expect(cross.status).toBe(404);

    const ok = await httpRequest(
      app,
      "GET",
      `/api/client/p/token-p2/media?url=${encodeURIComponent(b)}`,
    );
    expect(ok.status).toBe(200);
  });

  it("hidden scheme not via media; scoped images still work", async () => {
    const visible = writeUpload("projects/p1/vis.jpg", JPEG);
    const hidden = writeUpload("projects/p1/hid.jpg", JPEG);
    seedProject("p1", {
      token: "token-p1",
      items: [clientItem()],
      manualParams: {
        projectSchemes: [
          { id: "vis", title: "V", url: visible, clientVisible: true, mimeType: "image/jpeg" },
          { id: "hid", title: "H", url: hidden, clientVisible: false, mimeType: "image/jpeg" },
        ],
      },
    });
    createVersion("p1", "admin", { force: true });
    const app = clientApp();

    expect((await httpRequest(app, "GET", "/api/client/p/token-p1/images/vis")).status).toBe(200);
    expect((await httpRequest(app, "GET", "/api/client/p/token-p1/images/hid")).status).toBe(404);

    // Private project paths are not served by /media (use /images).
    const viaMedia = await httpRequest(
      app,
      "GET",
      `/api/client/p/token-p1/media?url=${encodeURIComponent(visible)}`,
    );
    expect(viaMedia.status).toBe(404);
  });

  it("old release does not get live asset fallback via /media", async () => {
    const pinned = writeUpload("public/pinned.jpg", JPEG);
    seedProject("p1", {
      token: "token-p1",
      items: [clientItem("it1", { imageUrl: pinned, photoUrl: pinned })],
    });
    createVersion("p1", "admin", { force: true });

    const liveNew = writeUpload("public/live-new.jpg", JPEG);
    const items = loadProject("p1").items || [];
    saveItems("p1", [
      ...items,
      clientItem("it-live", { imageUrl: liveNew, photoUrl: liveNew }),
    ]);

    const app = clientApp();
    const res = await httpRequest(
      app,
      "GET",
      `/api/client/p/token-p1/media?url=${encodeURIComponent(liveNew)}`,
    );
    expect(res.status).toBe(404);
  });

  it("arbitrary remote URL → 404", async () => {
    const photo = writeUpload("public/own.jpg", JPEG);
    seedProject("p1", {
      token: "token-p1",
      items: [clientItem("it1", { imageUrl: photo, photoUrl: photo })],
    });
    createVersion("p1", "admin", { force: true });
    const app = clientApp();
    const res = await httpRequest(
      app,
      "GET",
      `/api/client/p/token-p1/media?url=${encodeURIComponent("https://example.com/evil.png")}`,
    );
    expect(res.status).toBe(404);
  });

  it("direct private /uploads remains 404", async () => {
    const url = writeUpload("projects/p1/closed.jpg", JPEG);
    const app = clientApp();
    expect((await httpRequest(app, "GET", url)).status).toBe(404);
  });
});

describe("admin media proxy", () => {
  it("serves private project image with auth; blocks remote", async () => {
    const url = writeUpload("projects/p1/scheme.jpg", JPEG);
    const app = adminApp();
    const hdr = { "X-Admin-Key": ADMIN_KEY };
    const ok = await httpRequest(
      app,
      "GET",
      `/api/media/image?url=${encodeURIComponent(url)}`,
      { headers: hdr },
    );
    expect(ok.status).toBe(200);
    expect(ok.headers["cache-control"]).toMatch(/no-store/);

    const remote = await httpRequest(
      app,
      "GET",
      `/api/media/image?url=${encodeURIComponent("https://example.com/x.png")}`,
      { headers: hdr },
    );
    expect(remote.status).toBe(400);
    expect(String(remote.text)).not.toContain("example.com");
  });
});
