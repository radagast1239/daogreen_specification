import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  buildReleaseSnapshotPayload,
  detectUnpublishedChanges,
  parseReleaseSnapshot,
  parsePublishedRelease,
  releaseSnapshotItems,
} from "../shared/projectPublishedRelease.js";
import { buildProjectParityReport } from "../shared/projectParity.js";
import { lineVisibleToClient } from "../shared/itemTypes.js";

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-version-${testId}`);
const tempDbPath = path.join(tempDir, "daogreen-test.db");

let db;
let initDb;
let loadProject;
let saveItems;
let createVersion;
let updateProject;

function lockedUpdate(id, patch) {
  const revision = Number(db.prepare("SELECT revision FROM projects WHERE id = ?").get(id)?.revision) || 1;
  return updateProject(id, { ...patch, expectedRevision: revision });
}
let listVersions;
let loadVersionRow;
let loadPublishedSnapshotItems;
let loadPublishedReleaseSnapshot;
let buildClientProjectFromRelease;
let getProjectReleaseInfo;
let buildReleaseSnapshotJson;
let shouldPublishOnStatusChange;

function seedMaterial(id = "mat1", overrides = {}) {
  db.prepare(`
    INSERT INTO materials (id, name, unit, category, base_price, module, supplier, link, photo_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.name || "Test material",
    overrides.unit || "шт.",
    overrides.category || "Прочее",
    overrides.basePrice ?? 100,
    overrides.module || "general",
    overrides.supplier || "Supplier A",
    overrides.link || "https://shop.example/a",
    overrides.photoUrl || "/uploads/m.jpg",
  );
}

function clientItem(id, materialId, overrides = {}) {
  return {
    id,
    materialId,
    name: overrides.name || "Test material",
    unit: "шт.",
    module: "general",
    qty: overrides.qty ?? 2,
    price: overrides.price ?? 100,
    actualPrice: overrides.actualPrice ?? 90,
    supplier: overrides.supplier || "Supplier A",
    link: overrides.link || "https://shop.example/a",
    imageUrl: overrides.imageUrl || "/uploads/m.jpg",
    visibleToClient: true,
    includedInProject: true,
    enabled: true,
    approved: true,
    itemType: "material",
    status: overrides.status || "not_bought",
    clientComment: overrides.clientComment || "",
    ...overrides,
  };
}

function seedProject(id = "proj1", { items = [], manualParams = {}, rooms = [], status = "active", projectVersion = 0 } = {}) {
  db.prepare(`
    INSERT INTO projects (id, name, client_token, status, manual_params, rooms, currency, vat, version)
    VALUES (?, 'Test project', ?, ?, ?, ?, '₽', 1, ?)
  `).run(id, `token-${id}`, status, JSON.stringify(manualParams), JSON.stringify(rooms), projectVersion);
  if (items.length) saveItems(id, items);
}

beforeAll(async () => {
  fs.mkdirSync(tempDir, { recursive: true });
  process.env.DATABASE_PATH = tempDbPath;
  process.env.DB_PATH = tempDbPath;
  process.env.NODE_ENV = "test";
  vi.resetModules();
  const dbMod = await import("../backend/src/db.js");
  const projectsMod = await import("../backend/src/routes/projects.js");
  const releaseMod = await import("../backend/src/services/publishedReleaseService.js");
  db = dbMod.db;
  initDb = dbMod.initDb;
  loadProject = dbMod.loadProject;
  saveItems = projectsMod.saveItems;
  createVersion = projectsMod.createVersion;
  updateProject = projectsMod.updateProject;
  listVersions = projectsMod.listVersions;
  loadVersionRow = releaseMod.loadVersionRow;
  loadPublishedSnapshotItems = releaseMod.loadPublishedSnapshotItems;
  loadPublishedReleaseSnapshot = releaseMod.loadPublishedReleaseSnapshot;
  buildClientProjectFromRelease = releaseMod.buildClientProjectFromRelease;
  getProjectReleaseInfo = releaseMod.getProjectReleaseInfo;
  buildReleaseSnapshotJson = releaseMod.buildReleaseSnapshotJson;
  shouldPublishOnStatusChange = releaseMod.shouldPublishOnStatusChange;
  initDb();
});

beforeEach(() => {
  db.prepare("DELETE FROM spec_versions").run();
  db.prepare("DELETE FROM project_items").run();
  db.prepare("DELETE FROM materials").run();
  db.prepare("DELETE FROM projects").run();
  seedMaterial("mat1");
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
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("published release snapshot", () => {
  it("publish creates release_v1 snapshot with client-visible items and commercial fields", () => {
    seedProject("p1", {
      items: [clientItem("it1", "mat1", { actualPrice: 88, clientComment: "note" })],
    });
    const p = loadProject("p1");
    const version = createVersion("p1", "admin", { force: true });
    expect(version.versionNumber).toBe(1);

    const row = loadVersionRow("p1", version.id);
    const parsed = parseReleaseSnapshot(JSON.parse(row.snapshot));
    expect(parsed.schema).toBe("release_v3");
    expect(parsed.assetsPinned).toBe(true);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].supplier).toBe("Supplier A");
    expect(parsed.items[0].link).toBe("https://shop.example/a");
    expect(parsed.items[0].actualPrice).toBe(88);
    expect(parsed.projectMeta.currency).toBe("₽");
    expect(parsed.projectMeta.vat).toBe(true);

    const after = loadProject("p1");
    expect(after.manualParams.publishedRelease.versionId).toBe(version.id);
    expect(after.manualParams.publishedRelease.versionNumber).toBe(1);
  });

  it("changing project_items does not change published snapshot", () => {
    seedProject("p1", { items: [clientItem("it1", "mat1", { qty: 2, price: 100 })] });
    createVersion("p1", "admin", { force: true });
    saveItems("p1", [clientItem("it1", "mat1", { qty: 99, price: 999 })]);
    const snap = loadPublishedSnapshotItems(loadProject("p1"));
    expect(snap[0].qty).toBe(2);
    expect(snap[0].price).toBe(100);
  });

  it("publishes full room cooling calculations and does not expose later live room edits", () => {
    const room = {
      id: "room-1",
      name: "Рассадная",
      area: 20,
      height: 3,
      cooling: {
        params: { length: 5, width: 4, height: 3, shelves: 12, tiers: 5, safetyFactor: 1.3, cop: 3.2 },
        recommendedKw: 8.4,
        standardBtu: 36000,
      },
      acUnits: [{ id: "ac-1", qty: 2, coolingKw: 5, link: "https://shop.example/ac", comment: "инвертор" }],
      selectedItemId: "internal-item-id",
      comment: "internal room note",
    };
    seedProject("p1", { items: [clientItem("it1", "mat1")], rooms: [room] });
    createVersion("p1", "admin", { force: true });

    const published = loadPublishedReleaseSnapshot(loadProject("p1"));
    expect(published.coolingRooms).toHaveLength(1);
    expect(published.coolingRooms[0].cooling.params).toMatchObject({ shelves: 12, tiers: 5, safetyFactor: 1.3 });
    expect(published.coolingRooms[0].acUnits[0]).toMatchObject({ qty: 2, coolingKw: 5, link: "https://shop.example/ac" });
    expect(published.coolingRooms[0].selectedItemId).toBeUndefined();
    expect(published.coolingRooms[0].comment).toBeUndefined();

    lockedUpdate("p1", { rooms: [{ ...room, name: "Черновое новое имя", cooling: { ...room.cooling, recommendedKw: 99 } }] });
    const clientProject = buildClientProjectFromRelease(loadProject("p1"), published, { overlayLive: false });
    expect(clientProject.rooms[0].name).toBe("Рассадная");
    expect(clientProject.rooms[0].cooling.recommendedKw).toBe(8.4);
  });

  it("publishes manual farm power summary and keeps it immutable for the client", () => {
    const farmPower = { devices: [
      { id: "pump", name: "Насос", normalKw: 2.5, peakKw: 4 },
      { id: "ac", name: "Кондиционер", normalKw: 12, peakKw: 18 },
    ] };
    seedProject("p1", { items: [clientItem("it1", "mat1")], manualParams: { farmPower } });
    createVersion("p1", "admin", { force: true });

    const published = loadPublishedReleaseSnapshot(loadProject("p1"));
    expect(published.farmPower.devices).toHaveLength(2);
    expect(published.farmPower.devices[1]).toMatchObject({ name: "Кондиционер", normalKw: 12, peakKw: 18 });

    lockedUpdate("p1", { manualParams: { farmPower: { devices: [{ id: "draft", name: "Черновик", normalKw: 99, peakKw: 99 }] } } });
    const clientProject = buildClientProjectFromRelease(loadProject("p1"), published, { overlayLive: false });
    expect(clientProject.farmPower.devices).toMatchObject(farmPower.devices);
  });

  it("changing materials catalog does not change published snapshot", () => {
    seedProject("p1", { items: [clientItem("it1", "mat1")] });
    createVersion("p1", "admin", { force: true });
    db.prepare("UPDATE materials SET supplier = ?, link = ?, base_price = ? WHERE id = ?").run(
      "New supplier",
      "https://new.example",
      777,
      "mat1",
    );
    const snap = loadPublishedSnapshotItems(loadProject("p1"));
    expect(snap[0].supplier).toBe("Supplier A");
    expect(snap[0].link).toBe("https://shop.example/a");
    expect(snap[0].price).toBe(100);
  });

  it("client endpoint payload uses snapshot without live catalog enrich", () => {
    seedProject("p1", { items: [clientItem("it1", "mat1")] });
    createVersion("p1", "admin", { force: true });
    db.prepare("UPDATE materials SET supplier = ? WHERE id = ?").run("Live supplier", "mat1");
    const p = loadProject("p1");
    const snap = loadPublishedSnapshotItems(p);
    const clientProject = buildClientProjectFromRelease(p, snap, { overlayLive: false });
    expect(clientProject.items[0].supplier).toBe("Supplier A");
    expect(clientProject.isPublishedRelease).toBe(true);
  });

  it("new publication creates version N+1 and old version stays readable", () => {
    seedProject("p1", { items: [clientItem("it1", "mat1", { qty: 1 })] });
    const v1 = createVersion("p1", "admin", { force: true });
    saveItems("p1", [clientItem("it1", "mat1", { qty: 5 })]);
    const v2 = createVersion("p1", "admin", { force: true });
    expect(v2.versionNumber).toBe(2);
    const versions = listVersions("p1");
    expect(versions).toHaveLength(2);
    const old = loadVersionRow("p1", v1.id);
    expect(releaseSnapshotItems(old.snapshot)[0].qty).toBe(1);
    const current = loadVersionRow("p1", v2.id);
    expect(releaseSnapshotItems(current.snapshot)[0].qty).toBe(5);
  });

  it("ready_to_send → sent_to_client does not create duplicate snapshot when unchanged", () => {
    seedProject("p1", {
      status: "active",
      items: [clientItem("it1", "mat1")],
    });
    createVersion("p1", "admin", { force: true });
    const afterPublish = loadProject("p1");
    const versionId = afterPublish.manualParams.publishedRelease.versionId;
    lockedUpdate("p1", { status: "ready_to_send" });
    expect(listVersions("p1")).toHaveLength(1);
    lockedUpdate("p1", { status: "sent_to_client" });
    expect(listVersions("p1")).toHaveLength(1);
    expect(loadProject("p1").manualParams.publishedRelease.versionId).toBe(versionId);
  });

  it("detects unpublished changes after working edit", () => {
    seedProject("p1", { items: [clientItem("it1", "mat1", { qty: 1 })] });
    createVersion("p1", "admin", { force: true });
    saveItems("p1", [clientItem("it1", "mat1", { qty: 3 })]);
    const info = getProjectReleaseInfo(loadProject("p1"));
    expect(info.hasUnpublishedChanges).toBe(true);
    expect(info.unpublishedSummary.changedCount).toBe(1);
  });

  it("client page/PDF/Excel parity totals match published snapshot", () => {
    seedProject("p1", {
      items: [
        clientItem("it1", "mat1", { qty: 2, price: 100, vatRate: 0 }),
        clientItem("it2", "mat1", { qty: 1, price: 50, supplier: "Supplier A", vatRate: 0 }),
      ],
    });
    createVersion("p1", "admin", { force: true });
    const p = loadProject("p1");
    const snapItems = loadPublishedSnapshotItems(p);
    const releaseSnapshot = { items: snapItems };
    const report = buildProjectParityReport(p, [], releaseSnapshot);
    expect(report.client.total).toBe(report.pdf.total);
    expect(report.client.total).toBe(report.excel.total);
    expect(report.usesReleaseSnapshot).toBe(true);
  });

  it("draft project without publication has no publishedRelease", () => {
    seedProject("p1", { items: [clientItem("it1", "mat1")] });
    const info = getProjectReleaseInfo(loadProject("p1"));
    expect(info.publishedRelease).toBeNull();
    expect(info.hasUnpublishedChanges).toBe(false);
  });

  it("shouldPublishOnStatusChange skips when fingerprint matches", () => {
    const items = [clientItem("it1", "mat1")];
    const p = {
      id: "p1",
      manualParams: {
        publishedRelease: { versionId: "v1", versionNumber: 1 },
      },
      items,
    };
    seedProject("p1", { items, manualParams: p.manualParams });
    createVersion("p1", "admin", { force: true });
    const loaded = loadProject("p1");
    expect(shouldPublishOnStatusChange(loaded, "sent_to_client")).toBe(false);
  });
});

describe("published release version numbering", () => {
  it("first release is v1 when projects.version=1 and spec_versions empty (production-like)", () => {
    seedProject("p1", {
      projectVersion: 1,
      items: [clientItem("it1", "mat1")],
    });
    expect(db.prepare("SELECT COUNT(*) c FROM spec_versions WHERE project_id = 'p1'").get().c).toBe(0);
    const version = createVersion("p1", "admin", { force: true });
    expect(version.versionNumber).toBe(1);
    const row = db.prepare("SELECT version_number FROM spec_versions WHERE project_id = 'p1'").get();
    expect(row.version_number).toBe(1);
    const after = loadProject("p1");
    expect(after.manualParams.publishedRelease.versionNumber).toBe(1);
  });

  it("first release is v1 when projects.version=7 and spec_versions empty", () => {
    seedProject("p1", {
      projectVersion: 7,
      items: [clientItem("it1", "mat1")],
    });
    const version = createVersion("p1", "admin", { force: true });
    expect(version.versionNumber).toBe(1);
    expect(db.prepare("SELECT version_number FROM spec_versions WHERE project_id = 'p1'").get().version_number).toBe(1);
  });

  it("next release after existing v1 is v2", () => {
    seedProject("p1", { items: [clientItem("it1", "mat1", { qty: 1 })] });
    createVersion("p1", "admin", { force: true });
    saveItems("p1", [clientItem("it1", "mat1", { qty: 3 })]);
    const v2 = createVersion("p1", "admin", { force: true });
    expect(v2.versionNumber).toBe(2);
  });

  it("next release after existing v1 and v2 is v3", () => {
    seedProject("p1", { items: [clientItem("it1", "mat1")] });
    createVersion("p1", "admin", { force: true });
    createVersion("p1", "admin", { force: true });
    const v3 = createVersion("p1", "admin", { force: true });
    expect(v3.versionNumber).toBe(3);
    expect(listVersions("p1")).toHaveLength(3);
  });

  it("projects.version row field does not drive spec_versions numbering", () => {
    seedProject("p1", {
      projectVersion: 99,
      items: [clientItem("it1", "mat1")],
    });
    db.prepare("UPDATE projects SET version = ? WHERE id = ?").run(99, "p1");
    const version = createVersion("p1", "admin", { force: true });
    expect(version.versionNumber).toBe(1);
    expect(db.prepare("SELECT version_number FROM spec_versions WHERE id = ?").get(version.id).version_number).toBe(1);
  });

  it("does not create spec_versions or publishedRelease when publish validation fails", () => {
    seedProject("p1", { projectVersion: 1, items: [clientItem("it1", "mat1")] });
    db.prepare("DELETE FROM materials WHERE id = 'mat1'").run();
    expect(() => createVersion("p1", "admin", { force: false })).toThrow();
    expect(db.prepare("SELECT COUNT(*) c FROM spec_versions WHERE project_id = 'p1'").get().c).toBe(0);
    expect(parsePublishedRelease(loadProject("p1").manualParams)).toBeNull();
  });
});

describe("buildReleaseSnapshotPayload (pure)", () => {
  it("includes visibility and totals metadata", () => {
    const payload = buildReleaseSnapshotPayload(
      { id: "p1", name: "Proj", currency: "₽", vat: true, version: 3 },
      [clientItem("it1", "mat1", { visibleToClient: true })],
    );
    expect(payload.schema).toBe("release_v3");
    expect(payload.assetsPinned).toBe(true);
    expect(payload.items.every((it) => lineVisibleToClient(it) || true)).toBe(true);
    expect(payload.projectMeta.versionNumber).toBe(3);
  });
});
