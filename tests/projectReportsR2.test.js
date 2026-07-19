import { describe, expect, it } from "vitest";
import { PROJECT_STATUS } from "../shared/projectStatus.js";
import {
  buildReportsPublications,
  buildReportsMaterialDrift,
  filterReportPublications,
  filterReportMaterialDrift,
  classifyMaterialDrift,
  buildClientReportOpenPath,
  parseReportTabAll,
  REPORT_TABS_ALL,
} from "../shared/projectReportsR2.js";

function item(over = {}) {
  return {
    id: "it-1",
    name: "Профиль",
    qty: 2,
    price: 100,
    itemType: "material",
    includedInProject: true,
    visibleToClient: true,
    materialId: "mat-1",
    supplier: "КаталогСнаб",
    ...over,
  };
}

function project(over = {}) {
  return {
    id: "p1",
    name: "Ферма",
    client: "Клиент",
    status: PROJECT_STATUS.IN_PROGRESS,
    revision: 3,
    clientToken: "tok-abc",
    items: [item()],
    ...over,
  };
}

const mat = {
  id: "mat-1",
  name: "Профиль",
  basePrice: 100,
  supplier: "КаталогСнаб",
};

describe("Reports R2 publications", () => {
  it("marks unpublished projects", () => {
    const { rows } = buildReportsPublications([project({ publishedRelease: null })]);
    expect(rows[0].hasPublished).toBe(false);
    expect(rows[0].syncBadge).toBe("Не опубликован");
    expect(rows[0].hasClientLink).toBe(false);
  });

  it("computes working and published totals and delta", () => {
    const p = project({
      publishedRelease: { versionNumber: 2, publishedAt: "2026-01-01", revision: 1 },
      publishedSnapshotItems: [item({ qty: 1, price: 100 })],
      hasUnpublishedChanges: true,
      unpublishedSummary: { hasChanges: true, addedCount: 0, removedCount: 0, changedCount: 1 },
      items: [item({ qty: 2, price: 100 })],
    });
    const { rows } = buildReportsPublications([p]);
    expect(rows[0].workingTotal).toBe(200);
    expect(rows[0].publishedTotal).toBe(100);
    expect(rows[0].delta).toBe(100);
    expect(rows[0].syncBadge).toBe("Есть изменения");
    expect(rows[0].changedCount).toBe(1);
  });

  it("counts added/removed/changed via existing unpublished summary", () => {
    const p = project({
      publishedRelease: { versionNumber: 1 },
      publishedSnapshotItems: [item({ id: "old" })],
      unpublishedSummary: { hasChanges: true, addedCount: 2, removedCount: 1, changedCount: 3 },
      hasUnpublishedChanges: true,
    });
    const row = buildReportsPublications([p]).rows[0];
    expect(row.addedCount).toBe(2);
    expect(row.removedCount).toBe(1);
    expect(row.changedCount).toBe(3);
  });

  it("shows client link only when published + token", () => {
    expect(buildClientReportOpenPath(project({ publishedRelease: null }))).toBe("");
    expect(
      buildClientReportOpenPath(
        project({ publishedRelease: { versionNumber: 1 }, clientToken: "t1" })
      )
    ).toBe("/client/p/t1");
    const row = buildReportsPublications([
      project({ publishedRelease: { versionNumber: 1 }, clientToken: "t1", hasUnpublishedChanges: false }),
    ]).rows[0];
    expect(row.hasClientLink).toBe(true);
  });

  it("filters are pure", () => {
    const rows = buildReportsPublications([
      project({ publishedRelease: null }),
      project({
        id: "p2",
        publishedRelease: { versionNumber: 1 },
        publishedSnapshotItems: [item()],
        hasUnpublishedChanges: false,
        unpublishedSummary: { hasChanges: false, addedCount: 0, removedCount: 0, changedCount: 0 },
      }),
    ]).rows;
    const before = JSON.stringify(rows);
    const filtered = filterReportPublications(rows, { published: "no" });
    expect(JSON.stringify(rows)).toBe(before);
    expect(filtered.every((r) => !r.hasPublished)).toBe(true);
  });
});

describe("Reports R2 material drift", () => {
  it("detects manual price and name override", () => {
    expect(
      classifyMaterialDrift(item({ priceOverridden: true, price: 150 }), mat).typeIds
    ).toContain("manual_price");
    expect(
      classifyMaterialDrift(item({ nameOverridden: true, name: "Другое" }), mat).typeIds
    ).toContain("name_override");
  });

  it("detects catalog price/name difference and lost material", () => {
    expect(classifyMaterialDrift(item({ price: 150 }), mat).typeIds).toContain("catalog_price_diff");
    expect(classifyMaterialDrift(item({ name: "X" }), mat).typeIds).toContain("catalog_name_diff");
    expect(classifyMaterialDrift(item({ materialId: "gone" }), null).primaryTypeId).toBe(
      "lost_material"
    );
  });

  it("takes supplier from material and skips manual items", () => {
    const materials = [{ ...mat, supplier: "НовыйСнаб" }];
    const linked = item({ supplier: "Старый" });
    const { rows } = buildReportsMaterialDrift(
      [project({ items: [linked, item({ id: "m2", materialId: null, supplier: "Ручной" })] })],
      materials
    );
    expect(rows.every((r) => r.materialId)).toBe(true);
    expect(rows.find((r) => r.itemId === "it-1")?.supplier).toBe("НовыйСнаб");
    expect(rows.some((r) => r.itemId === "m2")).toBe(false);
  });

  it("hides matches_base by default", () => {
    const { rows } = buildReportsMaterialDrift([project()], [mat]);
    const onlyDiffs = filterReportMaterialDrift(rows, { onlyDiffs: true });
    const all = filterReportMaterialDrift(rows, { onlyDiffs: false });
    expect(onlyDiffs.every((r) => !r.matchesBase)).toBe(true);
    expect(all.some((r) => r.matchesBase)).toBe(true);
  });

  it("parses five report tabs and mobile contract placeholders", () => {
    expect(REPORT_TABS_ALL).toHaveLength(5);
    expect(parseReportTabAll("publications")).toBe("publications");
    expect(parseReportTabAll("material-drift")).toBe("material-drift");
    expect(parseReportTabAll("x")).toBe("overview");
    expect([".reports-r1__scroll", "overflow-x: auto", "table-scroll-wrap"].every(Boolean)).toBe(
      true
    );
  });
});
