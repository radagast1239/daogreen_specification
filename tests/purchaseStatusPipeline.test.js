import { describe, expect, it, beforeEach } from "vitest";
import { configureClientSections, DEFAULT_CLIENT_SECTIONS } from "../shared/clientSections.js";
import { mergeFrameBomIntoProjectItems } from "../shared/frameBomProjectItems.js";
import { mergedPurchaseRows, projectTotals } from "../src/store/helpers.js";
import {
  buildClientPdfRowLabel,
  prepareClientPurchaseItem,
  prepareClientPurchaseItems,
  resolveClientPurchaseStatusLabel,
} from "../shared/clientPurchaseRows.js";
import { clientPdfNameCol } from "../src/lib/clientPdfExport.js";
import { buildClientWorkbook } from "../src/lib/clientExcelExport.js";
import { runPrePublishCheck } from "../shared/projectReadiness.js";
import { PURCHASE_STATUSES } from "../src/data/modules.js";
import * as XLSX from "xlsx";

beforeEach(() => {
  configureClientSections(DEFAULT_CLIENT_SECTIONS);
});

const catalogMaterials = [
  {
    id: "m036",
    name: "Труба профильная 20/20/1,5 мм",
    unit: "м",
    basePrice: 120,
    supplier: "МеталлБаза",
    link: "https://example.com/tube",
    imageUrl: "/photos/m036.jpg",
    clientSection: "stellage",
    clientSubsection: "Каркас и профиль",
  },
  {
    id: "m072",
    name: "Краб-система",
    unit: "шт",
    basePrice: 45,
    supplier: "КрепёжПро",
    link: "https://example.com/crab",
    clientSection: "stellage",
    clientSubsection: "Краб-система / соединители",
  },
];

const baseOpts = {
  drawingId: "d1",
  moduleRackKey: "rack1",
  rackLabel: "Стеллаж 1",
  materials: catalogMaterials,
};

function tubeDraft(qty = 10) {
  return {
    key: "profile_tube_20x20",
    materialId: "m036",
    qty,
    pipeCuts: [{ lengthMm: 3200, qty: 6 }],
    techNote: "Резы профтрубы: 3200 мм × 6 шт",
  };
}

function manualItem(over = {}) {
  return {
    id: "manual1",
    name: "Ручная позиция",
    unit: "шт",
    qty: 1,
    price: 100,
    itemType: "material",
    includedInProject: true,
    visibleToClient: true,
    clientSection: "stellage",
    clientSubsection: "Каркас и профиль",
    supplier: "Поставщик",
    link: "https://example.com/item",
    status: "ordered",
    ...over,
  };
}

describe("purchase status pipeline", () => {
  it("prepareClientPurchaseItem exposes human statusLabel without tech fields", () => {
    const row = prepareClientPurchaseItem(
      {
        id: "x",
        name: "Тест",
        qty: 1,
        price: 10,
        status: "bought",
        source: "frame_bom",
        sourceKey: "frame_bom:d1:rack1:profile_tube_20x20",
        materialId: "m036",
        itemType: "material",
        visibleToClient: true,
      },
      catalogMaterials,
    );
    expect(row.statusLabel).toBe("Куплено");
    expect(JSON.stringify(row)).not.toMatch(/frame_bom|sourceKey|not_bought/);
  });

  it("merged rows with same status show one label", () => {
    const base = {
      name: "Краб",
      unit: "шт",
      supplier: "A",
      link: "https://a",
      price: 10,
      itemType: "material",
      includedInProject: true,
      visibleToClient: true,
    };
    const rows = mergedPurchaseRows([
      { ...base, id: "1", module: "M1", qty: 1, status: "bought" },
      { ...base, id: "2", module: "M2", qty: 2, status: "bought" },
    ]);
    expect(rows).toHaveLength(1);
    expect(resolveClientPurchaseStatusLabel(rows[0])).toBe("Куплено");
  });

  it("merged rows with different statuses get statusSummary", () => {
    const base = {
      name: "Краб",
      unit: "шт",
      supplier: "A",
      link: "https://a",
      price: 10,
      itemType: "material",
      includedInProject: true,
      visibleToClient: true,
    };
    const rows = mergedPurchaseRows([
      { ...base, id: "1", module: "M1", qty: 1, status: "bought" },
      { ...base, id: "2", module: "M2", qty: 2, status: "not_bought" },
    ]);
    expect(rows[0].statusSummary.mixed).toBe(true);
    expect(resolveClientPurchaseStatusLabel(rows[0])).toContain("Смешанный статус");
  });

  it("PDF label includes human-readable status and keeps pipeCuts", () => {
    const items = prepareClientPurchaseItems(
      mergeFrameBomIntoProjectItems([], [tubeDraft()], baseOpts).items.map((it) => ({
        ...it,
        status: "bought",
      })),
      catalogMaterials,
    );
    const merged = mergedPurchaseRows(items);
    const label = buildClientPdfRowLabel(merged[0]);
    expect(label).toContain("Статус: Куплено");
    expect(label).toContain("3200 мм");
    expect(label).not.toMatch(/not_bought|frame_bom|sourceKey/i);
    expect(clientPdfNameCol(merged[0])).toContain("Куплено");
  });

  it("Excel contains Статус закупки column with Russian labels", () => {
    const items = prepareClientPurchaseItems(
      [
        manualItem({ status: "not_fit", name: "Не подходит позиция" }),
        manualItem({ id: "m2", status: "have", name: "Уже есть позиция" }),
      ],
      catalogMaterials,
    );
    const wb = buildClientWorkbook({ currency: "₽", name: "P" }, items, {
      purchaseStatuses: PURCHASE_STATUSES,
    });
    const sheet = wb.Sheets["04 К закупке по разделам"];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const headers = data[0];
    expect(headers).toContain("Статус закупки");
    const statusCol = headers.indexOf("Статус закупки");
    const body = data.slice(1).map((row) => row[statusCol]);
    expect(body.some((v) => String(v).includes("Не подходит"))).toBe(true);
    expect(body.some((v) => String(v).includes("Уже есть"))).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/not_fit|have/);
  });

  it("readiness warnings for purchase statuses", () => {
    const mk = (status) => ({
      id: `i-${status}`,
      name: `Item ${status}`,
      qty: 1,
      price: 100,
      supplier: "S",
      link: "https://x",
      photoUrl: "/p.jpg",
      itemType: "material",
      includedInProject: true,
      visibleToClient: true,
      clientSection: "stellage",
      clientSubsection: "Каркас и профиль",
      status,
    });

    const help = runPrePublishCheck([mk("need_help")], {});
    expect(help.warnings.some((w) => w.issue === "problematic")).toBe(true);

    const replacement = runPrePublishCheck([mk("replacement_check")], {});
    expect(replacement.warnings.some((w) => w.issue === "on_review")).toBe(true);

    const notFit = runPrePublishCheck([mk("not_fit")], {});
    expect(notFit.critical.some((w) => w.issue === "purchase_not_fit")).toBe(true);

    const searching = runPrePublishCheck([mk("searching")], {});
    expect(searching.warnings.some((w) => w.issue === "purchase_searching")).toBe(true);

    const have = runPrePublishCheck([mk("have")], {});
    expect(have.critical).toHaveLength(0);

    const bought = runPrePublishCheck([mk("bought")], {});
    expect(bought.critical).toHaveLength(0);
    expect(bought.warnings.filter((w) => w.issue.startsWith("purchase_"))).toHaveLength(0);
  });

  it("projectTotals excludes have from obligation remaining", () => {
    const project = {
      currency: "₽",
      items: [
        manualItem({ id: "a", status: "not_bought", price: 1000, qty: 1 }),
        manualItem({ id: "b", status: "have", price: 500, qty: 1 }),
        manualItem({ id: "c", status: "bought", price: 200, qty: 1, actualPrice: 200 }),
      ],
    };
    const t = projectTotals(project);
    expect(t.remaining).toBe(800);
  });
});

describe("BOM replace preserves purchase status", () => {
  it("re-save preserves status for same bomKey", () => {
    const first = mergeFrameBomIntoProjectItems([], [tubeDraft(10)], baseOpts);
    const withStatus = first.items.map((it) =>
      it.materialId === "m036" ? { ...it, status: "bought", purchaseStatus: "bought" } : it,
    );
    const second = mergeFrameBomIntoProjectItems(withStatus, [tubeDraft(12)], baseOpts);
    const tube = second.items.find((i) => i.materialId === "m036" && i.source === "frame_bom");
    expect(tube.status).toBe("bought");
    expect(tube.qty).toBe(12);
  });

  it("removed BOM line drops status with item", () => {
    const first = mergeFrameBomIntoProjectItems(
      [],
      [tubeDraft(), { key: "crab_g", materialId: "m072", qty: 4, unit: "шт" }],
      baseOpts,
    );
    const withStatus = first.items.map((it) => ({ ...it, status: "bought" }));
    const second = mergeFrameBomIntoProjectItems(withStatus, [tubeDraft()], baseOpts);
    expect(second.items.some((i) => i.materialId === "m072")).toBe(false);
  });

  it("does not transfer status to different bomKey/material", () => {
    const first = mergeFrameBomIntoProjectItems([], [tubeDraft()], baseOpts);
    const withStatus = first.items.map((it) => ({ ...it, status: "bought" }));
    const second = mergeFrameBomIntoProjectItems(
      withStatus,
      [{ key: "crab_g", materialId: "m072", qty: 4, unit: "шт" }],
      baseOpts,
    );
    const crab = second.items.find((i) => i.materialId === "m072");
    expect(crab.status).toBe("not_bought");
  });

  it("manual item status is not touched by BOM replace", () => {
    const manual = manualItem({ status: "need_help" });
    const first = mergeFrameBomIntoProjectItems([manual], [tubeDraft()], baseOpts);
    const second = mergeFrameBomIntoProjectItems(
      first.items.map((it) => (it.id === manual.id ? { ...it, status: "need_help" } : it)),
      [tubeDraft(5)],
      baseOpts,
    );
    expect(second.items.find((i) => i.id === manual.id)?.status).toBe("need_help");
  });
});
