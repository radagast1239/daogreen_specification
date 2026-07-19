import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const express = require("../backend/node_modules/express");

const tempDir = path.join(os.tmpdir(), `daogreen-revision-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const tempDbPath = path.join(tempDir, "revision.db");
let db;
let initDb;
let loadProject;
let updateProject;
let createProject;
let projectsApi;
let clientRouter;
let server;
let baseUrl;

function seedPublished() {
  const item = {
    id: "old",
    materialId: null,
    module: "general",
    name: "Old item",
    unit: "шт.",
    category: "Прочее",
    qty: 1,
    price: 10,
    status: "not_bought",
    visibleToClient: true,
    enabled: true,
    includedInProject: true,
    itemType: "material",
  };
  db.prepare("INSERT INTO projects (id, name, client_token, manual_params, status) VALUES ('p1', 'Before', 'token-p1', ?, 'active')").run(
    JSON.stringify({
      publishedRelease: {
        versionId: "v1",
        versionNumber: 1,
        publishedAt: "2026-01-01T00:00:00.000Z",
        workflowStatus: "ready_to_send",
      },
      coolingFarm: { safetyFactor: 1.2 },
    })
  );
  db.prepare(`INSERT INTO project_items (id, project_id, material_id, module, name, unit, category, qty, price, status, visible_to_client, enabled, included_in_project, item_type)
    VALUES ('old', 'p1', NULL, 'general', 'Old item', 'шт.', 'Прочее', 1, 10, 'not_bought', 1, 1, 1, 'material')`).run();
  db.prepare(`INSERT INTO spec_versions (id, project_id, version_number, created_by, summary, snapshot)
    VALUES ('v1', 'p1', 1, 'admin', '{}', ?)`).run(JSON.stringify([item]));
}

function snapshot() {
  return {
    project: db.prepare("SELECT name, status, manual_params, stellage_configs, version, revision, client_token FROM projects WHERE id = 'p1'").get(),
    items: db.prepare("SELECT id, qty, price, status, replacement_link FROM project_items WHERE project_id = 'p1' ORDER BY id").all(),
    versions: db.prepare("SELECT id, version_number FROM spec_versions WHERE project_id = 'p1' ORDER BY version_number").all(),
  };
}

async function admin(method, urlPath, body) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function client(method, urlPath, body) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Client-Token": "token-p1",
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

beforeAll(async () => {
  fs.mkdirSync(tempDir, { recursive: true });
  process.env.DATABASE_PATH = tempDbPath;
  process.env.DB_PATH = tempDbPath;
  process.env.NODE_ENV = "test";
  vi.resetModules();
  const dbMod = await import("../backend/src/db.js");
  const activityMod = await import("../backend/src/services/activityLog.js");
  const projectsMod = await import("../backend/src/routes/projects.js");
  db = dbMod.db;
  initDb = dbMod.initDb;
  loadProject = dbMod.loadProject;
  updateProject = projectsMod.updateProject;
  createProject = projectsMod.createProject;
  projectsApi = projectsMod.default;
  clientRouter = projectsMod.clientRouter;
  initDb();
  activityMod.initActivityLog();

  const app = express();
  app.use(express.json());
  app.use("/api/projects", projectsApi);
  app.use("/api/client", clientRouter);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  db.prepare("DELETE FROM project_activity").run();
  db.prepare("DELETE FROM spec_versions").run();
  db.prepare("DELETE FROM project_items").run();
  db.prepare("DELETE FROM projects").run();
  seedPublished();
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  try { db.close(); } catch { /* already closed */ }
  delete process.env.DATABASE_PATH;
  delete process.env.DB_PATH;
  vi.resetModules();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${tempDbPath}${suffix}`, { force: true });
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("optimistic project revision", () => {
  it("assigns revision to existing and newly created projects and exposes it from load", () => {
    expect(loadProject("p1").revision).toBe(1);
    const created = createProject({ name: "New", items: [] });
    expect(created.revision).toBe(1);
  });

  it("increments exactly once for a successful full PATCH", () => {
    const saved = updateProject("p1", { expectedRevision: 1, name: "After", manualParams: { cooling: 1 } });
    expect(saved).toMatchObject({ name: "After", revision: 2 });
  });

  it("rejects a stale tab and leaves project, items, release and spec_versions unchanged", () => {
    const tabA = loadProject("p1").revision;
    const tabB = tabA;
    updateProject("p1", { expectedRevision: tabA, name: "Saved by A" });
    const beforeConflict = snapshot();
    expect(() => updateProject("p1", {
      expectedRevision: tabB,
      name: "Stale B",
      status: "ready_to_send",
      manualParams: { farmPower: { devices: [{ id: "x", name: "Pump", normalKw: 3 }] } },
      stellageConfigs: [{ id: "rack-stale" }],
      items: [{ id: "new", materialId: null, module: "general", name: "New", unit: "шт.", category: "Прочее", qty: 2, price: 20 }],
    })).toThrowError(expect.objectContaining({
      code: "PROJECT_REVISION_CONFLICT",
      expectedRevision: 1,
      currentRevision: 2,
    }));
    expect(snapshot()).toEqual(beforeConflict);
  });

  it("rolls back data and revision when atomic item save fails", () => {
    const before = snapshot();
    expect(() => updateProject("p1", {
      expectedRevision: 1,
      name: "Must rollback",
      items: [
        { id: "dup", materialId: null, module: "general", name: "A", unit: "шт.", category: "Прочее", qty: 1, price: 1 },
        { id: "dup", materialId: null, module: "general", name: "B", unit: "шт.", category: "Прочее", qty: 1, price: 1 },
      ],
    })).toThrow();
    expect(snapshot()).toEqual(before);
  });

  it("succeeds after reload with the current revision", () => {
    updateProject("p1", { expectedRevision: 1, name: "First" });
    expect(() => updateProject("p1", { expectedRevision: 1, name: "Stale" })).toThrow();
    const reloaded = loadProject("p1");
    expect(updateProject("p1", { expectedRevision: reloaded.revision, name: "After reload" })).toMatchObject({ revision: 3, name: "After reload" });
  });

  it("protects status, farmPower, schemes and requires expectedRevision", async () => {
    const missing = await admin("PATCH", "/api/projects/p1", { name: "No revision" });
    expect(missing.status).toBe(400);
    expect(missing.data.error?.code || missing.data.code).toBe("EXPECTED_REVISION_REQUIRED");

    const ok = await admin("PATCH", "/api/projects/p1", {
      expectedRevision: 1,
      status: "in_progress",
      manualParams: {
        farmPower: { devices: [{ id: "d1", name: "Pump", normalKw: 2 }] },
        projectSchemes: [{ id: "sch1", title: "Plan", url: "https://example.test/a.png" }],
      },
    });
    expect(ok.status).toBe(200);
    expect(ok.data.revision).toBe(2);

    const stale = await admin("PATCH", "/api/projects/p1", {
      expectedRevision: 1,
      status: "archived",
      manualParams: { farmPower: { devices: [] } },
    });
    expect(stale.status).toBe(409);
    expect(stale.data.error).toMatchObject({
      code: "PROJECT_REVISION_CONFLICT",
      expectedRevision: 1,
      currentRevision: 2,
      projectId: "p1",
    });
    expect(loadProject("p1")).toMatchObject({ status: "in_progress", revision: 2 });
  });

  it("protects archive, restore and token regenerate", async () => {
    const beforeToken = loadProject("p1").clientToken;
    const archived = await admin("POST", "/api/projects/p1/archive", { expectedRevision: 1 });
    expect(archived.status).toBe(200);
    expect(archived.data.revision).toBe(2);
    expect(loadProject("p1").status).toBe("archived");

    const staleRestore = await admin("POST", "/api/projects/p1/restore", { expectedRevision: 1 });
    expect(staleRestore.status).toBe(409);
    expect(loadProject("p1").status).toBe("archived");

    const restored = await admin("POST", "/api/projects/p1/restore", { expectedRevision: 2 });
    expect(restored.status).toBe(200);
    expect(restored.data.revision).toBe(3);

    const token = await admin("POST", "/api/projects/p1/regenerate-token", { expectedRevision: 3 });
    expect(token.status).toBe(200);
    expect(token.data.revision).toBe(4);
    expect(token.data.clientToken).toBeTruthy();
    expect(token.data.clientToken).not.toBe(beforeToken);
  });

  it("protects item patch, refresh, replacement review and standalone item save contract", async () => {
    const patched = await admin("PATCH", "/api/projects/p1/items/old", { expectedRevision: 1, qty: 5 });
    expect(patched.status).toBe(200);
    expect(patched.data.revision).toBe(2);
    expect(patched.data.qty).toBe(5);

    const before = snapshot();
    const stale = await admin("POST", "/api/projects/p1/items/refresh-from-material", {
      expectedRevision: 1,
      itemIds: ["old"],
      fields: ["price"],
    });
    expect(stale.status).toBe(409);
    expect(snapshot()).toEqual(before);

    db.prepare("UPDATE project_items SET status = 'replacement_check', replacement_link = 'https://example.test/r' WHERE id = 'old'").run();
    const reviewStale = await admin("POST", "/api/projects/p1/items/old/replacement-review", {
      expectedRevision: 1,
      action: "reject",
    });
    expect(reviewStale.status).toBe(409);
    expect(db.prepare("SELECT status FROM project_items WHERE id = 'old'").get().status).toBe("replacement_check");

    const reviewOk = await admin("POST", "/api/projects/p1/items/old/replacement-review", {
      expectedRevision: 2,
      action: "reject",
    });
    expect(reviewOk.status).toBe(200);
    expect(reviewOk.data.revision).toBe(3);
  });

  it("no-op refresh-from-material still enforces revision and never bumps it", async () => {
    const staleNoOp = await admin("POST", "/api/projects/p1/items/refresh-from-material", {
      expectedRevision: 2,
      itemIds: ["old"],
      fields: ["price"],
    });
    expect(staleNoOp.status).toBe(409);
    expect(loadProject("p1").revision).toBe(1);

    const okNoOp = await admin("POST", "/api/projects/p1/items/refresh-from-material", {
      expectedRevision: 1,
      itemIds: ["old"],
      fields: ["price"],
    });
    expect(okNoOp.status).toBe(200);
    expect(okNoOp.data.revision).toBe(1);
    expect(loadProject("p1").revision).toBe(1);
  });

  it("real refresh-from-material enforces revision and bumps it exactly once", async () => {
    db.prepare("INSERT INTO materials (id, name, unit, base_price, module) VALUES ('mat1', 'Material One', 'шт.', 20, 'general')").run();
    db.prepare(`INSERT INTO project_items (id, project_id, material_id, module, name, unit, category, qty, price, status, visible_to_client, enabled, included_in_project, item_type)
      VALUES ('mitem', 'p1', 'mat1', 'general', 'Mat item', 'шт.', 'Прочее', 1, 5, 'not_bought', 1, 1, 1, 'material')`).run();

    const stale = await admin("POST", "/api/projects/p1/items/refresh-from-material", {
      expectedRevision: 2,
      itemIds: ["mitem"],
      fields: ["price"],
    });
    expect(stale.status).toBe(409);
    expect(db.prepare("SELECT price FROM project_items WHERE id = 'mitem'").get().price).toBe(5);
    expect(loadProject("p1").revision).toBe(1);

    const ok = await admin("POST", "/api/projects/p1/items/refresh-from-material", {
      expectedRevision: 1,
      itemIds: ["mitem"],
      fields: ["price"],
    });
    expect(ok.status).toBe(200);
    expect(ok.data.revision).toBe(2);
    expect(db.prepare("SELECT price FROM project_items WHERE id = 'mitem'").get().price).toBe(20);
    expect(loadProject("p1").revision).toBe(2);
  });

  it("protects client purchase status, replacement and cooling write-paths", async () => {
    const bought = await client("PATCH", "/api/client/p/token-p1/items/old", {
      expectedRevision: 1,
      status: "bought",
    });
    expect(bought.status).toBe(200);
    expect(bought.data.revision).toBe(2);
    expect(bought.data.status).toBe("bought");

    const before = snapshot();
    const staleBulk = await client("PATCH", "/api/client/p/token-p1/items/bulk", {
      expectedRevision: 1,
      itemIds: ["old"],
      patch: { status: "ordered" },
    });
    expect(staleBulk.status).toBe(409);
    expect(staleBulk.data.error.code).toBe("PROJECT_REVISION_CONFLICT");
    expect(snapshot()).toEqual(before);

    const replacement = await client("POST", "/api/client/p/token-p1/items/old/propose-replacement", {
      expectedRevision: 2,
      link: "https://example.test/new",
      comment: "alt",
    });
    expect(replacement.status).toBe(200);
    expect(replacement.data.revision).toBe(3);
    expect(replacement.data.status).toBe("replacement_check");

    const coolStale = await client("PATCH", "/api/client/p/token-p1/cooling", {
      expectedRevision: 2,
      safetyFactor: 1.5,
    });
    expect(coolStale.status).toBe(409);
    const coolOk = await client("PATCH", "/api/client/p/token-p1/cooling", {
      expectedRevision: 3,
      safetyFactor: 1.5,
    });
    expect(coolOk.status).toBe(200);
    expect(coolOk.data.revision).toBe(4);
    expect(coolOk.data.manualParams.coolingFarm.safetyFactor).toBe(1.5);

    const clientGet = await client("GET", "/api/client/p/token-p1");
    expect(clientGet.status).toBe(200);
    expect(clientGet.data.revision).toBe(4);
  });
});
