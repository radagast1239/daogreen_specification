import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { formatCatalogRefreshToast } from "../shared/refreshItemFromMaterial.js";

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-c212-${testId}`);
const tempDbPath = path.join(tempDir, "daogreen-test.db");

let db;
let initDb;
let loadProject;
let saveItems;
let patchItem;
let refreshItemsFromMaterial;

function clientItem(id, materialId, overrides = {}) {
  return {
    id,
    materialId,
    name: overrides.name || "Test material",
    unit: "шт.",
    module: "general",
    qty: overrides.qty ?? 2,
    price: overrides.price ?? 100,
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
    clientNote: overrides.clientNote || "keep-me",
    ...overrides,
  };
}

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

function seedProject(id = "proj1", { items = [] } = {}) {
  db.prepare(`
    INSERT INTO projects (id, name, client_token, status, manual_params, rooms, currency, vat, version)
    VALUES (?, 'Test project', ?, 'active', '{}', '[]', '₽', 1, 0)
  `).run(id, `token-${id}`);
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
  db = dbMod.db;
  initDb = dbMod.initDb;
  loadProject = dbMod.loadProject;
  saveItems = projectsMod.saveItems;
  patchItem = projectsMod.patchItem;
  refreshItemsFromMaterial = projectsMod.refreshItemsFromMaterial;
  initDb();
  seedMaterial("mat1", { name: "Catalog Material", basePrice: 100, supplier: "Supplier A" });
});

beforeEach(() => {
  db.exec("DELETE FROM project_items; DELETE FROM projects;");
});

afterAll(() => {
  try { db?.close?.(); } catch { /* ignore */ }
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("C2.1.2 catalog refresh for name and price", () => {
  it("restores manual name/price, clears overrides, and preserves protected fields", () => {
    seedProject("p1", {
      items: [clientItem("it1", "mat1", {
        name: "Manual name",
        nameOverridden: true,
        price: 55,
        qty: 7,
        status: "ordered",
        clientNote: "keep-note",
        visibleToClient: true,
        includedInProject: true,
      })],
    });
    const before = loadProject("p1").items[0];
    const result = refreshItemsFromMaterial("p1", { itemIds: ["it1"], fields: ["all"] });
    expect(result.results[0].changed).toBe(true);
    expect(result.results[0].changedFields).toEqual(expect.arrayContaining(["name", "price"]));
    const after = loadProject("p1").items.find((it) => it.id === "it1");
    expect(after).toMatchObject({
      name: "Catalog Material",
      nameOverridden: false,
      price: 100,
      qty: 7,
      status: "ordered",
      clientNote: before.clientNote,
      visibleToClient: true,
      includedInProject: true,
      supplier: "Supplier A",
    });
  });

  it("reset-name-only leaves project price untouched", () => {
    seedProject("p1", {
      items: [clientItem("it1", "mat1", { name: "Manual", nameOverridden: true, price: 77 })],
    });
    patchItem("p1", "it1", { name: "Catalog Material", nameOverridden: false });
    const after = loadProject("p1").items[0];
    expect(after).toMatchObject({ name: "Catalog Material", nameOverridden: false, price: 77 });
  });

  it("returns changed=false for no-op refresh and skips manual items", () => {
    seedProject("p1", {
      items: [
        clientItem("it1", "mat1", { name: "Catalog Material", price: 100, nameOverridden: false }),
        { ...clientItem("it2", null, { name: "Custom", price: 1 }), materialId: null },
      ],
    });
    const noop = refreshItemsFromMaterial("p1", { itemIds: ["it1"], fields: ["all"] });
    expect(noop.results[0]).toMatchObject({ changed: false, changedFields: [] });
    expect(noop.updated).toHaveLength(0);
    const manual = refreshItemsFromMaterial("p1", { itemIds: ["it2"], fields: ["all"] });
    expect(manual.skipped[0].reason).toBe("no_material");
    expect(manual.updated).toHaveLength(0);
  });

  it("updates two project items of the same material independently", () => {
    seedProject("p1", {
      items: [
        clientItem("it1", "mat1", { name: "A", nameOverridden: true, price: 11 }),
        clientItem("it2", "mat1", { name: "B", nameOverridden: true, price: 22 }),
      ],
    });
    const one = refreshItemsFromMaterial("p1", { itemIds: ["it1"], fields: ["all"] });
    expect(one.updated).toHaveLength(1);
    const items = loadProject("p1").items;
    expect(items.find((it) => it.id === "it1")).toMatchObject({ name: "Catalog Material", price: 100, nameOverridden: false });
    expect(items.find((it) => it.id === "it2")).toMatchObject({ name: "B", price: 22, nameOverridden: true });
  });

  it("formats toast text from changed fields", () => {
    expect(formatCatalogRefreshToast(["name", "price"])).toBe("Обновлены название и цена из базы");
    expect(formatCatalogRefreshToast(["price"])).toBe("Обновлена цена из базы");
    expect(formatCatalogRefreshToast(["name"])).toBe("Обновлено название из базы");
    expect(formatCatalogRefreshToast([])).toBe("Позиция уже соответствует базе");
  });
});

describe("C2.1.2 UI wiring", () => {
  const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

  it("wires confirmation, reset-name action, and truthful toast", () => {
    const page = read("src/pages/admin/SpecEditorPage.jsx");
    const menu = read("src/components/SpecificationRowMenu.jsx");
    const inspector = read("src/components/SpecificationItemInspector.jsx");
    expect(page).toContain("Вернуть название и цену из базы материалов?");
    expect(page).toContain("formatCatalogRefreshToast");
    expect(page).toContain("onResetName={() => resetItemNameFromBase(it)}");
    expect(menu).toContain("Вернуть название из базы");
    expect(menu).toContain("showResetName");
    expect(inspector).toContain("showResetName");
  });
});
