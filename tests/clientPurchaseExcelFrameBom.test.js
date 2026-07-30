import { describe, expect, it, beforeEach } from "vitest";
import * as XLSX from "xlsx";
import { mergeFrameBomIntoProjectItems } from "../shared/frameBomProjectItems.js";
import { buildClientWorkbook } from "../src/lib/clientExcelExport.js";
import { buildClientPurchaseMergedRows } from "../src/store/helpers.js";
import {
  CLIENT_PRICE_MISSING,
  CLIENT_PRICE_TBD,
  formatClientLineTotal,
  formatClientUnitPrice,
  NFT_CHANNEL_CLIENT_NOTE,
  prepareClientPurchaseItems,
} from "../shared/clientPurchaseRows.js";
import { configureClientSections, DEFAULT_CLIENT_SECTIONS } from "../shared/clientSections.js";
import { PURCHASE_STATUSES } from "../src/data/modules.js";

const TUBE_CUTS = [
  { lengthMm: 3200, qty: 6 },
  { lengthMm: 1470, qty: 32 },
  { lengthMm: 460, qty: 48 },
];

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
    id: "m034",
    name: "Соединитель пластикового воздуховода 55×110 мм",
    unit: "шт",
    basePrice: 85,
    supplier: "ВентПро",
    link: "https://example.com/m034",
    clientSection: "trays_channels",
    clientSubsection: "NFT-каналы",
    clientVisibleDefault: false,
  },
  {
    id: "m072",
    name: "Краб-система Г-образная 20×20, 1.2 мм",
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

function bomItems() {
  return mergeFrameBomIntoProjectItems(
    [],
    [
      {
        key: "profile_tube_20x20",
        materialId: "m036",
        qty: 88.32,
        unit: "м",
        pipeCuts: TUBE_CUTS,
      },
      {
        key: "air_duct_connector_55x110",
        materialId: "m034",
        qty: 12,
        unit: "шт",
        clientNote: NFT_CHANNEL_CLIENT_NOTE,
        techNote: NFT_CHANNEL_CLIENT_NOTE,
      },
      { key: "crab_g", materialId: "m072", qty: 9, unit: "шт" },
    ],
    baseOpts,
  ).items;
}

function sheetCsv(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return "";
  return XLSX.utils.sheet_to_csv(ws);
}

beforeEach(() => {
  configureClientSections(DEFAULT_CLIENT_SECTIONS);
});

describe("client Excel — frame_bom", () => {
  it("includes frame_bom rows in merged purchase sheet", () => {
    const items = prepareClientPurchaseItems(bomItems(), catalogMaterials);
    const merged = buildClientPurchaseMergedRows(items);
    expect(merged).toHaveLength(3);
    const wb = buildClientWorkbook({ name: "P", version: 1 }, items, {
      purchaseStatuses: PURCHASE_STATUSES,
    });
    const csv = sheetCsv(wb, "04 К закупке по разделам");
    expect(csv).toContain("Труба профильная");
    expect(csv).toContain("Соединитель пластикового");
    expect(csv).toContain("Краб-система");
    expect(csv).not.toMatch(/frame_bom|sourceKey|drawingId/i);
  });

  it("m036 Excel row contains pipeCuts note and correct totals", () => {
    const items = prepareClientPurchaseItems(bomItems(), catalogMaterials);
    const tube = buildClientPurchaseMergedRows(items).find((r) =>
      (r.name || "").includes("Труба профильная"),
    );
    expect(tube.clientNote).toContain("3200 мм");
    expect(formatClientUnitPrice(tube)).toBe(120);
    expect(formatClientLineTotal(tube)).toBe(Math.round(88.32 * 120));
    const wb = buildClientWorkbook({ name: "P", version: 1 }, items, {
      purchaseStatuses: PURCHASE_STATUSES,
    });
    const csv = sheetCsv(wb, "04 К закупке по разделам");
    expect(csv).toContain("3200 мм");
    expect(csv).toContain("МеталлБаза");
    expect(csv).toContain("Открыть товар");
  });

  it("m034 shows NFT note and material fields despite hidden default", () => {
    const items = prepareClientPurchaseItems(bomItems(), catalogMaterials);
    const duct = buildClientPurchaseMergedRows(items).find((r) =>
      (r.name || "").includes("Соединитель"),
    );
    expect(duct.clientNote).toContain("NFT-канал");
    expect(duct.clientSectionLabel).toMatch(/Лотки|канал/i);
    expect(duct.clientSubsection).toBe("NFT-каналы");
    expect(formatClientUnitPrice(duct)).toBe(85);
  });

  it("missing price shows Без цены, not zero", () => {
    const row = { name: "Без цены", qty: 2, price: null, unit: "шт." };
    expect(formatClientUnitPrice(row)).toBe(CLIENT_PRICE_MISSING);
    expect(formatClientLineTotal(row)).toBe("");
  });

  it("explicit price 0 shows 0", () => {
    const row = { name: "Бесплатно", qty: 2, price: 0, unit: "шт." };
    expect(formatClientUnitPrice(row)).toBe(0);
    expect(formatClientLineTotal(row)).toBe(0);
  });

  it("cooling_spec without price shows цена уточняется", () => {
    const row = {
      name: "Сплит",
      qty: 1,
      price: null,
      sumVat: 0,
      sourceItems: [{ kind: "cooling_spec" }],
    };
    expect(formatClientUnitPrice(row)).toBe(CLIENT_PRICE_TBD);
    expect(formatClientLineTotal(row)).toBe(CLIENT_PRICE_TBD);
  });

  it("cooling_spec with explicit price 0 shows 0 (not TBD)", () => {
    const row = {
      name: "Сплит",
      qty: 1,
      price: 0,
      sumVat: 0,
      sourceItems: [{ kind: "cooling_spec" }],
    };
    expect(formatClientUnitPrice(row)).toBe(0);
    expect(formatClientLineTotal(row)).toBe(0);
  });

  it("groups by section then subsection in sheet 04", () => {
    const items = prepareClientPurchaseItems(bomItems(), catalogMaterials);
    const wb = buildClientWorkbook({ name: "P", version: 1 }, items, {
      purchaseStatuses: PURCHASE_STATUSES,
    });
    const csv = sheetCsv(wb, "04 К закупке по разделам");
    const stIdx = csv.indexOf("Стеллажи и каркас");
    const trayIdx = csv.indexOf("Лотки, поддоны и каналы");
    const tubeIdx = csv.indexOf("Труба профильная");
    const ductIdx = csv.indexOf("Соединитель пластикового");
    expect(stIdx).toBeGreaterThan(-1);
    expect(trayIdx).toBeGreaterThan(-1);
    expect(tubeIdx).toBeLessThan(trayIdx);
    expect(ductIdx).toBeGreaterThan(trayIdx);
  });

  it("merges same materialId from two racks when supplier/link match", () => {
    const rack1 = prepareClientPurchaseItems(bomItems(), catalogMaterials);
    const rack2Items = mergeFrameBomIntoProjectItems(
      [],
      [{ key: "crab_g", materialId: "m072", qty: 3, unit: "шт" }],
      { ...baseOpts, moduleRackKey: "rack2", rackLabel: "Стеллаж 2" },
    ).items;
    const rack2 = prepareClientPurchaseItems(rack2Items, catalogMaterials);
    const merged = buildClientPurchaseMergedRows([...rack1, ...rack2]);
    const crab = merged.find((r) => (r.name || "").includes("Краб"));
    expect(crab.qty).toBe(12);
    expect(crab.sourceItems).toHaveLength(2);
  });
});
