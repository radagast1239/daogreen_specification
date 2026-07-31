import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  CATALOG_QUICK_FILTERS,
  catalogHasActiveFilters,
  catalogColumnVisibility,
  filterMaterialsCatalog,
  matchCatalogQuickFilter,
  materialCatalogStatusChips,
  materialsEmptyMessage,
  sortMaterialsCatalog,
} from "../src/lib/materialsCatalogView.js";
import { materialShownToClientByDefault } from "../shared/materialQualityCheck.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(__dirname, "../src/pages/admin/MaterialsPage.jsx"), "utf8");
const view = fs.readFileSync(path.join(__dirname, "../src/lib/materialsCatalogView.js"), "utf8");

const sample = [
  {
    id: "m1",
    name: "Лоток",
    category: "Лотки",
    basePrice: 100,
    supplier: "Альфа",
    clientVisibleDefault: true,
    status: "active",
  },
  {
    id: "m2",
    name: "Труба",
    category: "Полив",
    basePrice: 0,
    supplier: "",
    clientVisibleDefault: false,
    status: "active",
  },
  {
    id: "m3",
    name: "На проверке",
    category: "Требует разбора",
    basePrice: 50,
    supplier: "Бета",
    clientVisibleDefault: true,
    clientSection: "requires_review",
    status: "active",
  },
];

describe("materialsCatalogView", () => {
  it("exposes catalog quick filters without inventing new quality detectors", () => {
    expect(CATALOG_QUICK_FILTERS.map((f) => f.id)).toEqual([
      "all",
      "needs_review",
      "no_photo",
      "no_supplier",
      "hidden_client",
    ]);
    expect(view).toContain("matchQualityFilter");
    expect(view).toContain("materialShownToClientByDefault");
    expect(view).toContain("analyzeMaterialsQuality");
  });

  it("filters by query, category, hidden client", () => {
    const entriesById = new Map(
      sample.map((m) => [m.id, { material: m, row: m, issues: [] }])
    );
    const byName = filterMaterialsCatalog(sample, { q: "труба", entriesById });
    expect(byName.map((m) => m.id)).toEqual(["m2"]);
    const hidden = filterMaterialsCatalog(sample, {
      quick: "hidden_client",
      entriesById,
    });
    expect(hidden.map((m) => m.id)).toEqual(["m2"]);
    expect(materialShownToClientByDefault(sample[1])).toBe(false);
  });

  it("matches no_supplier via quality entry issues", () => {
    const entry = {
      material: sample[1],
      row: sample[1],
      issues: [{ id: "no_supplier", severity: "critical", label: "Без поставщика" }],
    };
    expect(matchCatalogQuickFilter(entry, sample[1], "no_supplier")).toBe(true);
    expect(matchCatalogQuickFilter({ issues: [] }, sample[0], "no_supplier")).toBe(false);
  });

  it("sorts and reports empty states", () => {
    const byPrice = sortMaterialsCatalog(sample, "price");
    expect(byPrice[0].id).toBe("m1");
    expect(materialsEmptyMessage({ sourceCount: 0, visibleCount: 0 }).cta).toBe("create");
    expect(
      materialsEmptyMessage({ sourceCount: 3, visibleCount: 0, hasFilters: true }).cta
    ).toBe("reset");
    expect(materialsEmptyMessage({ sourceCount: 3, visibleCount: 2, hasFilters: true })).toBe(null);
    expect(catalogHasActiveFilters({ quick: "no_photo" })).toBe(true);
    expect(catalogHasActiveFilters({ quick: "all" })).toBe(false);
    expect(catalogColumnVisibility("purchase").link).toBe(true);
    expect(catalogColumnVisibility("main").link).toBe(false);
  });

  it("builds status chips from existing issues", () => {
    const chips = materialCatalogStatusChips(
      {
        issues: [
          { id: "no_photo" },
          { id: "needs_review_category" },
        ],
      },
      sample[0]
    );
    expect(chips.some((c) => c.id === "photo")).toBe(true);
    expect(chips.some((c) => c.id === "review")).toBe(true);
    const ready = materialCatalogStatusChips({ issues: [] }, sample[0]);
    expect(ready.some((c) => c.id === "ready")).toBe(true);
  });
});

describe("MaterialsPage catalog cleanup 1f", () => {
  it("updates title and links to quality without embedding quality UI in base table", () => {
    expect(page).toContain("База материалов, цены, поставщики и готовность к проектам");
    expect(page).toContain('to="/materials?tab=quality"');
    expect(page).toContain("Проверка качества");
    expect(page).toContain("MaterialsQualityPanel");
    expect(page).toContain("CATALOG_QUICK_FILTERS");
  });

  it("uses RowActionsMenu, bulk bar only when selected, and filter reset empty state", () => {
    expect(page).toContain("RowActionsMenu");
    expect(page).toContain("materials-bulk-bar");
    expect(page).toContain("selectedIds.size > 0");
    expect(page).toContain("Сбросить фильтры");
    expect(page).toContain("materialsEmptyMessage");
    expect(page).toContain("buildBulkPatchPayload");
    expect(page).toContain("formatBulkActionConfirmation");
    expect(page).not.toContain("Быстрая копия");
  });
});
