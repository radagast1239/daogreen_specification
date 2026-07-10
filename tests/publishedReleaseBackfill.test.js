import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  BACKFILL_ACTION,
  planPublishedReleaseBackfill,
  validateVersionSnapshot,
  snapshotSha256,
  verifyBackfillResults,
  isPublishedReleaseValid,
} from "../shared/publishedReleaseBackfill.js";

describe("publishedReleaseBackfill (pure)", () => {
  const snapshotItems = [
    { id: "it1", name: "Line", qty: 1, price: 100, visibleToClient: true, includedInProject: true, enabled: true },
  ];
  const snapshotJson = JSON.stringify({ schema: "release_v1", items: snapshotItems });
  const versionRow = { id: "v1", version_number: 1, created_at: "2026-01-01", snapshot: snapshotJson };

  it("valid publishedRelease → noop", () => {
    const plan = planPublishedReleaseBackfill({
      project: {
        clientToken: "tok",
        manualParams: { publishedRelease: { versionId: "v1", versionNumber: 1 } },
        items: snapshotItems,
      },
      versionRows: [versionRow],
    });
    expect(plan.action).toBe(BACKFILL_ACTION.NOOP);
  });

  it("latest valid snapshot → pointer backfill", () => {
    const plan = planPublishedReleaseBackfill({
      project: { clientToken: "tok", manualParams: {}, items: snapshotItems },
      versionRows: [versionRow],
    });
    expect(plan.action).toBe(BACKFILL_ACTION.POINTER_BACKFILL);
    expect(plan.versionId).toBe("v1");
  });

  it("no versions → create v1", () => {
    const plan = planPublishedReleaseBackfill({
      project: { clientToken: "tok", manualParams: {}, items: snapshotItems },
      versionRows: [],
    });
    expect(plan.action).toBe(BACKFILL_ACTION.CREATE_V1);
  });

  it("invalid snapshot → manual review", () => {
    const plan = planPublishedReleaseBackfill({
      project: { clientToken: "tok", manualParams: {}, items: snapshotItems },
      versionRows: [{ id: "v_bad", version_number: 1, snapshot: "[]" }],
    });
    expect(plan.action).toBe(BACKFILL_ACTION.MANUAL_REVIEW);
  });

  it("missing version row → blocked pointer", () => {
    const check = isPublishedReleaseValid(
      { versionId: "missing", versionNumber: 1 },
      null,
    );
    expect(check.valid).toBe(false);
  });

  it("dry-run verify helper flags manual review", () => {
    const v = verifyBackfillResults([
      { projectId: "p1", action: BACKFILL_ACTION.MANUAL_REVIEW },
    ]);
    expect(v.ok).toBe(false);
  });

  it("snapshot hash stable", () => {
    expect(snapshotSha256(snapshotJson)).toBe(snapshotSha256(snapshotJson));
  });

  it("validateVersionSnapshot rejects empty", () => {
    expect(validateVersionSnapshot({ id: "v", snapshot: "[]" }).valid).toBe(false);
  });
});

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-backfill-${testId}`);
const tempDbPath = path.join(tempDir, "daogreen-test.db");

let db;
let runPublishedReleaseBackfill;
let verifyAllClientProjects;

function seedMaterial(id = "mat1") {
  db.prepare(`
    INSERT INTO materials (id, name, unit, category, base_price, module)
    VALUES (?, 'Material', 'шт.', 'Прочее', 100, 'general')
  `).run(id);
}

function clientItem(id) {
  return {
    id,
    materialId: "mat1",
    name: "Line",
    unit: "шт.",
    module: "general",
    qty: 1,
    price: 100,
    visibleToClient: true,
    includedInProject: true,
    enabled: true,
    approved: true,
    itemType: "material",
    status: "not_bought",
    actualPrice: 90,
    clientComment: "c",
  };
}

function seedProject(id, { token = "tok1", items = null, manualParams = {}, projectVersion = 0 } = {}) {
  db.prepare(`
    INSERT INTO projects (id, name, client_token, status, manual_params, version)
    VALUES (?, 'Proj', ?, 'active', ?, ?)
  `).run(id, token, JSON.stringify(manualParams), projectVersion);
  const list = items || [clientItem("it1")];
  db.prepare(`
    INSERT INTO project_items (id, project_id, material_id, name, unit, module, section, qty, price, visible, approved, enabled, visible_to_client, included_in_project, item_type, status, actual_price, client_comment, sort_order)
    VALUES (@id, @project_id, @material_id, @name, @unit, @module, @module, @qty, @price, 1, 1, 1, 1, 1, @item_type, @status, @actual_price, @client_comment, 0)
  `).run({
    id: list[0].id,
    project_id: id,
    material_id: list[0].materialId,
    name: list[0].name,
    unit: list[0].unit,
    module: list[0].module,
    qty: list[0].qty,
    price: list[0].price,
    item_type: list[0].itemType,
    status: list[0].status,
    actual_price: list[0].actualPrice,
    client_comment: list[0].clientComment,
  });
}

function insertVersion(projectId, { id = "v1", versionNumber = 1, items = null } = {}) {
  const snapItems = items || [clientItem("it1")];
  const snapshot = JSON.stringify({ schema: "release_v1", items: snapItems });
  db.prepare(`
    INSERT INTO spec_versions (id, project_id, version_number, created_by, summary, snapshot)
    VALUES (?, ?, ?, 'test', '{}', ?)
  `).run(id, projectId, versionNumber, snapshot);
}

beforeAll(async () => {
  fs.mkdirSync(tempDir, { recursive: true });
  process.env.DATABASE_PATH = tempDbPath;
  process.env.DB_PATH = tempDbPath;
  process.env.NODE_ENV = "test";
  vi.resetModules();
  const dbMod = await import("../backend/src/db.js");
  const svc = await import("../backend/src/services/publishedReleaseBackfillService.js");
  db = dbMod.db;
  dbMod.initDb();
  runPublishedReleaseBackfill = svc.runPublishedReleaseBackfill;
  verifyAllClientProjects = svc.verifyAllClientProjects;
  seedMaterial();
});

beforeEach(() => {
  db.prepare("DELETE FROM spec_versions").run();
  db.prepare("DELETE FROM project_items").run();
  db.prepare("DELETE FROM projects").run();
});

afterAll(() => {
  delete process.env.DATABASE_PATH;
  delete process.env.DB_PATH;
  vi.resetModules();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(tempDbPath + suffix);
    } catch {
      /* ignore */
    }
  }
});

describe("publishedReleaseBackfill service", () => {
  it("dry-run does not write DB", () => {
    seedProject("p1");
    insertVersion("p1");
    const before = db.prepare("SELECT manual_params FROM projects WHERE id = 'p1'").get().manual_params;
    const result = runPublishedReleaseBackfill({ projectIds: ["p1"], dryRun: true });
    const after = db.prepare("SELECT manual_params FROM projects WHERE id = 'p1'").get().manual_params;
    expect(before).toBe(after);
    expect(result.reports[0].plan.action).toBe(BACKFILL_ACTION.POINTER_BACKFILL);
  });

  it("pointer backfill preserves project_items and token", () => {
    seedProject("p1", { token: "secret-token" });
    insertVersion("p1", { id: "v_ok", versionNumber: 3 });
    const itemsBefore = db.prepare("SELECT COUNT(*) c FROM project_items WHERE project_id = 'p1'").get().c;
    const result = runPublishedReleaseBackfill({ projectIds: ["p1"], dryRun: false });
    const row = db.prepare("SELECT client_token, manual_params FROM projects WHERE id = 'p1'").get();
    const mp = JSON.parse(row.manual_params);
    expect(row.client_token).toBe("secret-token");
    expect(mp.publishedRelease.versionId).toBe("v_ok");
    expect(db.prepare("SELECT COUNT(*) c FROM project_items WHERE project_id = 'p1'").get().c).toBe(itemsBefore);
    expect(result.ok).toBe(true);
  });

  it("create v1 when no versions", async () => {
    seedProject("p2");
    const result = runPublishedReleaseBackfill({ projectIds: ["p2"], dryRun: false });
    expect(result.reports[0].applied.action).toBe(BACKFILL_ACTION.CREATE_V1);
    expect(result.reports[0].after.publishedReleaseValid).toBe(true);
    expect(result.reports[0].after.publishedRelease.versionNumber).toBe(1);
    expect(db.prepare("SELECT version_number FROM spec_versions WHERE project_id = 'p2'").get().version_number).toBe(1);
  });

  it("create v1 when no versions and projects.version=1 (production-like)", () => {
    seedProject("p_prod", { projectVersion: 1 });
    const result = runPublishedReleaseBackfill({ projectIds: ["p_prod"], dryRun: false });
    expect(result.reports[0].applied.action).toBe(BACKFILL_ACTION.CREATE_V1);
    expect(result.reports[0].after.publishedRelease.versionNumber).toBe(1);
    expect(db.prepare("SELECT COUNT(*) c FROM spec_versions WHERE project_id = 'p_prod'").get().c).toBe(1);
    expect(db.prepare("SELECT version_number FROM spec_versions WHERE project_id = 'p_prod'").get().version_number).toBe(1);
    expect(verifyAllClientProjects().ok).toBe(true);
  });

  it("backfill idempotent after first v1 with projects.version=1", () => {
    seedProject("p_idem", { projectVersion: 1, token: "secret" });
    const first = runPublishedReleaseBackfill({ projectIds: ["p_idem"], dryRun: false });
    const versionId = first.reports[0].after.publishedRelease.versionId;
    const snapHash = first.reports[0].after.snapshotHash;
    const second = runPublishedReleaseBackfill({ projectIds: ["p_idem"], dryRun: false });
    expect(db.prepare("SELECT COUNT(*) c FROM spec_versions WHERE project_id = 'p_idem'").get().c).toBe(1);
    expect(second.reports[0].plan.action).toBe(BACKFILL_ACTION.NOOP);
    expect(second.reports[0].after.publishedRelease.versionId).toBe(versionId);
    expect(second.reports[0].after.snapshotHash).toBe(snapHash);
    expect(db.prepare("SELECT client_token FROM projects WHERE id = 'p_idem'").get().client_token).toBe("secret");
  });

  it("repeated apply idempotent when already published", async () => {
    seedProject("p3");
    insertVersion("p3", { id: "v3", versionNumber: 1 });
    runPublishedReleaseBackfill({ projectIds: ["p3"], dryRun: false });
    const mp1 = JSON.parse(db.prepare("SELECT manual_params FROM projects WHERE id = 'p3'").get().manual_params);
    runPublishedReleaseBackfill({ projectIds: ["p3"], dryRun: false });
    const mp2 = JSON.parse(db.prepare("SELECT manual_params FROM projects WHERE id = 'p3'").get().manual_params);
    expect(mp2.publishedRelease.versionId).toBe(mp1.publishedRelease.versionId);
  });

  it("verify detects broken pointer", async () => {
    seedProject("p4", {
      manualParams: { publishedRelease: { versionId: "ghost", versionNumber: 9 } },
    });
    const v = verifyAllClientProjects();
    expect(v.ok).toBe(false);
    expect(v.problems.length).toBeGreaterThan(0);
  });
});
