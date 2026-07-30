import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildKeepProjectValuesPatch,
  buildMaterialChangesReview,
  filterMaterialChangesReview,
  formatCompactDiffLine,
  formatMaterialReviewToast,
  listItemFieldDiffs,
  mapFieldsToRefreshPayload,
  mergeRetainedByItem,
  selectBulkUpdateItemIds,
  splitDiffsForPreview,
  countReviewRowsByStatus,
  MATERIAL_REVIEW_STATUS,
  MATERIAL_REVIEW_DEFAULT_FILTER,
} from "../shared/materialChangesReview.js";
import { classifyMaterialDrift } from "../shared/projectReportsR2.js";
import { buildRefreshPatchForItem, formatCatalogRefreshToast } from "../shared/refreshItemFromMaterial.js";
import { applyProjectCatalogUpdates } from "../shared/applyProjectCatalogUpdates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const mat = {
  id: "m1",
  name: "Каталог насос",
  basePrice: 1000,
  supplier: "БазаСнаб",
  link: "https://base.example/pump",
  unit: "шт.",
  category: "Полив",
  techNote: "note-base",
};

function item(over = {}) {
  return {
    id: "it1",
    materialId: "m1",
    name: "Каталог насос",
    price: 1000,
    supplier: "БазаСнаб",
    link: "https://base.example/pump",
    unit: "шт.",
    category: "Полив",
    techNote: "note-base",
    qty: 3,
    status: "ordered",
    clientComment: "keep-comment",
    visibleToClient: true,
    includedInProject: true,
    itemType: "material",
    module: "Насосная",
    ...over,
  };
}

describe("material changes review", () => {
  it("full list is not truncated (all changed items present)", () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      item({ id: `it${i}`, name: `Pos ${i}`, price: 100 + i })
    );
    const review = buildMaterialChangesReview(items, [mat]);
    expect(review.count).toBe(12);
    expect(review.rows).toHaveLength(12);
    expect(review.rows.map((r) => r.itemId).sort()).toEqual(items.map((it) => it.id).sort());
  });

  it("unifies former dual banners into one review count", () => {
    const items = [
      item({ id: "a", price: 900 }),
      item({ id: "b", name: "Old name", link: "https://old" }),
    ];
    const review = buildMaterialChangesReview(items, [mat]);
    expect(review.count).toBe(2);
    expect(review.summary.prices).toBeGreaterThanOrEqual(1);
    expect(review.summary.names + review.summary.links).toBeGreaterThanOrEqual(1);
    const page = fs.readFileSync(path.join(__dirname, "../src/pages/admin/SpecEditorPage.jsx"), "utf8");
    expect(page).toContain("Изменения в базе материалов");
    expect(page).toContain("Проверить изменения");
    expect(page).toContain("MaterialChangesReviewPanel");
    expect(page).not.toContain("Проверить обновления материалов:");
    expect(page).not.toContain("Цена в базе изменилась у");
  });

  it("one item can have several field diffs", () => {
    const it = item({
      name: "Ручное имя",
      price: 500,
      link: "https://project",
      unit: "компл.",
    });
    const diffs = listItemFieldDiffs(it, mat);
    expect(diffs.map((d) => d.field)).toEqual(
      expect.arrayContaining(["name", "price", "link", "unit"])
    );
    const review = buildMaterialChangesReview([it], [mat]);
    expect(review.rows[0].fieldDiffs.length).toBeGreaterThanOrEqual(3);
  });

  it("name override is intentional project change", () => {
    const it = item({ name: "Ручное", nameOverridden: true });
    const review = buildMaterialChangesReview([it], [mat]);
    const nameDiff = review.rows[0].fieldDiffs.find((d) => d.field === "name");
    expect(nameDiff.status).toBe(MATERIAL_REVIEW_STATUS.project_override);
    expect(classifyMaterialDrift(it, mat).typeIds).toContain("name_override");
  });

  it("price override is intentional project change", () => {
    const it = item({ price: 777, priceOverridden: true });
    const review = buildMaterialChangesReview([it], [mat]);
    const priceDiff = review.rows[0].fieldDiffs.find((d) => d.field === "price");
    expect(priceDiff.status).toBe(MATERIAL_REVIEW_STATUS.project_override);
    expect(classifyMaterialDrift(it, mat).typeIds).toContain("manual_price");
  });

  it("supplier drift is informational only", () => {
    const it = item({ supplier: "Старый" });
    const review = buildMaterialChangesReview([it], [mat]);
    const s = review.rows[0].fieldDiffs.find((d) => d.field === "supplier");
    expect(s.status).toBe(MATERIAL_REVIEW_STATUS.applied_from_catalog);
    expect(s.canUpdate).toBe(false);
    expect(s.infoText).toMatch(/уже применяется/i);
    expect(mapFieldsToRefreshPayload(["supplier", "price"])).toEqual(["price"]);
  });

  it("single-item update via refresh patch restores name/price and clears overrides", () => {
    const it = item({ name: "Manual", nameOverridden: true, price: 55, priceOverridden: true, qty: 9 });
    const patch = buildRefreshPatchForItem(it, mat, ["all"]);
    expect(patch).toMatchObject({ name: "Каталог насос", nameOverridden: false, price: 1000, priceOverridden: false });
    const after = { ...it, ...patch };
    expect(after.qty).toBe(9);
    expect(after.status).toBe("ordered");
    expect(after.clientComment).toBe("keep-comment");
    expect(after.visibleToClient).toBe(true);
  });

  it("field selection maps to refresh payload subset", () => {
    expect(mapFieldsToRefreshPayload(["name", "link", "unit"])).toEqual(["name", "link"]);
    expect(mapFieldsToRefreshPayload(["price", "imageUrl"])).toEqual(["price", "photo"]);
  });

  it("keep project values marks intentional overrides", () => {
    const it = item({ name: "X", price: 1, link: "https://p", unit: "м" });
    const patch = buildKeepProjectValuesPatch(it, ["name", "price", "link", "unit"]);
    expect(patch.nameOverridden).toBe(true);
    expect(patch.priceOverridden).toBe(true);
    expect(patch.linkOverridden).toBe(true);
    expect(patch.retainedCatalogFields).toEqual(expect.arrayContaining(["price", "link", "unit"]));
    const retained = mergeRetainedByItem({}, it.id, ["unit", "price"]);
    const review = buildMaterialChangesReview([{ ...it, ...patch }], [mat], { retainedByItem: retained });
    expect(review.rows[0].status).toBe(MATERIAL_REVIEW_STATUS.project_override);
  });

  it("bulk update targets only selected ids", () => {
    const items = [
      item({ id: "a", price: 1 }),
      item({ id: "b", price: 2 }),
      item({ id: "c", price: 3 }),
    ];
    const review = buildMaterialChangesReview(items, [mat]);
    const ids = selectBulkUpdateItemIds(review.rows, { selectedIds: ["a", "c"] });
    expect(ids.sort()).toEqual(["a", "c"]);
  });

  it("intentional overrides are skipped in bulk unless explicitly included", () => {
    const items = [
      item({ id: "need", price: 1 }),
      item({ id: "kept", name: "Manual", nameOverridden: true }),
    ];
    const review = buildMaterialChangesReview(items, [mat]);
    expect(selectBulkUpdateItemIds(review.rows, { includeProjectOverrides: false })).toEqual(["need"]);
    expect(selectBulkUpdateItemIds(review.rows, { includeProjectOverrides: true }).sort()).toEqual([
      "kept",
      "need",
    ]);
  });

  it("no-op toast is truthful", () => {
    expect(formatMaterialReviewToast({ updated: 0, alreadyCurrent: 3 })).toBe(
      "Обновлено: 0 · Уже актуальны: 3"
    );
    expect(formatCatalogRefreshToast([])).toBe("Позиция уже соответствует базе");
    expect(listItemFieldDiffs(item(), mat)).toEqual([]);
    expect(formatMaterialReviewToast({ updated: 0, alreadyCurrent: 1, keptProject: 2 })).toContain(
      "Оставлены проектные значения: 2"
    );
  });

  it("qty/status/comments/visibility stay untouched by catalog apply", () => {
    const it = item({
      price: 1,
      qty: 11,
      status: "bought",
      clientComment: "c1",
      visibleToClient: false,
    });
    const { items } = applyProjectCatalogUpdates([it], [mat], { itemIds: ["it1"], fields: ["price"] });
    expect(items[0]).toMatchObject({
      price: 1000,
      qty: 11,
      status: "bought",
      clientComment: "c1",
      visibleToClient: false,
    });
  });

  it("filters work and manual items are excluded from catalog drift", () => {
    const items = [
      item({ id: "need", price: 1 }),
      item({ id: "named", name: "X", nameOverridden: true }),
      { ...item({ id: "manual", materialId: null, name: "Custom" }), materialId: null },
    ];
    const review = buildMaterialChangesReview(items, [mat]);
    expect(review.rows.every((r) => r.materialId)).toBe(true);
    expect(filterMaterialChangesReview(review.rows, "needs_review").map((r) => r.itemId)).toContain("need");
    expect(filterMaterialChangesReview(review.rows, "project_override").map((r) => r.itemId)).toContain("named");
    expect(filterMaterialChangesReview(review.rows, "price").every((r) =>
      r.fieldDiffs.some((d) => d.group === "price")
    )).toBe(true);
  });

  it("mobile panel css avoids document overflow", () => {
    const css = fs.readFileSync(
      path.join(__dirname, "../src/styles/material-changes-review.css"),
      "utf8"
    );
    expect(css).toContain("overflow: hidden");
    expect(css).toContain("100dvh");
    expect(css).toContain("@media (max-width: 900px)");
    expect(css).toContain("mcr-footer");
    expect(css).toContain("56vw");
    const panel = fs.readFileSync(
      path.join(__dirname, "../src/components/MaterialChangesReviewPanel.jsx"),
      "utf8"
    );
    expect(panel).toContain('document.body.style.overflow = "hidden"');
    expect(panel).toContain('e.key === "Escape"');
  });

  it("does not surface matching notes; collapses extra diffs; default filter needs_review", () => {
    const sameNotes = item({ price: 500 });
    const diffs = listItemFieldDiffs(sameNotes, mat);
    expect(diffs.every((d) => d.field !== "techNote")).toBe(true);
    expect(diffs.some((d) => d.field === "price")).toBe(true);

    const many = [
      { field: "price", label: "Базовая цена", before: 1, after: 2 },
      { field: "name", label: "Название", before: "a", after: "b" },
      { field: "link", label: "Ссылка", before: "x", after: "y" },
      { field: "unit", label: "Единица", before: "шт.", after: "компл." },
    ];
    const split = splitDiffsForPreview(many, 2);
    expect(split.preview).toHaveLength(2);
    expect(split.rest).toHaveLength(2);
    expect(formatCompactDiffLine(many[0])).toMatch(/→/);

    expect(MATERIAL_REVIEW_DEFAULT_FILTER).toBe("needs_review");
    const panel = fs.readFileSync(
      path.join(__dirname, "../src/components/MaterialChangesReviewPanel.jsx"),
      "utf8"
    );
    expect(panel).toContain("MATERIAL_REVIEW_DEFAULT_FILTER");
    expect(panel).toContain("Ещё ");
    expect(panel).toContain("Выбрать поля");
    expect(panel).toContain("Открыть позицию");
    expect(panel).toContain("mcr-footer");
    expect(panel).toContain("Обновить");
    expect(panel).toContain("Оставить");
    expect(panel).toContain("onUpdateOne");
    expect(panel).toContain("onKeepOne");

    const review = buildMaterialChangesReview(
      [item({ id: "a", price: 1 }), item({ id: "b", name: "X", nameOverridden: true })],
      [mat]
    );
    const counts = countReviewRowsByStatus(review.rows);
    expect(counts.needs_review + counts.project_override).toBeGreaterThan(0);
    expect(filterMaterialChangesReview(review.rows, "all").length).toBe(review.rows.length);
    expect(filterMaterialChangesReview(review.rows, "needs_review").length).toBe(counts.needs_review);
  });
});
