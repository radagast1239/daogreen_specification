import { describe, expect, it, beforeEach } from "vitest";
import { configureClientSections, DEFAULT_CLIENT_SECTIONS } from "../shared/clientSections.js";
import { FRAME_BOM_SOURCE } from "../shared/frameBomProjectItems.js";
import { PURCHASE_STATUS } from "../shared/purchaseStatusRules.js";
import { lineVisibleToClient } from "../shared/itemTypes.js";
import {
  buildClientPurchaseSummary,
  buildClientDeliveryPreviewRows,
  resolveClientDeliverySourceLabel,
} from "../shared/clientPurchaseSummary.js";
import { buildClientPurchaseMergedRows } from "../shared/clientPurchaseMerged.js";
import { buildClientPurchaseMergedRows as helpersMerged } from "../src/store/helpers.js";
import { CLIENT_DELIVERY_FILTERS, resolveDashboardFilterLabel } from "../shared/projectDashboardSummary.js";
import { matchSpecLineFilter } from "../shared/specLineFilters.js";
import { formatPipeCutsNote } from "../shared/clientPurchaseRows.js";

beforeEach(() => {
  configureClientSections(DEFAULT_CLIENT_SECTIONS);
});

const m034Material = {
  id: "m034",
  name: "Соединитель пластикового воздуховода 55×110 мм",
  unit: "шт",
  basePrice: 85,
  supplier: "ВентПро",
  link: "https://example.com/m034",
  clientSection: "trays_channels",
  clientSubsection: "NFT-каналы",
  clientVisibleDefault: false,
};

function baseItem(over = {}) {
  return {
    id: over.id || "it1",
    name: "Болт M6",
    unit: "шт",
    qty: 2,
    price: 50,
    itemType: "material",
    includedInProject: true,
    visibleToClient: true,
    clientSection: "stellage",
    clientSubsection: "Каркас и профиль",
    supplier: "КрепёжПро",
    link: "https://example.com/bolt",
    purchaseStatus: PURCHASE_STATUS.NOT_BOUGHT,
    ...over,
  };
}

describe("buildClientPurchaseSummary", () => {
  it("counts only client-visible purchasable rows", () => {
    const items = [
      baseItem({ id: "a" }),
      baseItem({ id: "b", visibleToClient: false }),
      baseItem({ id: "c", includedInProject: false }),
    ];
    const s = buildClientPurchaseSummary(items);
    expect(s.totalClientItems).toBe(1);
    expect(s.hiddenItems).toBe(1);
  });

  it("excludes hidden rows from purchase total", () => {
    const items = [
      baseItem({ id: "vis", qty: 1, price: 100 }),
      baseItem({ id: "hid", visibleToClient: false, qty: 1, price: 500 }),
    ];
    const s = buildClientPurchaseSummary(items);
    expect(s.purchaseTotal).toBe(100);
  });

  it("noPrice does not treat missing price as free", () => {
    const items = [
      baseItem({ name: "Без цены", price: 0 }),
      baseItem({ id: "ok", name: "С ценой", price: 40, qty: 1 }),
    ];
    const s = buildClientPurchaseSummary(items);
    expect(s.noPrice).toBe(1);
    expect(s.purchaseTotal).toBe(40);
  });

  it("counts noLink and noSupplier among client items", () => {
    const items = [
      baseItem({ link: "" }),
      baseItem({ id: "s", supplier: "" }),
    ];
    const s = buildClientPurchaseSummary(items);
    expect(s.noLink).toBe(1);
    expect(s.noSupplier).toBe(1);
  });

  it("counts frame BOM items", () => {
    const items = [
      baseItem(),
      baseItem({ id: "bom", source: FRAME_BOM_SOURCE, sourceType: FRAME_BOM_SOURCE }),
    ];
    const s = buildClientPurchaseSummary(items);
    expect(s.frameBomItems).toBe(1);
  });

  it("counts frame BOM items without source field (production-style)", () => {
    const items = [
      baseItem(),
      baseItem({ id: "frame_bom:d1:rack1:bolt_m6", sourceKey: "frame_bom:d1:rack1:bolt_m6" }),
      baseItem({
        id: "crab",
        sourceKey: "frame_bom:d1:rack1:crab_t",
        sourceObjectIds: { moduleRackKey: "rack1", bomKey: "crab_t" },
      }),
    ];
    const s = buildClientPurchaseSummary(items);
    expect(s.frameBomItems).toBe(2);
  });

  it("purchaseClosed counts bought + delivered + have", () => {
    const items = [
      baseItem({ purchaseStatus: PURCHASE_STATUS.BOUGHT }),
      baseItem({ id: "d", purchaseStatus: PURCHASE_STATUS.DELIVERED }),
      baseItem({ id: "h", purchaseStatus: PURCHASE_STATUS.HAVE }),
      baseItem({ id: "o", purchaseStatus: PURCHASE_STATUS.NOT_BOUGHT }),
    ];
    const s = buildClientPurchaseSummary(items);
    expect(s.purchaseClosed).toBe(3);
    expect(s.purchaseTotalItems).toBe(4);
  });

  it("m034 override true is included in client summary", () => {
    const item = {
      id: "it_m034",
      materialId: "m034",
      name: m034Material.name,
      qty: 12,
      price: 85,
      supplier: "ВентПро",
      link: "https://example.com/m034",
      includedInProject: true,
      itemType: "material",
      visibleToClient: true,
      visible: true,
      approved: true,
    };
    const s = buildClientPurchaseSummary([item], [m034Material]);
    expect(lineVisibleToClient(item, m034Material)).toBe(true);
    expect(s.totalClientItems).toBe(1);
    expect(s.hiddenItems).toBe(0);
    expect(s.purchaseTotal).toBe(12 * 85);
  });

  it("m034 override false is excluded", () => {
    const item = {
      id: "it_m034",
      materialId: "m034",
      name: m034Material.name,
      qty: 12,
      price: 85,
      includedInProject: true,
      itemType: "material",
      visibleToClient: false,
    };
    const s = buildClientPurchaseSummary([item], [m034Material]);
    expect(s.totalClientItems).toBe(0);
    expect(s.hiddenItems).toBe(1);
  });
});

describe("client delivery preview", () => {
  it("preview rows use same merged rows as helpers/PDF pipeline", () => {
    const items = [
      baseItem({ id: "a", name: "Болт", qty: 1, price: 10 }),
      baseItem({ id: "b", name: "Болт", qty: 2, price: 10, module: "М2" }),
    ];
    const prepared = items;
    expect(buildClientPurchaseMergedRows(prepared).length).toBe(helpersMerged(prepared).length);
    const preview = buildClientDeliveryPreviewRows(items);
    expect(preview).toHaveLength(1);
    expect(preview[0].qty).toBe(3);
  });

  it("pipeCuts survive into preview note", () => {
    const items = [
      baseItem({
        name: "Труба профиль 20×20",
        pipeCuts: [{ lengthMm: 3200, qty: 6 }],
      }),
    ];
    const preview = buildClientDeliveryPreviewRows(items);
    expect(preview[0].note).toContain("3200");
    expect(preview[0].note).toBe(formatPipeCutsNote([{ lengthMm: 3200, qty: 6 }]));
  });

  it("BOM sourceKey with colon shows frame source label", () => {
    const item = baseItem({
      source: FRAME_BOM_SOURCE,
      sourceType: FRAME_BOM_SOURCE,
      sourceKey: "frame_bom:draw:1:rack-a",
    });
    expect(resolveClientDeliverySourceLabel(item)).toMatch(/схемы/i);
    const preview = buildClientDeliveryPreviewRows([item]);
    expect(preview[0].sourceLabel).toMatch(/схемы/i);
  });

  it("BOM without source field shows frame source label", () => {
    const item = baseItem({
      id: "frame_bom:d1:rack1:bolt_m6",
      sourceKey: "frame_bom:d1:rack1:bolt_m6",
    });
    expect(resolveClientDeliverySourceLabel(item)).toMatch(/схемы/i);
    const preview = buildClientDeliveryPreviewRows([item]);
    expect(preview[0].sourceLabel).toMatch(/схемы/i);
  });
});

describe("client delivery filters", () => {
  it("CLIENT_DELIVERY_FILTERS map to spec line filters", () => {
    const hidden = baseItem({ visibleToClient: false });
    const noLink = baseItem({ id: "nl", link: "" });
    expect(matchSpecLineFilter(hidden, "client_hidden", "project")).toBe(true);
    expect(matchSpecLineFilter(noLink, "no_link", "project")).toBe(true);
    expect(matchSpecLineFilter(baseItem({ purchaseStatus: PURCHASE_STATUS.ORDERED }), "ordered", "project")).toBe(
      true
    );
    expect(
      matchSpecLineFilter(baseItem({ purchaseStatus: PURCHASE_STATUS.BOUGHT }), "purchase_closed", "project")
    ).toBe(true);
  });

  it("resolveDashboardFilterLabel works for delivery filters", () => {
    const row = CLIENT_DELIVERY_FILTERS.find((f) => f.id === "no_link");
    expect(resolveDashboardFilterLabel("no_link")).toBe(row.label);
  });
});
