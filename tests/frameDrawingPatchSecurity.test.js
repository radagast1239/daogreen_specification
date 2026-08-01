/**
 * T6A — Frame drawing PATCH must reject server-owned fields and unknown keys.
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
const tempDir = path.join(os.tmpdir(), `daogreen-frame-patch-${testId}`);
const tempDbPath = path.join(tempDir, "daogreen-test.db");
const tempUploads = path.join(tempDir, "uploads");

const PDF = Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");

let db;
let initDb;
let frameDrawingsRouter;
let adminAuthMiddleware;
let ADMIN_KEY;

function seedProject(id = "p1") {
  db.prepare(`
    INSERT INTO projects (id, name, client, city, client_token, status, manual_params, rooms, currency, vat, version, comment, stellage_configs, revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    "Proj",
    "Client",
    "City",
    `token-${id}`,
    "sent_to_client",
    "{}",
    "[]",
    "₽",
    1,
    1,
    "",
    "[]",
    1,
  );
}

function insertDrawing(overrides = {}) {
  const id = overrides.id || "fd1";
  const projectId = overrides.project_id ?? "p1";
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO frame_drawings (
      id, project_id, module_id, stellage_id, module_rack_key, preset_id, source_type,
      title, rack_type, frame_config_json, pdf_url, pdf_filename, file_id,
      is_client_visible, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    projectId,
    overrides.module_id ?? null,
    overrides.stellage_id ?? null,
    overrides.module_rack_key ?? null,
    overrides.preset_id ?? null,
    overrides.source_type ?? "project_stellage",
    overrides.title ?? "Test drawing",
    overrides.rack_type ?? "nft",
    overrides.frame_config_json ?? '{"lengthMm":3000}',
    overrides.pdf_url ?? `/uploads/frame-drawings/${projectId}/${id}.pdf`,
    overrides.pdf_filename ?? "test.pdf",
    overrides.file_id ?? null,
    overrides.is_client_visible ?? 1,
    overrides.version ?? 1,
    now,
    now,
  );
  return id;
}

function writeUpload(rel, contents = "x") {
  const abs = path.join(tempUploads, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.isBuffer(contents) ? contents : Buffer.from(contents));
  return `/uploads/${rel.replace(/\\/g, "/")}`;
}

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
  app.use(
    "/api/frame-drawings",
    (req, res, next) => adminAuthMiddleware(req, res, next),
    frameDrawingsRouter,
  );
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Server error" });
  });
  return app;
}

beforeAll(async () => {
  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(tempUploads, { recursive: true });
  process.env.DATABASE_PATH = tempDbPath;
  process.env.DB_PATH = tempDbPath;
  process.env.UPLOAD_ROOT = tempUploads;
  process.env.NODE_ENV = "test";
  process.env.ADMIN_KEY = "test-admin-key-frame-patch";
  ADMIN_KEY = process.env.ADMIN_KEY;
  vi.resetModules();

  const dbMod = await import("../backend/src/db.js");
  const frameMod = await import("../backend/src/routes/frameDrawings.js");
  const authMod = await import("../backend/src/auth.js");

  db = dbMod.db;
  initDb = dbMod.initDb;
  frameDrawingsRouter = frameMod.default;
  adminAuthMiddleware = authMod.adminAuthMiddleware;
  initDb();
});

beforeEach(() => {
  db.prepare("DELETE FROM files").run();
  db.prepare("DELETE FROM frame_drawings").run();
  db.prepare("DELETE FROM projects").run();
  for (const name of fs.readdirSync(tempUploads)) {
    fs.rmSync(path.join(tempUploads, name), { recursive: true, force: true });
  }
  seedProject();
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

describe("T6A frame drawing PATCH allowlist", () => {
  it("allows title change", async () => {
    insertDrawing();
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/frame-drawings/fd1", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: { title: "Renamed drawing" },
    });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Renamed drawing");

    const row = db.prepare("SELECT title, pdf_url FROM frame_drawings WHERE id = ?").get("fd1");
    expect(row.title).toBe("Renamed drawing");
    expect(row.pdf_url).toBe("/uploads/frame-drawings/p1/fd1.pdf");
  });

  it("allows is_client_visible change via snake_case", async () => {
    insertDrawing({ is_client_visible: 1 });
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/frame-drawings/fd1", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: { is_client_visible: false },
    });
    expect(res.status).toBe(200);
    expect(res.body.isClientVisible).toBe(false);
  });

  it("allows is_client_visible change via camelCase", async () => {
    insertDrawing({ is_client_visible: 0 });
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/frame-drawings/fd1", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: { isClientVisible: true },
    });
    expect(res.status).toBe(200);
    expect(res.body.isClientVisible).toBe(true);
  });

  it("rejects unknown field", async () => {
    insertDrawing();
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/frame-drawings/fd1", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: { unknownField: "x" },
    });
    expect(res.status).toBe(422);
    expect(res.body.forbiddenKeys).toContain("unknownField");
    expect(res.body.error).toMatch(/Forbidden/i);
  });

  it("rejects mixed payload atomically", async () => {
    insertDrawing({ title: "Original", is_client_visible: 1 });
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/frame-drawings/fd1", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: { is_client_visible: false, pdf_url: "/malicious/path" },
    });
    expect(res.status).toBe(422);
    expect(res.body.forbiddenKeys).toContain("pdf_url");

    const row = db.prepare("SELECT title, is_client_visible, pdf_url FROM frame_drawings WHERE id = ?").get("fd1");
    expect(row.title).toBe("Original");
    expect(row.is_client_visible).toBe(1);
    expect(row.pdf_url).toBe("/uploads/frame-drawings/p1/fd1.pdf");
  });

  it.each([
    ["frozen-looking URL", "/uploads/frame-drawings/p1/evil.pdf"],
    ["live upload URL", "/uploads/frame-drawings/p2/fd1.pdf"],
    ["URL of another project", "/uploads/frame-drawings/other/fd1.pdf"],
    ["absolute path", "/etc/passwd"],
    ["file protocol", "file:///etc/passwd"],
    ["http URL", "http://example.com/x.pdf"],
    ["https URL", "https://example.com/x.pdf"],
    ["traversal", "../etc/passwd"],
    ["null", null],
    ["empty string", ""],
    ["whitespace", "   "],
  ])("rejects pdf_url: %s", async (_label, pdfUrl) => {
    insertDrawing();
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/frame-drawings/fd1", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: { pdf_url: pdfUrl },
    });
    expect(res.status).toBe(422);
    expect(res.body.forbiddenKeys).toContain("pdf_url");
    // Error must not echo the malicious value.
    expect(res.text).not.toContain(String(pdfUrl ?? "").trim() || "null");
    expect(res.text).not.toContain("/etc/passwd");
    expect(res.text).not.toContain("example.com");
  });

  it.each([
    "pdf_filename",
    "pdfFilename",
    "file_id",
    "fileId",
    "id",
    "project_id",
    "projectId",
    "module_id",
    "moduleId",
    "stellage_id",
    "stellageId",
    "module_rack_key",
    "moduleRackKey",
    "preset_id",
    "presetId",
    "source_type",
    "sourceType",
    "rack_type",
    "rackType",
    "frame_config_json",
    "frameConfigJson",
    "version",
    "created_at",
    "createdAt",
    "updated_at",
    "updatedAt",
    "downloadUrl",
  ])("rejects server-owned field: %s", async (key) => {
    insertDrawing();
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/frame-drawings/fd1", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: { [key]: "x" },
    });
    expect(res.status).toBe(422);
    expect(res.body.forbiddenKeys).toContain(key);
  });

  it("keeps server-owned fields unchanged after rejected payload", async () => {
    insertDrawing({ file_id: "files_1", version: 7 });
    db.prepare("INSERT INTO files (id, project_id, type, filename, url) VALUES (?, ?, ?, ?, ?)").run(
      "files_1", "p1", "frame_drawing", "test.pdf", "/uploads/frame-drawings/p1/fd1.pdf",
    );
    writeUpload("frame-drawings/p1/fd1.pdf", PDF);

    const app = adminApp();
    await httpRequest(app, "PATCH", "/api/frame-drawings/fd1", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: { pdf_url: "/evil.pdf", file_id: "files_2", version: 99, title: "New title" },
    });

    const row = db.prepare("SELECT pdf_url, file_id, version, title FROM frame_drawings WHERE id = ?").get("fd1");
    expect(row.pdf_url).toBe("/uploads/frame-drawings/p1/fd1.pdf");
    expect(row.file_id).toBe("files_1");
    expect(row.version).toBe(7);
    expect(row.title).toBe("Test drawing");
  });

  it("server-side PDF upload continues to set pdf_url through internal path", async () => {
    const id = "fd_upload";
    seedProject("p2");
    insertDrawing({ id, project_id: "p2", pdf_url: `/uploads/frame-drawings/p2/${id}.pdf` });
    writeUpload(`frame-drawings/p2/${id}.pdf`, PDF);

    const app = adminApp();
    // Internal visibility sync must still work when only title changes.
    const res = await httpRequest(app, "PATCH", `/api/frame-drawings/${id}`, {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: { title: "After upload" },
    });
    expect(res.status).toBe(200);
    expect(res.body.pdfUrl).toBe(`/uploads/frame-drawings/p2/${id}.pdf`);
  });

  it("cross-project isolation: row from p1 cannot be addressed as if it belongs to p2", async () => {
    seedProject("p2");
    insertDrawing({ id: "fd_p1", project_id: "p1" });
    insertDrawing({ id: "fd_p2", project_id: "p2" });

    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/frame-drawings/fd_p1", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: { title: "p1 renamed" },
    });
    expect(res.status).toBe(200);
    expect(res.body.projectId).toBe("p1");

    const p2row = db.prepare("SELECT title FROM frame_drawings WHERE id = ?").get("fd_p2");
    expect(p2row.title).toBe("Test drawing");
  });

  it("rejects full drawing object sent by a misconfigured frontend", async () => {
    insertDrawing();
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/frame-drawings/fd1", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: {
        id: "fd1",
        projectId: "p1",
        pdfUrl: "/uploads/frame-drawings/p1/fd1.pdf",
        pdfFilename: "test.pdf",
        fileId: null,
        title: "New title",
        isClientVisible: false,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    expect(res.status).toBe(422);
    const forbidden = new Set(res.body.forbiddenKeys);
    expect(forbidden.has("id")).toBe(true);
    expect(forbidden.has("projectId")).toBe(true);
    expect(forbidden.has("pdfUrl")).toBe(true);
    expect(forbidden.has("pdfFilename")).toBe(true);
    expect(forbidden.has("fileId")).toBe(true);
    expect(forbidden.has("version")).toBe(true);
    expect(forbidden.has("createdAt")).toBe(true);
    expect(forbidden.has("updatedAt")).toBe(true);
  });

  it("error response does not contain malicious values or filesystem paths", async () => {
    insertDrawing();
    const app = adminApp();
    const res = await httpRequest(app, "PATCH", "/api/frame-drawings/fd1", {
      headers: { "X-Admin-Key": ADMIN_KEY },
      body: { pdf_url: "/uploads/../../../../etc/passwd" },
    });
    expect(res.status).toBe(422);
    expect(res.text).not.toContain("/etc/passwd");
    expect(res.text).not.toContain("..");
    expect(res.text).not.toContain(tempUploads);
  });
});
