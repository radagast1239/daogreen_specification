import { describe, expect, it } from "vitest";
import { mergeFrameBomIntoProjectItems } from "../shared/frameBomProjectItems.js";
import { mergedPurchaseRows } from "../src/store/helpers.js";
import { clientPurchaseItems } from "../src/lib/itemHelpers.js";
import {
  buildClientPdfRowLabel,
  clientPdfRowHasTechnicalFields,
  enrichClientPurchaseItem,
  filterClientPurchaseItems,
  NFT_CHANNEL_CLIENT_NOTE,
  prepareClientPurchaseItem,
  prepareClientPurchaseItems,
  stripClientTechnicalFields,
} from "../shared/clientPurchaseRows.js";
import { clientPdfNameCol } from "../src/lib/clientPdfExport.js";
import { lineVisibleToClient } from "../shared/itemTypes.js";

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
    clientVisibleDefault: true,
  },
  {
    id: "m034",
    name: "Соединитель пластикового воздуховода 55×110 мм",
    unit: "шт",
    basePrice: 85,
    supplier: "ВентПро",
    link: "https://example.com/m034",
    photoUrl: "/photos/m034.jpg",
    clientSection: "trays_channels",
    clientSubsection: "NFT-каналы",
    clientVisibleDefault: false,
  },
  {
    id: "m010",
    name: "Воздуховод пластиковый 55×110 мм, L=2000 мм",
    unit: "шт",
    basePrice: 450,
    supplier: "ВентПро",
    link: "https://example.com/m010",
    imageUrl: "/photos/m010.jpg",
    clientSection: "trays_channels",
    clientSubsection: "NFT-каналы",
    clientVisibleDefault: true,
  },
  {
    id: "m072",
    name: "Краб-система Г-образная 20×20, 1.2 мм",
    unit: "шт",
    basePrice: 45,
    supplier: "КрепёжПро",
    link: "https://example.com/crab",
    photoUrl: "/photos/m072.jpg",
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

function tubeDraft() {
  return {
    key: "profile_tube_20x20",
    materialId: "m036",
    qty: 88.32,
    unit: "м",
    pipeCuts: TUBE_CUTS,
    techNote: "Резы профтрубы: 3200 мм × 6 шт",
  };
}

function nftConnectorDraft() {
  return {
    key: "air_duct_connector_55x110",
    materialId: "m034",
    qty: 12,
    unit: "шт",
    techNote: NFT_CHANNEL_CLIENT_NOTE,
    clientNote: NFT_CHANNEL_CLIENT_NOTE,
  };
}

function buildFrameBomProjectItems() {
  return mergeFrameBomIntoProjectItems(
    [],
    [tubeDraft(), nftConnectorDraft(), { key: "crab_g", materialId: "m072", qty: 9, unit: "шт" }],
    baseOpts,
  ).items;
}

describe("client purchase rows — frame_bom", () => {
  it("includes frame_bom items in client purchase pool", () => {
    const items = buildFrameBomProjectItems();
    const purchase = clientPurchaseItems({ items });
    expect(purchase.some((i) => i.materialId === "m036")).toBe(true);
    expect(purchase.some((i) => i.materialId === "m072")).toBe(true);
    expect(purchase.filter((i) => i.source === "frame_bom")).toHaveLength(3);
  });

  it("keeps material snapshot fields after client prepare", () => {
    const raw = buildFrameBomProjectItems().find((i) => i.materialId === "m036");
    const row = prepareClientPurchaseItem(raw, catalogMaterials);
    expect(row.price).toBe(120);
    expect(row.supplier).toBe("МеталлБаза");
    expect(row.link).toBe("https://example.com/tube");
    expect(row.imageUrl).toBe("/photos/m036.jpg");
    expect(row.clientSection).toBe("stellage");
    expect(row.clientSubsection).toBe("Каркас и профиль");
    expect(row.source).toBeUndefined();
    expect(row.sourceKey).toBeUndefined();
    expect(row.materialId).toBeUndefined();
  });

  it("explicit visibleToClient=true shows m034 even if material default hidden", () => {
    const raw = buildFrameBomProjectItems().find((i) => i.materialId === "m034");
    expect(raw.visibleToClient).toBe(true);
    expect(lineVisibleToClient(raw)).toBe(true);
    const visible = filterClientPurchaseItems([raw]);
    expect(visible).toHaveLength(1);
    const row = prepareClientPurchaseItem(raw, catalogMaterials);
    expect(row.name).toContain("Соединитель");
    expect(row.supplier).toBe("ВентПро");
  });

  it("m036 pipeCuts remain in client rows and merged clientNote", () => {
    const items = buildFrameBomProjectItems().map((it) => prepareClientPurchaseItem(it, catalogMaterials));
    const tube = items.find((i) => (i.name || "").includes("Труба профильная"));
    expect(tube.pipeCuts).toEqual(TUBE_CUTS);
    expect(tube.clientNote).toContain("3200 мм");
    const merged = mergedPurchaseRows(items);
    expect(merged).toHaveLength(3);
    const tubeRow = merged.find((r) => (r.name || "").includes("Труба профильная"));
    expect(tubeRow.clientNote).toContain("3200 мм");
    expect(tubeRow.pipeCuts?.length).toBe(3);
  });

  it("m010/m034 show NFT channel note for client", () => {
    const raw = buildFrameBomProjectItems().find((i) => i.materialId === "m034");
    const row = enrichClientPurchaseItem(raw, catalogMaterials);
    expect(row.clientNote).toContain("NFT-канал");
  });

  it("client PDF label includes pipeCuts note without technical fields", () => {
    const items = prepareClientPurchaseItems(buildFrameBomProjectItems(), catalogMaterials);
    const merged = mergedPurchaseRows(items);
    const tubeRow = merged.find((r) => (r.name || "").includes("Труба профильная"));
    const label = buildClientPdfRowLabel(tubeRow);
    expect(label).toContain("Труба профильная");
    expect(label).toContain("3200 мм");
    expect(label).not.toMatch(/frame_bom|sourceKey/i);
    expect(clientPdfNameCol(tubeRow)).toContain("3200 мм");
    expect(clientPdfRowHasTechnicalFields(tubeRow)).toBe(false);
  });

  it("does not expose frame_bom technical keys after strip", () => {
    const raw = buildFrameBomProjectItems()[0];
    const stripped = stripClientTechnicalFields(raw);
    expect(JSON.stringify(stripped)).not.toMatch(/frame_bom|sourceKey|drawingId|moduleRackKey/i);
  });

  it("skips fake rows without materialId in enrich", () => {
    const row = prepareClientPurchaseItem(
      { id: "x", name: "Без материала", qty: 1, visibleToClient: true, itemType: "material" },
      catalogMaterials,
    );
    expect(row.name).toBe("Без материала");
    expect(Number(row.price) || 0).toBe(0);
    expect(row.supplier || "").toBe("");
  });
});
