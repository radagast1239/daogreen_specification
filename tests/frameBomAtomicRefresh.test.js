/**
 * Atomic Frame BOM refresh — temp SQLite integration tests (scenarios 1–14).
 * NODE_ENV=test enables artificial mid-txn throw hooks.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-fbom-atomic-${testId}`);
const tempDbPath = path.join(tempDir, "daogreen-test.db");

const RACK_A = "mod_protochka:st_rack_a";
const RACK_B = "mod_protochka:st_rack_b";
const STELLAGE_A = "st_rack_a";
const STELLAGE_B = "st_rack_b";
const DRAWING_A = "fd_draw_a";
const DRAWING_B = "fd_draw_b";

let db;
let initDb;
let loadProject;
let loadProjectItems;
let saveItemsWithin;
let refreshFrameBomProject;
let FrameBomRefreshError;
let assertSafeRemoveItemIds;
let initActivityLog;

function seedMaterial(id, name = "Material") {
  db.prepare(`
    INSERT INTO materials (id, name, unit, category, base_price, module,
                           supplier, link, photo_url, client_section, client_subsection)
    VALUES (?, ?, 'шт.', 'Каркас и крепёж', 10, 'general',
            'ООО Поставщик', 'https://example.test/x', 'https://example.test/p.jpg', 'Каркас', 'Профиль')
  `).run(id, name);
}

function seedProject(id = "p1", revision = 0) {
  db.prepare(`
    INSERT INTO projects (id, name, client_token, city, status, manual_params, revision)
    VALUES (?, 'Frame BOM project', ?, 'Москва', 'draft', '{}', ?)
  `).run(id, `token-${id}`, revision);
}

function seedDrawing({ id, projectId, title = "Чертёж", visible = 1 }) {
  db.prepare(`
    INSERT INTO frame_drawings (
      id, project_id, title, pdf_url, is_client_visible, module_rack_key
    ) VALUES (?, ?, ?, '/pdf/test.pdf', ?, ?)
  `).run(id, projectId, title, visible, RACK_A);
}

function canonItem({
  drawingId,
  moduleRackKey,
  stellageId,
  bomKey,
  materialId,
  qty,
  rackLabel = "Стеллаж",
  status = "not_bought",
  actualPrice = null,
  clientComment = "",
  visibleToClient = true,
}) {
  const id = `it_fbom_${drawingId}_${moduleRackKey.replace(/[^a-zA-Z0-9:_-]/g, "_")}_${bomKey}`;
  return {
    id,
    materialId,
    name: `BOM ${bomKey}`,
    unit: "шт.",
    qty,
    price: 10,
    module: rackLabel,
    section: rackLabel,
    category: "Каркас и крепёж",
    supplier: "ООО Поставщик",
    link: "https://example.test/x",
    source: "frame_bom",
    sourceType: "frame_bom",
    sourceKey: `frame_bom:${drawingId}:${moduleRackKey}:${bomKey}`,
    sourceObjectIds: {
      frameDrawingId: drawingId,
      drawingId,
      moduleRackKey,
      stellageId,
      bomKey,
    },
    clientNote: "Из схемы стеллажа",
    includedInProject: true,
    visibleToClient,
    visible: visibleToClient,
    approved: visibleToClient,
    enabled: true,
    itemType: "material",
    itemRole: "purchase",
    status,
    actualPrice,
    clientComment,
    sortOrder: 1,
  };
}

function draftLine({ key, materialId, qty, name }) {
  return {
    key,
    materialId,
    name: name || `BOM ${key}`,
    unit: "шт.",
    qty,
    price: 10,
    supplier: "ООО Поставщик",
    link: "https://example.test/x",
    photoUrl: "https://example.test/p.jpg",
  };
}

function refresh(projectId, body) {
  return refreshFrameBomProject(projectId, body, { saveItemsWithin });
}

function revisionOf(projectId = "p1") {
  return Number(db.prepare("SELECT COALESCE(revision, 0) AS r FROM projects WHERE id = ?").get(projectId).r);
}

beforeAll(async () => {
  fs.mkdirSync(tempDir, { recursive: true });
  process.env.DATABASE_PATH = tempDbPath;
  process.env.DB_PATH = tempDbPath;
  process.env.NODE_ENV = "test";
  vi.resetModules();

  const dbMod = await import("../backend/src/db.js");
  const projectsMod = await import("../backend/src/routes/projects.js");
  const refreshMod = await import("../backend/src/services/frameBomRefresh.js");
  const activityMod = await import("../backend/src/services/activityLog.js");

  db = dbMod.db;
  initDb = dbMod.initDb;
  loadProject = dbMod.loadProject;
  loadProjectItems = dbMod.loadProjectItems;
  saveItemsWithin = projectsMod.saveItemsWithin;
  refreshFrameBomProject = refreshMod.refreshFrameBomProject;
  FrameBomRefreshError = refreshMod.FrameBomRefreshError;
  assertSafeRemoveItemIds = refreshMod.assertSafeRemoveItemIds;
  initActivityLog = activityMod.initActivityLog;

  initDb();
  initActivityLog();
});

beforeEach(() => {
  db.prepare("DELETE FROM project_activity").run();
  db.prepare("DELETE FROM project_items").run();
  db.prepare("DELETE FROM frame_drawings").run();
  db.prepare("DELETE FROM materials").run();
  db.prepare("DELETE FROM projects").run();
  seedMaterial("m073", "Болт М6");
  seedMaterial("m072", "Краб G");
  seedProject("p1", 0);
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

describe("1. one rack replace", () => {
  it("replaces BOM qty for one rack and bumps revision", () => {
    const items = [
      canonItem({
        drawingId: DRAWING_A,
        moduleRackKey: RACK_A,
        stellageId: STELLAGE_A,
        bomKey: "bolt_m6x20",
        materialId: "m073",
        qty: 100,
        rackLabel: "Стеллаж A",
      }),
    ];
    saveItemsWithin("p1", items);

    const result = refresh("p1", {
      expectedRevision: 0,
      moduleRackKey: RACK_A,
      stellageId: STELLAGE_A,
      drawingId: DRAWING_A,
      rackLabel: "Стеллаж A",
      purchaseDraft: [draftLine({ key: "bolt_m6x20", materialId: "m073", qty: 250 })],
      mode: "full",
    });

    expect(result.revision).toBe(1);
    expect(revisionOf()).toBe(1);
    const after = loadProjectItems("p1");
    expect(after).toHaveLength(1);
    expect(after[0].qty).toBe(250);
    expect(after[0].source).toBe("frame_bom");
  });
});

describe("2–3. two racks isolated", () => {
  it("updating first identical rack does not change second", () => {
    const items = [
      canonItem({
        drawingId: DRAWING_A,
        moduleRackKey: RACK_A,
        stellageId: STELLAGE_A,
        bomKey: "bolt_m6x20",
        materialId: "m073",
        qty: 100,
        rackLabel: "Стеллаж A",
      }),
      canonItem({
        drawingId: DRAWING_B,
        moduleRackKey: RACK_B,
        stellageId: STELLAGE_B,
        bomKey: "bolt_m6x20",
        materialId: "m073",
        qty: 100,
        rackLabel: "Стеллаж B",
      }),
    ];
    saveItemsWithin("p1", items);

    refresh("p1", {
      expectedRevision: 0,
      moduleRackKey: RACK_A,
      stellageId: STELLAGE_A,
      drawingId: DRAWING_A,
      rackLabel: "Стеллаж A",
      purchaseDraft: [draftLine({ key: "bolt_m6x20", materialId: "m073", qty: 777 })],
    });

    const after = loadProjectItems("p1");
    const a = after.find((i) => String(i.sourceKey || "").includes(RACK_A));
    const b = after.find((i) => String(i.sourceKey || "").includes(RACK_B));
    expect(a.qty).toBe(777);
    expect(b.qty).toBe(100);
    expect(after).toHaveLength(2);
  });

  it("two racks same materialId stay isolated", () => {
    const items = [
      canonItem({
        drawingId: DRAWING_A,
        moduleRackKey: RACK_A,
        stellageId: STELLAGE_A,
        bomKey: "crab_g",
        materialId: "m072",
        qty: 10,
        rackLabel: "Стеллаж A",
      }),
      canonItem({
        drawingId: DRAWING_B,
        moduleRackKey: RACK_B,
        stellageId: STELLAGE_B,
        bomKey: "crab_g",
        materialId: "m072",
        qty: 20,
        rackLabel: "Стеллаж B",
      }),
    ];
    saveItemsWithin("p1", items);

    refresh("p1", {
      expectedRevision: 0,
      moduleRackKey: RACK_B,
      stellageId: STELLAGE_B,
      drawingId: DRAWING_B,
      rackLabel: "Стеллаж B",
      purchaseDraft: [draftLine({ key: "crab_g", materialId: "m072", qty: 99, name: "Краб G" })],
    });

    const after = loadProjectItems("p1");
    const a = after.find((i) => String(i.sourceKey || "").includes(RACK_A));
    const b = after.find((i) => String(i.sourceKey || "").includes(RACK_B));
    expect(a.qty).toBe(10);
    expect(b.qty).toBe(99);
  });
});

describe("4. manual row preserved", () => {
  it("keeps manual row with same materialId as BOM", () => {
    const items = [
      canonItem({
        drawingId: DRAWING_A,
        moduleRackKey: RACK_A,
        stellageId: STELLAGE_A,
        bomKey: "bolt_m6x20",
        materialId: "m073",
        qty: 50,
      }),
      {
        id: "manual_bolt",
        materialId: "m073",
        name: "Ручной болт",
        unit: "шт.",
        qty: 3,
        price: 1,
        module: "Прочее",
        section: "Прочее",
        category: "Прочее",
        source: "manual",
        sourceType: "manual",
        includedInProject: true,
        visibleToClient: true,
        enabled: true,
        itemType: "material",
        status: "not_bought",
        sortOrder: 2,
      },
    ];
    saveItemsWithin("p1", items);

    refresh("p1", {
      expectedRevision: 0,
      moduleRackKey: RACK_A,
      stellageId: STELLAGE_A,
      drawingId: DRAWING_A,
      purchaseDraft: [draftLine({ key: "bolt_m6x20", materialId: "m073", qty: 80 })],
    });

    const after = loadProjectItems("p1");
    expect(after.some((i) => i.id === "manual_bolt" && i.qty === 3)).toBe(true);
    expect(after.filter((i) => i.materialId === "m073" && i.source === "frame_bom")).toHaveLength(1);
    expect(after.find((i) => i.source === "frame_bom").qty).toBe(80);
  });
});

describe("5. repeat refresh no dupes", () => {
  it("second refresh with same draft does not duplicate lines", () => {
    const items = [
      canonItem({
        drawingId: DRAWING_A,
        moduleRackKey: RACK_A,
        stellageId: STELLAGE_A,
        bomKey: "bolt_m6x20",
        materialId: "m073",
        qty: 10,
      }),
    ];
    saveItemsWithin("p1", items);
    const draft = [draftLine({ key: "bolt_m6x20", materialId: "m073", qty: 12 })];

    refresh("p1", {
      expectedRevision: 0,
      moduleRackKey: RACK_A,
      stellageId: STELLAGE_A,
      drawingId: DRAWING_A,
      purchaseDraft: draft,
    });
    refresh("p1", {
      expectedRevision: 1,
      moduleRackKey: RACK_A,
      stellageId: STELLAGE_A,
      drawingId: DRAWING_A,
      purchaseDraft: draft,
    });

    const after = loadProjectItems("p1");
    expect(after.filter((i) => i.materialId === "m073")).toHaveLength(1);
    expect(after[0].qty).toBe(12);
    expect(revisionOf()).toBe(2);
  });
});

describe("6. __testThrowAfterItems rolls back", () => {
  it("keeps old items and revision when mid-txn throw", () => {
    const items = [
      canonItem({
        drawingId: DRAWING_A,
        moduleRackKey: RACK_A,
        stellageId: STELLAGE_A,
        bomKey: "bolt_m6x20",
        materialId: "m073",
        qty: 42,
      }),
    ];
    saveItemsWithin("p1", items);
    const beforeIds = loadProjectItems("p1").map((i) => i.id);
    const beforeRev = revisionOf();

    expect(() =>
      refresh("p1", {
        expectedRevision: 0,
        moduleRackKey: RACK_A,
        stellageId: STELLAGE_A,
        drawingId: DRAWING_A,
        purchaseDraft: [draftLine({ key: "bolt_m6x20", materialId: "m073", qty: 999 })],
        __testThrowAfterItems: true,
      }),
    ).toThrow(/artificial mid-transaction failure/);

    expect(revisionOf()).toBe(beforeRev);
    const after = loadProjectItems("p1");
    expect(after.map((i) => i.id)).toEqual(beforeIds);
    expect(after[0].qty).toBe(42);
  });
});

describe("7. revision conflict", () => {
  it("rejects stale expectedRevision without changing items", () => {
    const items = [
      canonItem({
        drawingId: DRAWING_A,
        moduleRackKey: RACK_A,
        stellageId: STELLAGE_A,
        bomKey: "bolt_m6x20",
        materialId: "m073",
        qty: 5,
      }),
    ];
    saveItemsWithin("p1", items);
    db.prepare("UPDATE projects SET revision = 3 WHERE id = ?").run("p1");

    try {
      refresh("p1", {
        expectedRevision: 0,
        moduleRackKey: RACK_A,
        stellageId: STELLAGE_A,
        drawingId: DRAWING_A,
        purchaseDraft: [draftLine({ key: "bolt_m6x20", materialId: "m073", qty: 50 })],
      });
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(FrameBomRefreshError);
      expect(e.code).toBe("PROJECT_REVISION_CONFLICT");
      expect(e.status).toBe(409);
    }

    expect(revisionOf()).toBe(3);
    expect(loadProjectItems("p1")[0].qty).toBe(5);
  });
});

describe("8. unsafe delete / fail closed", () => {
  it("missing material blocks refresh (fail closed)", () => {
    saveItemsWithin("p1", [
      canonItem({
        drawingId: DRAWING_A,
        moduleRackKey: RACK_A,
        stellageId: STELLAGE_A,
        bomKey: "bolt_m6x20",
        materialId: "m073",
        qty: 5,
      }),
    ]);

    try {
      refresh("p1", {
        expectedRevision: 0,
        moduleRackKey: RACK_A,
        stellageId: STELLAGE_A,
        drawingId: DRAWING_A,
        purchaseDraft: [draftLine({ key: "bolt_m6x20", materialId: "missing_xyz", qty: 1 })],
      });
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(FrameBomRefreshError);
      expect(e.code).toBe("FRAME_BOM_REFRESH_INVALID");
    }
    expect(loadProjectItems("p1")[0].qty).toBe(5);
    expect(revisionOf()).toBe(0);
  });

  it("assertSafeRemoveItemIds refuses manual and foreign-rack deletes", () => {
    const items = [
      canonItem({
        drawingId: DRAWING_A,
        moduleRackKey: RACK_A,
        stellageId: STELLAGE_A,
        bomKey: "bolt_m6x20",
        materialId: "m073",
        qty: 5,
      }),
      canonItem({
        drawingId: DRAWING_B,
        moduleRackKey: RACK_B,
        stellageId: STELLAGE_B,
        bomKey: "bolt_m6x20",
        materialId: "m073",
        qty: 5,
        rackLabel: "Стеллаж B",
      }),
      {
        id: "manual_keep",
        materialId: "m073",
        name: "Manual",
        unit: "шт.",
        qty: 1,
        price: 0,
        module: "X",
        section: "X",
        category: "Прочее",
        source: "manual",
        includedInProject: true,
        visibleToClient: true,
        enabled: true,
        itemType: "material",
        status: "not_bought",
      },
      {
        id: "ordinary_rack",
        materialId: "m072",
        name: "Обычная позиция",
        unit: "шт.",
        qty: 2,
        price: 40,
        module: "Стеллаж A",
        section: "Стеллаж A",
        category: "Прочее",
        source: "",
        sourceObjectIds: { moduleRackKey: RACK_A, stellageId: STELLAGE_A },
        includedInProject: true,
        visibleToClient: true,
        enabled: true,
        itemType: "material",
        status: "not_bought",
      },
    ];
    const opts = { moduleRackKey: RACK_A, stellageId: STELLAGE_A, allItems: items, existingItems: items };

    expect(() => assertSafeRemoveItemIds(["manual_keep"], items, RACK_A, opts)).toThrow(
      /ручную позицию/i,
    );
    try {
      assertSafeRemoveItemIds(["manual_keep"], items, RACK_A, opts);
    } catch (e) {
      expect(e.code).toBe("FRAME_BOM_REFRESH_UNSAFE_DELETE");
    }

    const foreignId = items.find((i) => String(i.sourceKey || "").includes(RACK_B)).id;
    expect(() => assertSafeRemoveItemIds([foreignId], items, RACK_A, opts)).toThrow(
      /другого стеллажа/i,
    );

    expect(() => assertSafeRemoveItemIds(["ordinary_rack"], items, RACK_A, opts)).toThrow(
      /вне BOM каркаса/i,
    );

    expect(() => assertSafeRemoveItemIds(["unknown_id"], items, RACK_A, opts)).toThrow(
      /неизвестную позицию/i,
    );
  });
});

describe("9. drawing meta failure rolls back BOM", () => {
  it("__testThrowAfterDrawingMeta rolls back items and revision", () => {
    seedDrawing({ id: DRAWING_A, projectId: "p1", title: "Old title", visible: 1 });
    saveItemsWithin("p1", [
      canonItem({
        drawingId: DRAWING_A,
        moduleRackKey: RACK_A,
        stellageId: STELLAGE_A,
        bomKey: "bolt_m6x20",
        materialId: "m073",
        qty: 11,
      }),
    ]);

    expect(() =>
      refresh("p1", {
        expectedRevision: 0,
        moduleRackKey: RACK_A,
        stellageId: STELLAGE_A,
        drawingId: DRAWING_A,
        purchaseDraft: [draftLine({ key: "bolt_m6x20", materialId: "m073", qty: 88 })],
        drawingMeta: { title: "New title", isClientVisible: false },
        __testThrowAfterDrawingMeta: true,
      }),
    ).toThrow(/artificial drawing-meta failure/);

    expect(revisionOf()).toBe(0);
    expect(loadProjectItems("p1")[0].qty).toBe(11);
    const drawing = db.prepare("SELECT title, is_client_visible FROM frame_drawings WHERE id = ?").get(DRAWING_A);
    expect(drawing.title).toBe("Old title");
    expect(drawing.is_client_visible).toBe(1);
  });

  it("successful drawingMeta updates atomically with BOM", () => {
    seedDrawing({ id: DRAWING_A, projectId: "p1", title: "Old title", visible: 1 });
    saveItemsWithin("p1", [
      canonItem({
        drawingId: DRAWING_A,
        moduleRackKey: RACK_A,
        stellageId: STELLAGE_A,
        bomKey: "bolt_m6x20",
        materialId: "m073",
        qty: 11,
      }),
    ]);

    const result = refresh("p1", {
      expectedRevision: 0,
      moduleRackKey: RACK_A,
      stellageId: STELLAGE_A,
      drawingId: DRAWING_A,
      purchaseDraft: [draftLine({ key: "bolt_m6x20", materialId: "m073", qty: 33 })],
      drawingMeta: { title: "New title", isClientVisible: false },
    });

    expect(result.revision).toBe(1);
    expect(result.summary.drawingMetaUpdated).toBe(true);
    expect(loadProjectItems("p1")[0].qty).toBe(33);
    const drawing = db.prepare("SELECT title, is_client_visible FROM frame_drawings WHERE id = ?").get(DRAWING_A);
    expect(drawing.title).toBe("New title");
    expect(drawing.is_client_visible).toBe(0);
  });
});

describe("10. double request same revision", () => {
  it("one succeeds and the other conflicts", () => {
    saveItemsWithin("p1", [
      canonItem({
        drawingId: DRAWING_A,
        moduleRackKey: RACK_A,
        stellageId: STELLAGE_A,
        bomKey: "bolt_m6x20",
        materialId: "m073",
        qty: 1,
      }),
    ]);

    const body = {
      expectedRevision: 0,
      moduleRackKey: RACK_A,
      stellageId: STELLAGE_A,
      drawingId: DRAWING_A,
      purchaseDraft: [draftLine({ key: "bolt_m6x20", materialId: "m073", qty: 2 })],
    };

    const first = refresh("p1", body);
    expect(first.revision).toBe(1);

    try {
      refresh("p1", body);
      expect.fail("second should conflict");
    } catch (e) {
      expect(e.code).toBe("PROJECT_REVISION_CONFLICT");
    }

    expect(revisionOf()).toBe(1);
    expect(loadProjectItems("p1")[0].qty).toBe(2);
  });
});

describe("11. procurement overlay preserved", () => {
  it("keeps status/actualPrice/clientComment/visibility across refresh", () => {
    saveItemsWithin("p1", [
      canonItem({
        drawingId: DRAWING_A,
        moduleRackKey: RACK_A,
        stellageId: STELLAGE_A,
        bomKey: "bolt_m6x20",
        materialId: "m073",
        qty: 10,
        status: "ordered",
        actualPrice: 7.5,
        clientComment: "нужен сертификат",
        visibleToClient: false,
      }),
    ]);

    refresh("p1", {
      expectedRevision: 0,
      moduleRackKey: RACK_A,
      stellageId: STELLAGE_A,
      drawingId: DRAWING_A,
      purchaseDraft: [draftLine({ key: "bolt_m6x20", materialId: "m073", qty: 15 })],
    });

    const item = loadProjectItems("p1")[0];
    expect(item.qty).toBe(15);
    expect(item.status).toBe("ordered");
    expect(Number(item.actualPrice)).toBe(7.5);
    expect(item.clientComment).toBe("нужен сертификат");
    expect(item.visibleToClient).toBe(false);
  });
});

describe("extras: validation + revision column", () => {
  it("requires expectedRevision", () => {
    expect(() =>
      refresh("p1", {
        moduleRackKey: RACK_A,
        purchaseDraft: [draftLine({ key: "bolt_m6x20", materialId: "m073", qty: 1 })],
      }),
    ).toThrow(/expectedRevision/);
  });

  it("rowToProject exposes revision after initDb", () => {
    db.prepare("UPDATE projects SET revision = 5 WHERE id = ?").run("p1");
    const p = loadProject("p1");
    expect(p.revision).toBe(5);
  });
});
