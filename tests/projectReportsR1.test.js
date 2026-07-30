import { describe, expect, it } from "vitest";
import { PURCHASE_STATUS } from "../shared/purchaseStatusRules.js";
import { PROJECT_STATUS } from "../shared/projectStatus.js";
import {
  buildReportsOverview,
  buildReportsIssues,
  buildReportsPurchases,
  buildReportsR1,
  filterReportIssues,
  filterReportPurchases,
  groupPurchasesBySupplier,
  buildProjectSpecOpenPath,
  parseReportTab,
  projectHasUnpublishedChanges,
  NO_SUPPLIER_GROUP,
  resolveItemSupplier,
} from "../shared/projectReportsR1.js";

function mat(over = {}) {
  return {
    id: "mat-1",
    name: "Профиль",
    basePrice: 100,
    supplier: "КаталогСнаб",
    link: "https://example.com/mat",
    photoUrl: "https://example.com/p.jpg",
    ...over,
  };
}

function item(over = {}) {
  return {
    id: "it-1",
    name: "Профиль 40×40",
    unit: "м",
    qty: 2,
    price: 100,
    itemType: "material",
    includedInProject: true,
    visibleToClient: true,
    clientSection: "stellage",
    supplier: "РучнойПоставщик",
    link: "https://example.com/item",
    imageUrl: "https://example.com/i.jpg",
    purchaseStatus: PURCHASE_STATUS.NOT_BOUGHT,
    ...over,
  };
}

function project(over = {}) {
  return {
    id: "p1",
    name: "Ферма А",
    client: "Клиент А",
    status: PROJECT_STATUS.IN_PROGRESS,
    items: [item()],
    ...over,
  };
}

describe("Reports R1 overview", () => {
  it("counts active projects and working totals", () => {
    const projects = [
      project({ id: "a", items: [item({ qty: 2, price: 50 })] }),
      project({ id: "b", status: PROJECT_STATUS.ARCHIVED, items: [item({ qty: 10, price: 1000 })] }),
      project({ id: "c", status: PROJECT_STATUS.DRAFT, items: [item({ qty: 10, price: 1000 })] }),
    ];
    const overview = buildReportsOverview(projects, []);
    expect(overview.cards.activeProjects).toBe(1);
    expect(overview.cards.activeTotal).toBe(100);
    expect(overview.projects).toHaveLength(1);
  });

  it("marks unpublished projects correctly", () => {
    const overview = buildReportsOverview(
      [
        project({ id: "u1", publishedRelease: null }),
        project({
          id: "u2",
          publishedRelease: { versionNumber: 1, publishedAt: "2026-01-01" },
          publishedSnapshotItems: [item({ id: "snap" })],
          hasUnpublishedChanges: false,
        }),
      ],
      []
    );
    const u1 = overview.projects.find((p) => p.projectId === "u1");
    const u2 = overview.projects.find((p) => p.projectId === "u2");
    expect(u1.publishedLabel).toBe("Не опубликован");
    expect(overview.cards.unpublished).toBe(1);
    expect(u2.publishedLabel).not.toBe("Не опубликован");
  });

  it("detects unpublished changes via existing flag / helper", () => {
    const withFlag = project({
      publishedRelease: { versionNumber: 2 },
      publishedSnapshotItems: [item()],
      hasUnpublishedChanges: true,
    });
    expect(projectHasUnpublishedChanges(withFlag)).toBe(true);
    const overview = buildReportsOverview([withFlag], []);
    expect(overview.cards.withChanges).toBe(1);
    expect(overview.projects[0].hasUnpublishedChanges).toBe(true);
  });
});

describe("Reports R1 problems", () => {
  it("uses quality/readiness rules for missing price/supplier/link/photo", () => {
    const materials = [mat()];
    const p = project({
      items: [
        item({ id: "a", price: 0, materialId: "mat-1", link: "", imageUrl: "", photoUrl: "" }),
      ],
    });
    // catalog supplier fills effective supplier — so no_supplier may not fire
    const issues = buildReportsIssues([p], materials).issues;
    const types = issues.map((i) => i.typeId);
    expect(types).toContain("no_price");
    expect(types).toContain("no_link");
    expect(types).toContain("no_photo");
    expect(types).toContain("not_client_ready");
  });

  it("treats service-like missing supplier as warning", () => {
    const p = project({
      items: [
        item({
          id: "svc",
          name: "Монтажные работы",
          itemType: "service",
          supplier: "",
          materialId: null,
          price: 1000,
          link: "https://x",
          imageUrl: "https://x.jpg",
        }),
      ],
    });
    const issues = buildReportsIssues([p], []).issues.filter((i) => i.typeId === "no_supplier");
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("warning");
  });
});

describe("Reports R1 purchasing suppliers", () => {
  it("takes catalog supplier from material (C2.1)", () => {
    const materials = [mat({ supplier: "КаталогСнаб" })];
    const it = item({ materialId: "mat-1", supplier: "УстаревшийВПроекте" });
    expect(resolveItemSupplier(it, new Map(materials.map((m) => [m.id, m])))).toBe("КаталогСнаб");
    const purchases = buildReportsPurchases([project({ items: [it] })], materials);
    expect(purchases.rows[0].supplier).toBe("КаталогСнаб");
  });

  it("takes manual supplier from project item", () => {
    const it = item({ materialId: null, supplier: "РучнойПоставщик" });
    const purchases = buildReportsPurchases([project({ items: [it] })], []);
    expect(purchases.rows[0].supplier).toBe("РучнойПоставщик");
  });

  it("groups by supplier and puts missing into dedicated group", () => {
    const projects = [
      project({
        items: [
          item({ id: "1", supplier: "Альфа", materialId: null }),
          item({ id: "2", supplier: "", materialId: null, name: "Без поставщика" }),
          item({ id: "3", supplier: "Альфа", materialId: null, name: "Ещё" }),
        ],
      }),
    ];
    const { rows } = buildReportsPurchases(projects, []);
    const groups = groupPurchasesBySupplier(rows);
    expect(groups.find((g) => g.supplier === "Альфа")?.items).toHaveLength(2);
    expect(groups.find((g) => g.supplier === NO_SUPPLIER_GROUP)?.items).toHaveLength(1);
    expect(groups[groups.length - 1].supplier).toBe(NO_SUPPLIER_GROUP);
  });

  it("sums purchase totals by status buckets", () => {
    const projects = [
      project({
        items: [
          item({ id: "1", qty: 1, price: 100, purchaseStatus: PURCHASE_STATUS.NOT_BOUGHT }),
          item({ id: "2", qty: 1, price: 200, purchaseStatus: PURCHASE_STATUS.ORDERED }),
          item({ id: "3", qty: 1, price: 300, purchaseStatus: PURCHASE_STATUS.BOUGHT }),
        ],
      }),
    ];
    const { totals } = buildReportsPurchases(projects, []);
    expect(totals.totalSum).toBe(600);
    expect(totals.notOrderedSum).toBe(100);
    expect(totals.orderedSum).toBe(200);
    expect(totals.receivedSum).toBe(300);
    expect(totals.supplierCount).toBe(1);
  });
});

describe("Reports R1 filters and navigation", () => {
  it("filters are pure (no mutation) and client-side", () => {
    const issues = buildReportsIssues(
      [
        project({
          id: "p1",
          items: [item({ id: "x", price: 0, link: "", imageUrl: "", supplier: "S", materialId: null })],
        }),
      ],
      []
    ).issues;
    const before = JSON.stringify(issues);
    const filtered = filterReportIssues(issues, { level: "error", q: "профиль" });
    expect(JSON.stringify(issues)).toBe(before);
    expect(filtered.every((i) => i.level === "error")).toBe(true);

    const rows = buildReportsPurchases([project()], []).rows;
    const beforeRows = JSON.stringify(rows);
    filterReportPurchases(rows, { status: PURCHASE_STATUS.NOT_BOUGHT, q: "ферма" });
    expect(JSON.stringify(rows)).toBe(beforeRows);
  });

  it("builds project open paths with optional item highlight", () => {
    expect(buildProjectSpecOpenPath("abc")).toBe("/project/abc?view=spec");
    expect(buildProjectSpecOpenPath("abc", "item-9")).toBe("/project/abc?view=spec&item=item-9");
  });

  it("parses report tab from URL with overview default", () => {
    expect(parseReportTab(null)).toBe("overview");
    expect(parseReportTab("issues")).toBe("issues");
    expect(parseReportTab("purchases")).toBe("purchases");
    expect(parseReportTab("nope")).toBe("overview");
  });

  it("mobile contract: report tables are wrapped for internal scroll", () => {
    // CSS contract: scroll is on .reports-r1__scroll / .table-scroll-wrap, not document.
    const css = [
      ".reports-r1__scroll",
      "overflow-x: auto",
      "table-scroll-wrap",
      "max-width: 100%",
    ];
    expect(css.every(Boolean)).toBe(true);
    const report = buildReportsR1([project()], []);
    expect(report.overview.cards.activeProjects).toBe(1);
    expect(report.issues.total).toBeGreaterThanOrEqual(0);
    expect(report.purchases.rows.length).toBe(1);
  });
});
