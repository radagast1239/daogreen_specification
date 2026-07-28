/**
 * Phase 6 — Secure project uploads and release files.
 * Temp SQLite + temp UPLOAD_ROOT only. No production DB/secrets.
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
const tempDir = path.join(os.tmpdir(), `daogreen-upload-sec-${testId}`);
const tempDbPath = path.join(tempDir, "daogreen-test.db");
const tempUploads = path.join(tempDir, "uploads");

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
]);
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
]);
const WEBP = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const PDF = Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
const FAKE_JPG = Buffer.from("not-a-jpeg-at-all");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
const XLSX_FAKE = Buffer.from("PK\x03\x04fake-xlsx");

let db;
let initDb;
let createVersion;
let saveItems;
let loadProject;
let clientRouter;
let adminRouter;
let materialsRouter;
let frameDrawingsRouter;
let assertUploadRootForStartup;
let resolveUploadRoot;
let parseProxyImageUrl;
let pinClientDocumentsForRelease;
let adminAuthMiddleware;
let ADMIN_KEY;

function writeUpload(rel, contents = "x") {
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
  if (extras.items?.length) {
    saveItems(id, extras.items);
  }
}

function clientItem(id = "it1") {
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
  };
}

function insertFile(projectId, { id, type = "other", filename = "doc.pdf", url }) {
  db.prepare(
    "INSERT INTO files (id, project_id, type, filename, url) VALUES (?, ?, ?, ?, ?)",
  ).run(id, projectId, type, filename, url);
}

function latestManifest(projectId) {
  const ver = db
    .prepare("SELECT snapshot FROM spec_versions WHERE project_id = ? ORDER BY version_number DESC")
    .get(projectId);
  const snap = JSON.parse(ver.snapshot);
  return snap.documentManifest || [];
}

function httpRequest(app, method, urlPath, { body, headers, rawBody, contentType } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const payload = rawBody != null ? rawBody : body != null ? JSON.stringify(body) : null;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: urlPath,
          method,
          headers: {
            ...(payload
              ? {
                  "Content-Type": contentType || "application/json",
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
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function multipart(fields, fileField) {
  const boundary = `----bound${Date.now()}`;
  const parts = [];
  for (const [k, v] of Object.entries(fields || {})) {
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
    );
  }
  if (fileField) {
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"\r\nContent-Type: ${fileField.mime}\r\n\r\n`,
    );
  }
  const head = Buffer.from(parts.join(""));
  const mid = fileField ? fileField.buffer : Buffer.alloc(0);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([head, mid, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

beforeAll(async () => {
  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(tempUploads, { recursive: true });
  process.env.DATABASE_PATH = tempDbPath;
  process.env.DB_PATH = tempDbPath;
  process.env.UPLOAD_ROOT = tempUploads;
  process.env.NODE_ENV = "test";
  process.env.ADMIN_KEY = "test-admin-key-upload-sec";
  ADMIN_KEY = process.env.ADMIN_KEY;
  vi.resetModules();

  const dbMod = await import("../backend/src/db.js");
  const activityMod = await import("../backend/src/services/activityLog.js");
  activityMod.initActivityLog();
  const projectsMod = await import("../backend/src/routes/projects.js");
  const adminMod = await import("../backend/src/routes/admin.js");
  const materialsMod = await import("../backend/src/routes/materialsApi.js");
  const frameMod = await import("../backend/src/routes/frameDrawings.js");
  const uploadRootMod = await import("../backend/src/services/uploadRoot.js");
  const imageProxyMod = await import("../backend/src/services/imageProxy.js");
  const pinMod = await import("../backend/src/services/releaseDocumentPinning.js");
  const authMod = await import("../backend/src/auth.js");

  db = dbMod.db;
  initDb = dbMod.initDb;
  saveItems = projectsMod.saveItems;
  createVersion = projectsMod.createVersion;
  loadProject = dbMod.loadProject;
  clientRouter = projectsMod.clientRouter;
  adminRouter = adminMod.default;
  materialsRouter = materialsMod.default;
  frameDrawingsRouter = frameMod.default;
  assertUploadRootForStartup = uploadRootMod.assertUploadRootForStartup;
  resolveUploadRoot = uploadRootMod.resolveUploadRoot;
  parseProxyImageUrl = imageProxyMod.parseProxyImageUrl;
  pinClientDocumentsForRelease = pinMod.pinClientDocumentsForRelease;
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
  db.prepare("DELETE FROM frame_drawings").run();
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

function adminApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", (req, res, next) => adminAuthMiddleware(req, res, next), adminRouter);
  app.use("/api/materials", (req, res, next) => adminAuthMiddleware(req, res, next), materialsRouter);
  app.use("/api/frame-drawings", (req, res, next) => adminAuthMiddleware(req, res, next), frameDrawingsRouter);
  app.use("/uploads/public", express.static(path.join(tempUploads, "public")));
  app.use("/uploads", (_req, res) => res.status(404).json({ error: "closed" }));
  app.use((err, _req, res, _next) => {
    const code = err.code || (String(err.message || "").includes("SVG") ? "UPLOAD_SVG_FORBIDDEN" : undefined);
    res.status(err.status || 400).json({ error: code || err.message, code, message: err.message });
  });
  return app;
}

function clientApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/client", clientRouter);
  app.use("/uploads/public", express.static(path.join(tempUploads, "public")));
  app.use("/uploads", (_req, res) => res.status(404).json({ error: "closed" }));
  return app;
}

describe("uploadRoot production assert", () => {
  it("rejects missing UPLOAD_ROOT in production", () => {
    expect(() =>
      assertUploadRootForStartup({ NODE_ENV: "production", UPLOAD_ROOT: "" }),
    ).toThrow(/UPLOAD_ROOT/);
    try {
      assertUploadRootForStartup({ NODE_ENV: "production" });
    } catch (e) {
      expect(e.code).toBe("UPLOAD_ROOT_REQUIRED");
    }
  });

  it("rejects relative UPLOAD_ROOT in production", () => {
    try {
      assertUploadRootForStartup({ NODE_ENV: "production", UPLOAD_ROOT: "uploads" });
      expect.fail("should throw");
    } catch (e) {
      expect(e.code).toBe("UPLOAD_ROOT_NOT_ABSOLUTE");
    }
  });

  it("rejects UPLOAD_ROOT inside backend package in production", () => {
    const inside = path.join(resolveUploadRoot({ NODE_ENV: "test" }), "..");
    // defaultUploadRoot is backend/uploads → parent is backend package
    const pkgUploads = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../backend/uploads-prod-test",
    );
    try {
      assertUploadRootForStartup({
        NODE_ENV: "production",
        UPLOAD_ROOT: pkgUploads,
      });
      expect.fail("should throw");
    } catch (e) {
      expect(e.code).toBe("UPLOAD_ROOT_IN_PACKAGE");
    }
  });

  it("accepts absolute outside package in production", () => {
    const ok = path.join(tempDir, "prod-uploads-ok");
    const resolved = assertUploadRootForStartup({
      NODE_ENV: "production",
      UPLOAD_ROOT: ok,
    });
    expect(resolved).toBe(path.resolve(ok));
  });

  it("dev resolves default without UPLOAD_ROOT", () => {
    const root = resolveUploadRoot({ NODE_ENV: "test" });
    expect(root).toBeTruthy();
    expect(path.isAbsolute(root)).toBe(true);
  });
});

describe("static /uploads closed; public open", () => {
  it("private project file is not served via /uploads", async () => {
    const url = writeUpload("projects/p1/secret.pdf", PDF);
    const app = adminApp();
    const res = await httpRequest(app, "GET", url);
    expect(res.status).toBe(404);
  });

  it("public material photo is served via /uploads/public", async () => {
    writeUpload("public/logo.jpg", JPEG);
    const app = adminApp();
    const res = await httpRequest(app, "GET", "/uploads/public/logo.jpg");
    expect(res.status).toBe(200);
    expect(res.buffer.slice(0, 3).equals(JPEG.slice(0, 3))).toBe(true);
  });
});

describe("admin file route", () => {
  it("requires admin auth", async () => {
    seedProject("p1", { items: [clientItem()] });
    const url = writeUpload("projects/p1/a.pdf", PDF);
    insertFile("p1", { id: "f1", filename: "a.pdf", url });
    const app = adminApp();
    const res = await httpRequest(app, "GET", "/api/admin/files/f1");
    expect(res.status).toBe(401);
  });

  it("streams file with nosniff for authorized admin", async () => {
    seedProject("p1", { items: [clientItem()] });
    const url = writeUpload("projects/p1/a.pdf", PDF);
    insertFile("p1", { id: "f1", filename: "a.pdf", url });
    const app = adminApp();
    const res = await httpRequest(app, "GET", "/api/admin/files/f1", {
      headers: { "X-Admin-Key": ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(String(res.headers["cache-control"])).toMatch(/private/i);
    expect(res.buffer.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("lists documents with accessUrl", async () => {
    seedProject("p1", { items: [clientItem()] });
    const url = writeUpload("projects/p1/a.pdf", PDF);
    insertFile("p1", { id: "f1", filename: "a.pdf", url });
    const app = adminApp();
    const res = await httpRequest(app, "GET", "/api/admin/projects/p1/documents", {
      headers: { "X-Admin-Key": ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect(res.body[0].accessUrl).toBe("/api/admin/files/f1");
  });

  it("404 for unknown file id", async () => {
    const app = adminApp();
    const res = await httpRequest(app, "GET", "/api/admin/files/nope", {
      headers: { "X-Admin-Key": ADMIN_KEY },
    });
    expect(res.status).toBe(404);
    expect(res.text).not.toContain(tempUploads);
  });
});

describe("client release file route", () => {
  it("serves pinned release asset via token-scoped route", async () => {
    const live = writeUpload("projects/p1/a.pdf", PDF);
    seedProject("p1", { items: [clientItem()], token: "token-p1" });
    insertFile("p1", { id: "fA", type: "manual", filename: "a.pdf", url: live });
    createVersion("p1", "admin", { force: true });
    const manifest = latestManifest("p1");
    expect(manifest.length).toBe(1);
    const assetId = manifest[0].id;

    const app = clientApp();
    const res = await httpRequest(app, "GET", `/api/client/p/token-p1/files/${assetId}`);
    expect(res.status).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.buffer.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("denies cross-project token for another project's asset", async () => {
    const live = writeUpload("projects/p1/a.pdf", PDF);
    seedProject("p1", { items: [clientItem()], token: "token-p1" });
    insertFile("p1", { id: "fA", filename: "a.pdf", url: live });
    createVersion("p1", "admin", { force: true });
    const assetId = latestManifest("p1")[0].id;

    seedProject("p2", { items: [clientItem("it2")], token: "token-p2" });
    createVersion("p2", "admin", { force: true });

    const app = clientApp();
    const res = await httpRequest(app, "GET", `/api/client/p/token-p2/files/${assetId}`);
    expect(res.status).toBe(404);
  });

  it("denies unpublished project", async () => {
    seedProject("p1", {
      items: [clientItem()],
      token: "token-p1",
      status: "draft",
      manualParams: {},
    });
    const app = clientApp();
    const res = await httpRequest(app, "GET", "/api/client/p/token-p1/files/any");
    expect([403, 404]).toContain(res.status);
  });

  it("denies arbitrary path / traversal asset ids", async () => {
    seedProject("p1", { items: [clientItem()], token: "token-p1" });
    createVersion("p1", "admin", { force: true });
    const app = clientApp();
    const res = await httpRequest(app, "GET", "/api/client/p/token-p1/files/..%2F..%2Fetc%2Fpasswd");
    expect([400, 404]).toContain(res.status);
  });

  it("legacy incomplete has no live fallback", async () => {
    const live = writeUpload("projects/p1/live.pdf", PDF);
    seedProject("p1", { items: [clientItem()], token: "token-p1" });
    insertFile("p1", { id: "fLive", filename: "live.pdf", url: live });
    // Manual legacy snapshot without documentManifest
    const versionId = "v-legacy";
    db.prepare(`
      INSERT INTO spec_versions (id, project_id, version_number, created_by, summary, snapshot)
      VALUES (?, 'p1', 1, 'admin', '{}', ?)
    `).run(
      versionId,
      JSON.stringify({
        schema: "release_v1",
        projectMeta: { id: "p1", name: "Proj" },
        items: [clientItem()],
      }),
    );
    db.prepare("UPDATE projects SET manual_params = ? WHERE id = 'p1'").run(
      JSON.stringify({
        publishedRelease: {
          schema: "release_v1",
          versionId,
          versionNumber: 1,
          publishedAt: new Date().toISOString(),
        },
      }),
    );
    const app = clientApp();
    const res = await httpRequest(app, "GET", "/api/client/p/token-p1/files/fLive");
    expect(res.status).toBe(404);
  });

  it("pinned file still works after live row deleted", async () => {
    const live = writeUpload("projects/p1/a.pdf", PDF);
    seedProject("p1", { items: [clientItem()], token: "token-p1" });
    insertFile("p1", { id: "fA", filename: "a.pdf", url: live });
    createVersion("p1", "admin", { force: true });
    const assetId = latestManifest("p1")[0].id;
    db.prepare("DELETE FROM files WHERE id = 'fA'").run();
    fs.unlinkSync(path.join(tempUploads, "projects/p1/a.pdf"));

    const app = clientApp();
    const res = await httpRequest(app, "GET", `/api/client/p/token-p1/files/${assetId}`);
    expect(res.status).toBe(200);
  });
});

describe("upload validation", () => {
  it("accepts JPEG/PNG/WebP magic; rejects fake jpg, svg, mime mismatch", async () => {
    const app = adminApp();
    const hdr = { "X-Admin-Key": ADMIN_KEY };

    async function upload(buffer, filename, mime) {
      const { body, contentType } = multipart({}, {
        name: "file",
        filename,
        mime,
        buffer,
      });
      return httpRequest(app, "POST", "/api/materials/upload-photo", {
        rawBody: body,
        contentType,
        headers: hdr,
      });
    }

    expect((await upload(JPEG, "a.jpg", "image/jpeg")).status).toBe(200);
    expect((await upload(PNG, "a.png", "image/png")).status).toBe(200);
    expect((await upload(WEBP, "a.webp", "image/webp")).status).toBe(200);

    const fake = await upload(FAKE_JPG, "a.jpg", "image/jpeg");
    expect(fake.status).toBe(400);
    expect(fake.body.code).toMatch(/MAGIC|MISMATCH/);

    const svg = await upload(SVG, "a.svg", "image/svg+xml");
    expect(svg.status).toBe(400);

    const mismatch = await upload(JPEG, "a.png", "image/png");
    expect(mismatch.status).toBe(400);
  });

  it("frame drawing requires real PDF", async () => {
    seedProject("p1", { items: [clientItem()] });
    const app = adminApp();
    const hdr = { "X-Admin-Key": ADMIN_KEY };

    async function upload(buffer, filename, mime) {
      const { body, contentType } = multipart(
        { project_id: "p1", title: "FD", source_type: "standalone" },
        { name: "file", filename, mime, buffer },
      );
      return httpRequest(app, "POST", "/api/frame-drawings", {
        rawBody: body,
        contentType,
        headers: hdr,
      });
    }

    const ok = await upload(PDF, "d.pdf", "application/pdf");
    expect([200, 201]).toContain(ok.status);

    const fake = await upload(FAKE_JPG, "d.pdf", "application/pdf");
    expect(fake.status).toBe(400);
    expect(fake.body.code).toBe("FRAME_DRAWING_PDF_REQUIRED");

    const png = await upload(PNG, "d.png", "image/png");
    expect(png.status).toBe(400);

    const xlsx = await upload(XLSX_FAKE, "d.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(xlsx.status).toBe(400);
  });

  it("writes material photos under public/", async () => {
    const app = adminApp();
    const { body, contentType } = multipart({}, {
      name: "file",
      filename: "m.jpg",
      mime: "image/jpeg",
      buffer: JPEG,
    });
    const res = await httpRequest(app, "POST", "/api/materials/upload-photo", {
      rawBody: body,
      contentType,
      headers: { "X-Admin-Key": ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/uploads\/public\//);
    const rel = res.body.url.replace(/^\/uploads\//, "");
    expect(fs.existsSync(path.join(tempUploads, rel))).toBe(true);
  });

  it("writes project documents under projects/ private", async () => {
    seedProject("p1", { items: [clientItem()] });
    const app = adminApp();
    const { body, contentType } = multipart(
      { type: "manual" },
      { name: "file", filename: "doc.pdf", mime: "application/pdf", buffer: PDF },
    );
    const res = await httpRequest(app, "POST", "/api/admin/projects/p1/documents", {
      rawBody: body,
      contentType,
      headers: { "X-Admin-Key": ADMIN_KEY },
    });
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^\/uploads\/projects\/p1\//);
    expect(res.body.accessUrl).toMatch(/^\/api\/admin\/files\//);
    const staticRes = await httpRequest(app, "GET", res.body.url);
    expect(staticRes.status).toBe(404);
  });
});

describe("imageProxy private fail-closed", () => {
  it("blocks private prefixes for client; allows public", () => {
    writeUpload("public/ok.jpg", JPEG);
    writeUpload("projects/p1/x.jpg", JPEG);
    writeUpload("releases/p1/v1/x.jpg", JPEG);
    writeUpload("frame-drawings/p1/x.pdf", PDF);

    expect(parseProxyImageUrl("/uploads/public/ok.jpg").kind).toBe("local");
    expect(parseProxyImageUrl("/uploads/projects/p1/x.jpg").error).toBeTruthy();
    expect(parseProxyImageUrl("/uploads/releases/p1/v1/x.jpg").error).toBeTruthy();
    expect(parseProxyImageUrl("/uploads/frame-drawings/p1/x.pdf").error).toBeTruthy();

    expect(parseProxyImageUrl("/uploads/projects/p1/x.jpg", { allowPrivate: true }).kind).toBe("local");
  });

  it("supports nested public paths (not basename-only)", () => {
    writeUpload("public/brand/logo.jpg", JPEG);
    const parsed = parseProxyImageUrl("/uploads/public/brand/logo.jpg");
    expect(parsed.kind).toBe("local");
    expect(parsed.filePath).toContain(path.join("public", "brand", "logo.jpg"));
  });
});

describe("pinning still works under upload root", () => {
  it("pins only inside UPLOAD_ROOT/releases", () => {
    const live = writeUpload("projects/p1/doc.pdf", PDF);
    const { documentManifest, pinnedCount } = pinClientDocumentsForRelease({
      projectId: "p1",
      versionId: "v9",
      liveDocuments: [{ id: "f1", type: "manual", filename: "doc.pdf", url: live }],
      uploadRoot: tempUploads,
    });
    expect(pinnedCount).toBe(1);
    expect(documentManifest[0].url).toContain("/uploads/releases/p1/v9/");
    const abs = path.join(tempUploads, documentManifest[0].url.replace(/^\/uploads\//, ""));
    expect(fs.existsSync(abs)).toBe(true);
  });
});
