/**
 * ATOMIC PROJECT SAVE — полное сохранение проекта должно быть атомарным.
 *
 * Раньше lockedUpdate() коммитил стадии по отдельности:
 *   saveItems() (BEGIN/COMMIT) → publishReleaseIfNeeded() → UPDATE_PROJECT.run()
 * Падение на любой стадии после первой оставляло позиции заменёнными,
 * а metadata/статус/публикацию — несохранёнными.
 *
 * Тесты используют ВРЕМЕННУЮ SQLite (DATABASE_PATH), production-данные не трогаются.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-atomic-${testId}`);
const tempDbPath = path.join(tempDir, "daogreen-test.db");
const tempUploads = path.join(tempDir, "uploads");

let db;
let initDb;
let loadProject;
let loadProjectItems;
let updateProject;

function lockedUpdate(id, patch) {
  const revision = Number(db.prepare("SELECT revision FROM projects WHERE id = ?").get(id)?.revision) || 1;
  return updateProject(id, { ...patch, expectedRevision: revision });
}
let loadPublishedReleaseSnapshot;
let buildClientProjectFromRelease;

function seedMaterial(id = "mat1") {
  // client_section/client_subsection/supplier/link/photo заполнены, чтобы позиция
  // могла пройти pre-publish проверку (enrichItemForPublishCheck берёт их из материала).
  db.prepare(`
    INSERT INTO materials (id, name, unit, category, base_price, module,
                           supplier, link, photo_url, client_section, client_subsection)
    VALUES (?, 'Material', 'шт.', 'Каркас и крепёж', 100, 'general',
            'ООО Поставщик', 'https://example.test/x', 'https://example.test/p.jpg', 'Каркас', 'Профиль')
  `).run(id);
}

function seedProject(id = "p1") {
  db.prepare(`
    INSERT INTO projects (id, name, client_token, city, status, manual_params)
    VALUES (?, 'Исходное имя', ?, 'Москва', 'active', '{"a":1}')
  `).run(id, `token-${id}`);
}

function item(id, overrides = {}) {
  return {
    id,
    materialId: "mat1",
    name: "Линия",
    unit: "шт.",
    module: "general",
    section: "general",
    category: "Каркас и крепёж",
    qty: 2,
    price: 100,
    itemType: "material",
    includedInProject: true,
    enabled: true,
    visibleToClient: true,
    approved: true,
    supplier: "ООО Поставщик",
    link: "https://example.test/x",
    clientSection: "Каркас",
    clientSubsection: "Профиль",
    ...overrides,
  };
}

/** Снимок всего, что должно откатываться целиком. */
function snapshot(id = "p1") {
  const row = db.prepare("SELECT name, city, status, manual_params, stellage_configs, version FROM projects WHERE id = ?").get(id);
  const items = loadProjectItems(id).map((i) => ({ id: i.id, qty: i.qty, price: i.price })).sort((a, b) => a.id.localeCompare(b.id));
  const versions = db.prepare("SELECT COUNT(*) c FROM spec_versions WHERE project_id = ?").get(id).c;
  return { row, items, versions };
}

beforeAll(async () => {
  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(tempUploads, { recursive: true });
  fs.writeFileSync(path.join(tempUploads, "project-scheme.png"), Buffer.from("scheme"));
  fs.writeFileSync(path.join(tempUploads, "rack-client.png"), Buffer.from("rack"));
  process.env.DATABASE_PATH = tempDbPath;
  process.env.DB_PATH = tempDbPath;
  process.env.UPLOAD_ROOT = tempUploads;
  process.env.NODE_ENV = "test";
  vi.resetModules();
  const dbMod = await import("../backend/src/db.js");
  const projectsMod = await import("../backend/src/routes/projects.js");
  const releaseMod = await import("../backend/src/services/publishedReleaseService.js");
  db = dbMod.db;
  initDb = dbMod.initDb;
  loadProject = dbMod.loadProject;
  loadProjectItems = dbMod.loadProjectItems;
  updateProject = projectsMod.updateProject;
  loadPublishedReleaseSnapshot = releaseMod.loadPublishedReleaseSnapshot;
  buildClientProjectFromRelease = releaseMod.buildClientProjectFromRelease;
  initDb();
});

beforeEach(() => {
  db.prepare("DELETE FROM spec_versions").run();
  db.prepare("DELETE FROM project_items").run();
  db.prepare("DELETE FROM materials").run();
  db.prepare("DELETE FROM projects").run();
  seedMaterial("mat1");
  seedProject("p1");
});

afterAll(() => {
  delete process.env.DATABASE_PATH;
  delete process.env.DB_PATH;
  vi.resetModules();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(tempDbPath + suffix); } catch { /* ignore */ }
  }
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("1. успешное полное сохранение", () => {
  it("metadata + manualParams + статус + позиции сохраняются вместе", () => {
    const res = lockedUpdate("p1", {
      name: "Новое имя",
      city: "Казань",
      status: "in_progress",
      manualParams: { b: 2 },
      items: [item("it1"), item("it2", { qty: 5 })],
    });

    expect(res).toBeTruthy();
    const row = db.prepare("SELECT name, city, status, manual_params FROM projects WHERE id='p1'").get();
    expect(row.name).toBe("Новое имя");
    expect(row.city).toBe("Казань");
    expect(row.status).toBe("in_progress");
    // manualParams мержится с существующими
    expect(JSON.parse(row.manual_params)).toMatchObject({ a: 1, b: 2 });
    const items = loadProjectItems("p1");
    expect(items.map((i) => i.id).sort()).toEqual(["it1", "it2"]);
    expect(items.find((i) => i.id === "it2").qty).toBe(5);
  });

  it("один atomic PATCH публикует новые items, metadata и client-visible изображения в release_v3", () => {
    const projectScheme = {
      id: "scheme-client",
      title: "Схема клиента",
      url: "/uploads/project-scheme.png",
      clientVisible: true,
    };
    const rackImage = {
      id: "rack-client",
      title: "Фото стеллажа",
      url: "/uploads/rack-client.png",
      clientVisible: true,
    };

    const saved = lockedUpdate("p1", {
      name: "Опубликованный проект",
      status: "ready_to_send",
      manualParams: { projectSchemes: [projectScheme] },
      stellageConfigs: [{ id: "rack-1", name: "Стеллаж 1", extraImages: [rackImage] }],
      items: [item("published-item", {
        qty: 3,
        price: 8500,
        clientSection: "stellage",
        clientSubsection: "Каркас и профиль",
      })],
    });

    const release = loadPublishedReleaseSnapshot(saved);
    expect(release.schema).toBe("release_v4");
    expect(release.assetsPinned).toBe(true);
    expect(release.projectMeta.name).toBe("Опубликованный проект");
    expect(release.items).toMatchObject([{ id: "published-item", qty: 3, price: 8500 }]);
    expect(release.imageManifest.projectSchemes).toMatchObject([
      { id: "scheme-client", url: "/uploads/project-scheme.png" },
    ]);
    expect(release.imageManifest.projectSchemes[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(release.imageManifest.rackImages).toMatchObject([
      { id: "rack-client", rackId: "rack-1", url: "/uploads/rack-client.png" },
    ]);

    const clientProject = buildClientProjectFromRelease(saved, release, { overlayLive: false });
    expect(clientProject.clientImages).toEqual(release.imageManifest);
    expect(clientProject.manualParams).toBeUndefined();
    expect(clientProject.name).toBe("Опубликованный проект");
  });
});

describe("2. ошибка вставки позиции → полный откат", () => {
  it("дубликат id позиции (PRIMARY KEY) не меняет ни metadata, ни статус, ни старые items", () => {
    // исходное состояние
    lockedUpdate("p1", { items: [item("keep1"), item("keep2")] });
    const before = snapshot();
    expect(before.items.map((i) => i.id)).toEqual(["keep1", "keep2"]);

    // вторая вставка с тем же id падает на PRIMARY KEY уже ПОСЛЕ DELETE+первого INSERT
    expect(() =>
      lockedUpdate("p1", {
        name: "НЕ ДОЛЖНО СОХРАНИТЬСЯ",
        city: "НЕ ДОЛЖНО",
        status: "in_progress",
        manualParams: { hacked: true },
        items: [item("dup"), item("dup")],
      }),
    ).toThrow();

    const after = snapshot();
    expect(after).toEqual(before);
    expect(after.row.name).toBe("Исходное имя");
    expect(after.row.city).toBe("Москва");
    expect(after.row.status).toBe("active");
    expect(JSON.parse(after.row.manual_params)).toEqual({ a: 1 });
    expect(after.items.map((i) => i.id)).toEqual(["keep1", "keep2"]);
    expect(after.versions).toBe(0); // published release не создан
  });

  it("ошибка валидации позиций тоже не трогает проект", () => {
    lockedUpdate("p1", { items: [item("keep1")] });
    const before = snapshot();
    expect(() =>
      lockedUpdate("p1", {
        name: "НЕ ДОЛЖНО",
        items: [item("bad", { materialId: "missing-material" })],
      }),
    ).toThrow();
    expect(snapshot()).toEqual(before);
  });
});

describe("3. ошибка ПОСЛЕ сохранения позиций → новые позиции тоже откатываются", () => {
  it("падение UPDATE проекта (NOT NULL name) откатывает уже вставленные items", () => {
    lockedUpdate("p1", { items: [item("old1"), item("old2")] });
    const before = snapshot();

    // items пройдут вставку, затем UPDATE_PROJECT упадёт на NOT NULL name
    expect(() =>
      lockedUpdate("p1", {
        items: [item("new1"), item("new2"), item("new3")],
        name: null,
      }),
    ).toThrow();

    const after = snapshot();
    // новые позиции откатились, старые на месте
    expect(after.items.map((i) => i.id)).toEqual(["old1", "old2"]);
    expect(after).toEqual(before);
  });
});

describe("4. ошибка создания client release → полный откат", () => {
  it("blocked publish validation откатывает items, metadata и статус", () => {
    lockedUpdate("p1", { items: [item("old1")] });
    const before = snapshot();

    // zero_price — критическая проблема публикации (CRITICAL_ISSUES)
    expect(() =>
      lockedUpdate("p1", {
        name: "НЕ ДОЛЖНО СОХРАНИТЬСЯ",
        status: "ready_to_send", // publish workflow → создаётся release
        manualParams: {
          projectSchemes: [{ id: "rollback-scheme", url: "/uploads/rollback.png", clientVisible: true }],
        },
        stellageConfigs: [{
          id: "rollback-rack",
          extraImages: [{ id: "rollback-image", url: "/uploads/rollback-rack.png", clientVisible: true }],
        }],
        items: [item("newA"), item("bad", { price: 0 })],
      }),
    ).toThrow();

    const after = snapshot();
    expect(after).toEqual(before);
    expect(after.row.status).toBe("active");
    expect(after.row.name).toBe("Исходное имя");
    expect(after.items.map((i) => i.id)).toEqual(["old1"]);
    expect(after.versions).toBe(0);
  });

  it("publish-workflow статус при уже существующем release коммитится вместе с metadata", () => {
    // Существующий release + неизменившиеся позиции → shouldPublishOnStatusChange=false
    // → повторная публикация пропускается, но статус/metadata должны сохраниться.
    db.prepare("UPDATE projects SET manual_params = ? WHERE id = 'p1'").run(
      JSON.stringify({
        a: 1,
        publishedRelease: { versionId: "v1", versionNumber: 1, publishedAt: "2026-01-01T00:00:00Z", status: "ready_to_send" },
      }),
    );

    const res = lockedUpdate("p1", { status: "sent_to_client", name: "Опубликован", items: [] });

    expect(res.status).toBe("sent_to_client");
    expect(res.name).toBe("Опубликован");
    // повторная публикация не выполнялась
    expect(db.prepare("SELECT COUNT(*) c FROM spec_versions WHERE project_id='p1'").get().c).toBe(0);
    // существующий release не потерян
    const mp = JSON.parse(db.prepare("SELECT manual_params FROM projects WHERE id='p1'").get().manual_params);
    expect(mp.publishedRelease).toMatchObject({ versionId: "v1" });
  });
});

describe("5. повторное сохранение", () => {
  it("два последовательных сохранения: нет дублей, ручные строки/frame BOM/закупочные поля живы", () => {
    const manualRow = item("manual1", { source: "", sourceType: "", name: "Ручная строка" });
    const frameBom = item("frame1", {
      source: "frame_bom",
      sourceType: "frameDrawing",
      sourceKey: "fd:1",
      sourceObjectIds: ["rack1"],
      name: "Профиль каркаса",
    });
    const purchase = item("buy1", {
      status: "ordered",
      actualPrice: 777,
      purchasePriority: "high",
      purchaseKey: "pk-1",
      deliveryDays: 5,
      responsible: "Иван",
    });

    lockedUpdate("p1", { name: "Сейв 1", items: [manualRow, frameBom, purchase] });
    const first = loadProjectItems("p1");
    expect(first).toHaveLength(3);

    // второе сохранение тем же набором (round-trip как из UI)
    lockedUpdate("p1", { name: "Сейв 2", items: first });
    const second = loadProjectItems("p1");

    // проект не пересоздан, дублей нет
    expect(db.prepare("SELECT COUNT(*) c FROM projects").get().c).toBe(1);
    expect(second).toHaveLength(3);
    expect(second.map((i) => i.id).sort()).toEqual(["buy1", "frame1", "manual1"]);
    expect(db.prepare("SELECT name FROM projects WHERE id='p1'").get().name).toBe("Сейв 2");

    // ручная строка жива
    expect(second.find((i) => i.id === "manual1").name).toBe("Ручная строка");
    // frame BOM метаданные живы
    const fb = second.find((i) => i.id === "frame1");
    expect(fb.source).toBe("frame_bom");
    expect(fb.sourceKey).toBe("fd:1");
    expect(fb.sourceObjectIds).toEqual(["rack1"]);
    // закупочные поля не стёрты
    const pb = second.find((i) => i.id === "buy1");
    expect(pb.status).toBe("ordered");
    expect(pb.actualPrice).toBe(777);
    expect(pb.purchasePriority).toBe("high");
    expect(pb.deliveryDays).toBe(5);
    expect(pb.responsible).toBe("Иван");
  });
});

describe("6. сохранение без items", () => {
  it("PATCH только metadata/статуса работает и не трогает позиции", () => {
    lockedUpdate("p1", { items: [item("keep1"), item("keep2")] });
    const itemsBefore = loadProjectItems("p1").map((i) => i.id).sort();

    const res = lockedUpdate("p1", { name: "Только метаданные", status: "in_progress" });

    expect(res.name).toBe("Только метаданные");
    expect(res.status).toBe("in_progress");
    expect(loadProjectItems("p1").map((i) => i.id).sort()).toEqual(itemsBefore);
  });

  it("PATCH только manualParams мержится и не теряет существующие ключи", () => {
    lockedUpdate("p1", { manualParams: { b: 2 } });
    const mp = JSON.parse(db.prepare("SELECT manual_params FROM projects WHERE id='p1'").get().manual_params);
    expect(mp).toMatchObject({ a: 1, b: 2 });
  });

  it("несуществующий проект → null, без исключения", () => {
    expect(lockedUpdate("nope", { name: "x" })).toBeNull();
  });
});

describe("транзакция не остаётся открытой после ошибки", () => {
  it("после падения последующее сохранение работает нормально", () => {
    expect(() => lockedUpdate("p1", { items: [item("dup"), item("dup")] })).toThrow();
    // если бы транзакция не откатилась/осталась открытой — следующий BEGIN упал бы
    const res = lockedUpdate("p1", { name: "После ошибки", items: [item("ok1")] });
    expect(res.name).toBe("После ошибки");
    expect(loadProjectItems("p1").map((i) => i.id)).toEqual(["ok1"]);
  });
});
