import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import { buildClientImageManifest } from "../shared/clientImageManifest.js";

const require = createRequire(import.meta.url);
const express = require("../backend/node_modules/express");

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-scheme-upload-${testId}`);
const tempDbPath = path.join(tempDir, "daogreen-test.db");
const tempUploads = path.join(tempDir, "uploads");

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const FAKE = Buffer.from("not-a-real-pdf-file-content");

let db;
let initDb;
let adminAuthMiddleware;
let adminApi;
let materialsApi;
let updateProject;
let loadPublishedReleaseSnapshot;
let buildClientProjectFromRelease;

async function listenApp(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

function adminApp() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/admin", (req, res, next) => adminAuthMiddleware(req, res, next), adminApi);
  app.use("/api/materials", (req, res, next) => adminAuthMiddleware(req, res, next), materialsApi);
  return app;
}

async function postMultipart(base, route, buffer, { filename, contentType, field = "file", headers = {} } = {}) {
  const boundary = "----DaogreenBoundary" + Date.now();
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await fetch(`${base}${route}`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "X-Admin-Key": "scheme-upload-test-key",
      ...headers,
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

beforeAll(async () => {
  fs.mkdirSync(tempUploads, { recursive: true });
  process.env.DATABASE_PATH = tempDbPath;
  process.env.DB_PATH = tempDbPath;
  process.env.UPLOAD_ROOT = tempUploads;
  process.env.ADMIN_KEY = "scheme-upload-test-key";
  process.env.NODE_ENV = "test";
  vi.resetModules();
  const dbMod = await import("../backend/src/db.js");
  const authMod = await import("../backend/src/auth.js");
  const adminMod = await import("../backend/src/routes/admin.js");
  const materialsMod = await import("../backend/src/routes/materialsApi.js");
  const projectsMod = await import("../backend/src/routes/projects.js");
  const releaseMod = await import("../backend/src/services/publishedReleaseService.js");
  db = dbMod.db;
  initDb = dbMod.initDb;
  adminAuthMiddleware = authMod.adminAuthMiddleware;
  adminApi = adminMod.default;
  materialsApi = materialsMod.default;
  updateProject = projectsMod.updateProject;
  loadPublishedReleaseSnapshot = releaseMod.loadPublishedReleaseSnapshot;
  buildClientProjectFromRelease = releaseMod.buildClientProjectFromRelease;
  initDb();
});

beforeEach(() => {
  process.env.UPLOAD_ROOT = tempUploads;
  process.env.ADMIN_KEY = "scheme-upload-test-key";
  db.prepare("DELETE FROM spec_versions").run();
  db.prepare("DELETE FROM project_items").run();
  db.prepare("DELETE FROM files").run();
  db.prepare("DELETE FROM materials").run();
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

describe("project scheme upload endpoint", () => {
  it("accepts valid PDF and stores under upload root with generated name", async () => {
    const { server, base } = await listenApp(adminApp());
    try {
      const { status, data } = await postMultipart(base, "/api/admin/project-schemes/upload", PDF, {
        filename: "../../evil.pdf",
        contentType: "application/pdf",
      });
      expect(status).toBe(201);
      expect(data.mimeType).toBe("application/pdf");
      expect(data.url).toMatch(/^\/uploads\/(?:public\/)?[A-Za-z0-9_-]+\.pdf$/);
      expect(data.url).not.toContain("..");
      const stored = path.join(
        tempUploads,
        data.url.replace(/^\/uploads\//, "").replace(/\//g, path.sep),
      );
      expect(fs.existsSync(stored)).toBe(true);
      expect(fs.readFileSync(stored).subarray(0, 5).toString("ascii")).toBe("%PDF-");
    } finally {
      server.close();
    }
  });

  it("accepts PNG for schemes", async () => {
    const { server, base } = await listenApp(adminApp());
    try {
      const { status, data } = await postMultipart(base, "/api/admin/project-schemes/upload", PNG, {
        filename: "plan.png",
        contentType: "image/png",
      });
      expect(status).toBe(201);
      expect(data.mimeType).toBe("image/png");
    } finally {
      server.close();
    }
  });

  it("rejects fake PDF signature", async () => {
    const { server, base } = await listenApp(adminApp());
    try {
      const { status } = await postMultipart(base, "/api/admin/project-schemes/upload", FAKE, {
        filename: "x.pdf",
        contentType: "application/pdf",
      });
      expect(status).toBeGreaterThanOrEqual(400);
    } finally {
      server.close();
    }
  });

  it("materials upload-photo still rejects PDF", async () => {
    const { server, base } = await listenApp(adminApp());
    try {
      const { status } = await postMultipart(base, "/api/materials/upload-photo", PDF, {
        filename: "x.pdf",
        contentType: "application/pdf",
      });
      expect(status).toBeGreaterThanOrEqual(400);
    } finally {
      server.close();
    }
  });

  it("document rename updates filename without schema change", async () => {
    const { server, base } = await listenApp(adminApp());
    try {
      db.prepare(
        "INSERT INTO projects (id, name, client_token) VALUES ('p1', 'P', 'tok-p1')"
      ).run();
      const url = "/uploads/doc.pdf";
      fs.writeFileSync(path.join(tempUploads, "doc.pdf"), PDF);
      db.prepare(
        "INSERT INTO files (id, project_id, type, filename, url) VALUES ('f1', 'p1', 'other', 'old.pdf', ?)"
      ).run(url);
      const res = await fetch(`${base}/api/admin/documents/f1`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": "scheme-upload-test-key",
        },
        body: JSON.stringify({ filename: "Счёт июль.pdf" }),
      });
      expect(res.status).toBe(200);
      const row = db.prepare("SELECT filename FROM files WHERE id = 'f1'").get();
      expect(row.filename).toBe("Счёт июль.pdf");
    } finally {
      server.close();
    }
  });
});

describe("published PDF scheme snapshot", () => {
  it("pins PDF scheme in release and ignores live-only draft until republish", async () => {
    db.prepare(
      `INSERT INTO materials (id, name, unit, category, base_price, module, supplier, link, photo_url, client_section, client_subsection)
       VALUES ('mat1', 'Material', 'шт.', 'Каркас и крепёж', 100, 'general', 'S', 'https://ex', '/uploads/m.png', 'A', 'B')`
    ).run();
    fs.writeFileSync(path.join(tempUploads, "m.png"), PNG);
    db.prepare(
      "INSERT INTO projects (id, name, client, client_token, status, revision) VALUES ('pub1', 'Pub', 'C', 'client-tok-pub1', 'active', 1)"
    ).run();

    const pdfName = "pinned-scheme.pdf";
    const pdfUrl = `/uploads/${pdfName}`;
    fs.writeFileSync(path.join(tempUploads, pdfName), PDF);

    const pngName = "pinned-scheme.png";
    const pngUrl = `/uploads/${pngName}`;
    fs.writeFileSync(path.join(tempUploads, pngName), PNG);

    updateProject("pub1", {
      expectedRevision: 1,
      name: "Pub",
      manualParams: {
        projectSchemes: [
          {
            id: "sch-pdf",
            title: "PDF published",
            url: pdfUrl,
            mimeType: "application/pdf",
            clientVisible: true,
            sortOrder: 0,
          },
          {
            id: "sch-img",
            title: "IMG published",
            url: pngUrl,
            mimeType: "image/png",
            clientVisible: true,
            sortOrder: 1,
          },
        ],
      },
      items: [
        {
          id: "it1",
          materialId: "mat1",
          name: "Линия",
          unit: "шт.",
          module: "general",
          section: "general",
          category: "Каркас и крепёж",
          qty: 1,
          price: 100,
          itemType: "material",
          includedInProject: true,
          enabled: true,
          visibleToClient: true,
          approved: true,
          supplier: "ООО Поставщик",
          link: "https://example.test/x",
          photoUrl: "/uploads/m.png",
          clientSection: "Каркас",
          clientSubsection: "Профиль",
        },
      ],
    });

    const { createVersion } = await import("../backend/src/routes/projects.js");
    const { loadProject } = await import("../backend/src/db.js");
    createVersion("pub1", "admin", { force: true, releaseComment: "pdf schemes" });
    const saved = loadProject("pub1");
    const release = loadPublishedReleaseSnapshot(saved);
    expect(release.imageManifest.projectSchemes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "sch-pdf",
          mimeType: "application/pdf",
          title: "PDF published",
          url: pdfUrl,
        }),
      ])
    );

    // Live draft adds another PDF — must not appear on client until republish
    const livePdf = "/uploads/live-only.pdf";
    fs.writeFileSync(path.join(tempUploads, "live-only.pdf"), PDF);
    const proj = db.prepare("SELECT revision FROM projects WHERE id = 'pub1'").get();
    updateProject("pub1", {
      expectedRevision: proj.revision,
      manualParams: {
        projectSchemes: [
          {
            id: "sch-pdf",
            title: "PDF published RENAMED LIVE",
            url: pdfUrl,
            mimeType: "application/pdf",
            clientVisible: true,
            sortOrder: 0,
          },
          {
            id: "sch-img",
            title: "IMG published",
            url: pngUrl,
            mimeType: "image/png",
            clientVisible: true,
            sortOrder: 1,
          },
          {
            id: "sch-live",
            title: "Live only",
            url: livePdf,
            mimeType: "application/pdf",
            clientVisible: true,
            sortOrder: 2,
          },
        ],
      },
    });

    const snapshot = loadPublishedReleaseSnapshot(saved);
    const clientProject = buildClientProjectFromRelease(saved, snapshot, { overlayLive: false });
    const ids = (clientProject.clientImages?.projectSchemes || []).map((s) => s.id);
    expect(ids).toContain("sch-pdf");
    expect(ids).not.toContain("sch-live");
    const pdfEntry = clientProject.clientImages.projectSchemes.find((s) => s.id === "sch-pdf");
    expect(pdfEntry.title).toBe("PDF published");
    expect(pdfEntry.mimeType).toBe("application/pdf");

    const liveManifest = buildClientImageManifest({
      manualParams: JSON.parse(db.prepare("SELECT manual_params FROM projects WHERE id = 'pub1'").get().manual_params),
      stellageConfigs: [],
    });
    expect(liveManifest.projectSchemes.some((s) => s.id === "sch-live")).toBe(true);
  });
});
