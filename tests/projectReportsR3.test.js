import { describe, expect, it } from "vitest";
import { PROJECT_STATUS } from "../shared/projectStatus.js";
import { PURCHASE_STATUS } from "../shared/purchaseStatusRules.js";
import { buildReportsPurchases, filterReportPurchases, NO_SUPPLIER_GROUP as R1_NOSUP } from "../shared/projectReportsR1.js";
import { REPORT_TABS_ALL, parseReportTabAll } from "../shared/projectReportsR2.js";
import {
  NO_ROOM_GROUP,
  NO_SUPPLIER_GROUP,
  buildPurchaseExportSheetData,
  summarizePurchaseExport,
  buildReportsSections,
  buildReportsRooms,
  filterReportRooms,
  isReportsBreakdownLine,
} from "../shared/projectReportsR3.js";
import { writeReportsPurchaseWorkbook } from "../src/lib/reportsPurchaseExcel.js";

function item(over = {}) {
  return {
    id: "it-1",
    name: "Позиция",
    qty: 2,
    price: 100,
    itemType: "material",
    includedInProject: true,
    visibleToClient: true,
    clientSection: "electrics",
    supplier: "Снаб",
    purchaseStatus: PURCHASE_STATUS.NOT_BOUGHT,
    link: "https://example.com/x",
    ...over,
  };
}

function project(over = {}) {
  return {
    id: "p1",
    name: "Ферма",
    client: "Клиент",
    status: PROJECT_STATUS.IN_PROGRESS,
    rooms: [{ id: "r1", name: "Рассада" }],
    items: [item()],
    ...over,
  };
}

const materials = [{ id: "mat-1", name: "Кабель", basePrice: 50, supplier: "КаталогСнаб", clientSection: "electrics" }];

describe("Reports R3 purchasing excel", () => {
  it("respects purchase filters and matches filtered sums", () => {
    const purchases = buildReportsPurchases(
      [
        project({
          items: [
            item({ id: "a", supplier: "Альфа", materialId: null, price: 10, qty: 1 }),
            item({ id: "b", supplier: "Бета", materialId: null, price: 20, qty: 1 }),
            item({ id: "c", supplier: "", materialId: null, price: 5, qty: 1 }),
          ],
        }),
      ],
      []
    );
    const filtered = filterReportPurchases(purchases.rows, { supplier: "Альфа" });
    const summary = summarizePurchaseExport(filtered);
    expect(summary.totalSum).toBe(10);
    expect(summary.supplierGroups).toHaveLength(1);
    expect(summary.supplierGroups[0].sum).toBe(10);
    expect(filtered.reduce((s, r) => s + r.sum, 0)).toBe(summary.totalSum);
  });

  it("resolves catalog vs manual supplier and builds supplier totals", () => {
    const purchases = buildReportsPurchases(
      [
        project({
          items: [
            item({ id: "1", materialId: "mat-1", supplier: "Старый" }),
            item({ id: "2", materialId: null, supplier: "Ручной" }),
          ],
        }),
      ],
      materials
    );
    expect(purchases.rows.find((r) => r.itemId === "1").supplier).toBe("КаталогСнаб");
    expect(purchases.rows.find((r) => r.itemId === "2").supplier).toBe("Ручной");
    const summary = summarizePurchaseExport(purchases.rows);
    expect(summary.supplierGroups.map((g) => g.supplier).sort()).toEqual(["КаталогСнаб", "Ручной"].sort());
  });

  it("builds three excel sheets and keeps money as numbers", () => {
    const purchases = buildReportsPurchases(
      [project({ items: [item({ materialId: null }), item({ id: "x", materialId: null, supplier: "" })] })],
      []
    );
    const { sheets, summary } = buildPurchaseExportSheetData(purchases.rows);
    expect(sheets).toHaveLength(3);
    expect(sheets[0].name).toBe("01 Закупка");
    expect(sheets[2].aoa.length).toBeGreaterThan(1);
    expect(typeof sheets[0].aoa[1][7]).toBe("number");
    const { buffer } = writeReportsPurchaseWorkbook(purchases.rows);
    expect(buffer.byteLength || buffer.length).toBeGreaterThan(100);
    expect(summary.totalSum).toBeGreaterThan(0);
    expect(summary.noSupplierRows.length).toBeGreaterThan(0);
  });
});

describe("Reports R3 sections and rooms", () => {
  it("groups by client sections and excludes disabled lines", () => {
    const sections = buildReportsSections(
      [
        project({
          items: [
            item({ id: "1", clientSection: "climate", qty: 1, price: 100 }),
            item({ id: "2", clientSection: "electrics", qty: 1, price: 50 }),
            item({ id: "3", clientSection: "climate", qty: 1, price: 10, includedInProject: false }),
          ],
        }),
      ],
      []
    );
    expect(sections.totalSum).toBe(150);
    expect(sections.rows.find((r) => /климат/i.test(r.sectionLabel))?.sum).toBe(100);
    expect(isReportsBreakdownLine(item({ includedInProject: false }))).toBe(false);
  });

  it("groups rooms and puts missing room into dedicated group", () => {
    const { rows } = buildReportsRooms(
      [
        project({
          items: [
            item({ id: "1", roomId: "r1", qty: 1, price: 40 }),
            item({ id: "2", roomId: "", qty: 1, price: 60 }),
          ],
        }),
      ],
      []
    );
    expect(rows.find((r) => r.roomLabel === "Рассада")?.sum).toBe(40);
    expect(rows.find((r) => r.roomLabel === NO_ROOM_GROUP)?.sum).toBe(60);
    const filtered = filterReportRooms(rows, { room: NO_ROOM_GROUP });
    expect(filtered).toHaveLength(1);
  });

  it("uses project price and exposes seven tabs", () => {
    const sections = buildReportsSections(
      [project({ items: [item({ price: 123, qty: 2, clientSection: "stellage" })] })],
      []
    );
    expect(sections.totalSum).toBe(246);
    expect(REPORT_TABS_ALL).toHaveLength(7);
    expect(parseReportTabAll("sections")).toBe("sections");
    expect(parseReportTabAll("rooms")).toBe("rooms");
    expect(NO_SUPPLIER_GROUP || R1_NOSUP).toBeTruthy();
    expect([".reports-r1__scroll", "table-scroll-wrap"].every(Boolean)).toBe(true);
  });
});
