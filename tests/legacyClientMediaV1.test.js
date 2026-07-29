/**
 * Legacy release_v1 frozen media compatibility + canonical URL rules.
 * Sanitized fixture mirrors production shape (schema/keys/photo path only).
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import {
  canonicalizeClientMediaUrl,
  collectFrozenClientMediaUrls,
  isUrlInFrozenClientMedia,
} from "../backend/src/services/clientMediaAllowlist.js";

const require = createRequire(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../backend/package.json"),
);
const express = require("express");

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-legacy-v1-media-${testId}`);
const tempDbPath = path.join(tempDir, "daogreen-test.db");
const tempUploads = path.join(tempDir, "uploads");

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
]);

let db;
let initDb;
let saveItems;
let clientRouter;

function writeUpload(rel, contents = JPEG) {
  const abs = path.join(tempUploads, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.isBuffer(contents) ? contents : Buffer.from(contents));
  return `/uploads/${rel.replace(/\\/g, "/")}`;
}

function httpRequest(app, method, urlPath) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const req = http.request(
        { hostname: "127.0.0.1", port, path: urlPath, method },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            server.close();
            const buf = Buffer.concat(chunks);
            resolve({
              status: res.statusCode,
              headers: res.headers,
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
  app.use("/api/client", clientRouter);
  app.use("/uploads", (_req, res) => res.status(404).json({ error: "closed" }));
  return app;
}

/** Sanitized production release_v1 shape (no PII/tokens). */
function legacyV1Snapshot({ frozenPhoto, extraItems = [] }) {
  return {
    schema: "release_v1",
    publishedAt: "2025-01-01T00:00:00.000Z",
    projectMeta: { currency: "₽" },
    items: [
      {
        id: "it_frozen_1",
        materialId: "mat_frozen",
        name: "Fixture Item",
        unit: "шт.",
        module: "general",
        qty: 1,
        price: 10,
        visibleToClient: true,
        itemType: "material",
        status: "not_bought",
        imageUrl: frozenPhoto,
        photoUrl: frozenPhoto,
      },
      ...extraItems,
    ],
  };
}

function seedLegacyV1Project({
  id = "p_v1",
  token = "token-v1",
  frozenPhoto,
  versionId = "v_legacy_v1",
}) {
  const snap = legacyV1Snapshot({ frozenPhoto });
  db.prepare(`
    INSERT INTO projects (id, name, client, city, client_token, status, manual_params, rooms, currency, vat, version, comment, stellage_configs, revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    "Legacy Fixture",
    "Client",
    "City",
    token,
    "sent_to_client",
    JSON.stringify({
      publishedRelease: { versionId, versionNumber: 1, schema: "release_v1" },
    }),
    "[]",
    "₽",
    1,
    1,
    "",
    "[]",
    1,
  );
  db.prepare(`
    INSERT INTO spec_versions (id, project_id, version_number, created_at, created_by, snapshot, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    versionId,
    id,
    1,
    new Date().toISOString(),
    "test",
    JSON.stringify(snap),
    "{}",
  );
  return snap;
}

beforeAll(async () => {
  fs.mkdirSync(tempUploads, { recursive: true });
  process.env.DATABASE_PATH = tempDbPath;
  process.env.DB_PATH = tempDbPath;
  process.env.UPLOAD_ROOT = tempUploads;
  process.env.NODE_ENV = "test";
  process.env.ADMIN_KEY = "test-admin-key-legacy-v1";
  vi.resetModules();

  const dbMod = await import("../backend/src/db.js");
  const activityMod = await import("../backend/src/services/activityLog.js");
  activityMod.initActivityLog();
  const projectsMod = await import("../backend/src/routes/projects.js");
  db = dbMod.db;
  initDb = dbMod.initDb;
  saveItems = projectsMod.saveItems;
  clientRouter = projectsMod.clientRouter;
  initDb();
  db.prepare(`
    INSERT INTO materials (id, name, unit, category, base_price, module, supplier, link, photo_url)
    VALUES ('mat1', 'Bolt', 'шт.', 'Каркас', 10, 'general', 'Sup', '', '/uploads/live-mat.jpg')
  `).run();
});

beforeEach(() => {
  db.prepare("DELETE FROM spec_versions").run();
  db.prepare("DELETE FROM project_items").run();
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

describe("canonicalizeClientMediaUrl", () => {
  it("accepts exact legacy upload path; rejects traversal/query/backslash/remote", () => {
    expect(canonicalizeClientMediaUrl("/uploads/m046.jpg")).toBe("/uploads/m046.jpg");
    expect(canonicalizeClientMediaUrl("/uploads/public/a.jpg")).toBe("/uploads/public/a.jpg");
    expect(canonicalizeClientMediaUrl("/uploads/foo/../m046.jpg")).toBe("");
    expect(canonicalizeClientMediaUrl("/uploads/%2e%2e/m046.jpg")).toBe("");
    expect(canonicalizeClientMediaUrl("/uploads/m046.jpg?x=1")).toBe("");
    expect(canonicalizeClientMediaUrl("/uploads/m046.jpg#h")).toBe("");
    expect(canonicalizeClientMediaUrl("/uploads\\m046.jpg")).toBe("");
    expect(canonicalizeClientMediaUrl("//evil/uploads/m046.jpg")).toBe("");
    expect(canonicalizeClientMediaUrl("https://cdn.example/a.jpg")).toMatch(/^https:/);
    expect(canonicalizeClientMediaUrl("http://cdn.example/a.jpg")).toBe("");
    expect(canonicalizeClientMediaUrl("file:///uploads/m046.jpg")).toBe("");
  });
});

describe("legacy release_v1 frozen media", () => {
  it("serves frozen local photo on incomplete v1; blocks non-frozen sibling", async () => {
    const frozen = writeUpload("m046.jpg", JPEG);
    const other = writeUpload("m999.jpg", JPEG);
    seedLegacyV1Project({ frozenPhoto: frozen });
    const app = clientApp();

    const ok = await httpRequest(
      app,
      "GET",
      `/api/client/p/token-v1/media?url=${encodeURIComponent(frozen)}`,
    );
    expect(ok.status).toBe(200);
    expect(ok.buffer[0]).toBe(0xff);
    expect(ok.headers["cache-control"]).toMatch(/no-store/);

    const blocked = await httpRequest(
      app,
      "GET",
      `/api/client/p/token-v1/media?url=${encodeURIComponent(other)}`,
    );
    expect(blocked.status).toBe(404);
  });

  it("rejects traversal / query / similar filename / foreign token", async () => {
    const frozen = writeUpload("m046.jpg", JPEG);
    writeUpload("m047.jpg", JPEG);
    seedLegacyV1Project({ frozenPhoto: frozen });
    // foreign project with same basename frozen elsewhere
    writeUpload("other/m046.jpg", JPEG);
    seedLegacyV1Project({
      id: "p_v1b",
      token: "token-v1b",
      versionId: "v_legacy_v1b",
      frozenPhoto: "/uploads/other/m046.jpg",
    });
    // ensure foreign file exists
    writeUpload("other/m046.jpg", JPEG);

    const app = clientApp();
    const enc = encodeURIComponent;

    expect(
      (await httpRequest(app, "GET", `/api/client/p/token-v1/media?url=${enc("/uploads/foo/../m046.jpg")}`))
        .status,
    ).toBe(404);
    expect(
      (await httpRequest(app, "GET", `/api/client/p/token-v1/media?url=${enc("/uploads/%2e%2e/m046.jpg")}`))
        .status,
    ).toBe(404);
    expect(
      (await httpRequest(app, "GET", `/api/client/p/token-v1/media?url=${enc("/uploads/m046.jpg?x=1")}`))
        .status,
    ).toBe(404);
    expect(
      (await httpRequest(app, "GET", `/api/client/p/token-v1/media?url=${enc("/uploads/m047.jpg")}`))
        .status,
    ).toBe(404);
    expect(
      (await httpRequest(app, "GET", `/api/client/p/token-v1/media?url=${enc("/uploads/other/m046.jpg")}`))
        .status,
    ).toBe(404);
    expect(
      (await httpRequest(app, "GET", `/api/client/p/token-v1b/media?url=${enc(frozen)}`)).status,
    ).toBe(404);
    expect(
      (await httpRequest(app, "GET", `/api/client/p/random/media?url=${enc(frozen)}`)).status,
    ).toBe(404);
  });

  it("does not follow live materials.photo_url or live project item changes", async () => {
    const frozen = writeUpload("m046.jpg", JPEG);
    const liveNew = writeUpload("live-new.jpg", JPEG);
    seedLegacyV1Project({ frozenPhoto: frozen });
    db.prepare("UPDATE materials SET photo_url = ? WHERE id = 'mat1'").run(liveNew);
    saveItems("p_v1", [
      {
        id: "it_live",
        materialId: "mat1",
        name: "Live",
        unit: "шт.",
        module: "general",
        qty: 1,
        price: 1,
        visibleToClient: true,
        includedInProject: true,
        enabled: true,
        approved: true,
        itemType: "material",
        status: "not_bought",
        imageUrl: liveNew,
        photoUrl: liveNew,
      },
    ]);

    const app = clientApp();
    expect(
      (
        await httpRequest(
          app,
          "GET",
          `/api/client/p/token-v1/media?url=${encodeURIComponent(frozen)}`,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await httpRequest(
          app,
          "GET",
          `/api/client/p/token-v1/media?url=${encodeURIComponent(liveNew)}`,
        )
      ).status,
    ).toBe(404);

    // Allowlist from snapshot only — not live items.
    const snap = legacyV1Snapshot({ frozenPhoto: frozen });
    expect([...collectFrozenClientMediaUrls(snap)]).toEqual([frozen]);
    expect(isUrlInFrozenClientMedia(liveNew, snap)).toBe(false);
  });

  it("blocks remote URL and malformed snapshot fail-closed", async () => {
    const frozen = writeUpload("m046.jpg", JPEG);
    seedLegacyV1Project({ frozenPhoto: frozen });
    db.prepare("UPDATE spec_versions SET snapshot = ? WHERE id = 'v_legacy_v1'").run(
      JSON.stringify({ schema: "release_v1", items: [], projectMeta: {} }),
    );
    const app = clientApp();
    expect(
      (
        await httpRequest(
          app,
          "GET",
          `/api/client/p/token-v1/media?url=${encodeURIComponent(frozen)}`,
        )
      ).status,
    ).toBe(404);

    // restore shape with remote in item — still 404 for /media
    db.prepare("UPDATE spec_versions SET snapshot = ? WHERE id = 'v_legacy_v1'").run(
      JSON.stringify(
        legacyV1Snapshot({
          frozenPhoto: "https://cdn.example/remote.jpg",
        }),
      ),
    );
    // remote file not local — create no local file; request remote
    expect(
      (
        await httpRequest(
          app,
          "GET",
          `/api/client/p/token-v1/media?url=${encodeURIComponent("https://cdn.example/remote.jpg")}`,
        )
      ).status,
    ).toBe(404);
  });

  it("PDF helper routes cross-origin photos through client /media (local same-origin stays path)", async () => {
    const { resolvePdfFetchUrl } = await import("../src/lib/pdfImageHelpers.js");
    const cross = resolvePdfFetchUrl("https://cdn.example.com/item.jpg", { clientToken: "tok" });
    expect(cross).toContain("/api/client/p/tok/media");
    expect(cross).toContain(encodeURIComponent("https://cdn.example.com/item.jpg"));
    // Backend /media still blocks remote; helper only builds the URL.
    expect(
      (
        await httpRequest(
          clientApp(),
          "GET",
          `/api/client/p/token-v1/media?url=${encodeURIComponent("https://cdn.example.com/item.jpg")}`,
        )
      ).status,
    ).toBe(404);
  });
});
