import { describe, expect, it, vi } from "vitest";
import {
  lineVisibleToClient,
  reconcileItemClientVisibilityFlags,
  reconcileProjectItemsVisibility,
  buildClientVisibilityPatch,
  applyClientVisibilityPatch,
} from "../shared/itemTypes.js";
import { buildRefreshPatchForItem } from "../shared/refreshItemFromMaterial.js";
import { buildProjectDashboardSummary } from "../shared/projectDashboardSummary.js";
import { runPrePublishCheck } from "../shared/projectReadiness.js";
import {
  filterClientPurchaseItems,
  prepareClientPurchaseItems,
} from "../shared/clientPurchaseRows.js";
import { mergedPurchaseRows } from "../src/store/helpers.js";
import { buildClientPdfRowLabel } from "../shared/clientPurchaseRows.js";
import { bulkPatchItemsWithFallback } from "../src/lib/projectItemApiFallback.js";
import { mergeFrameBomIntoProjectItems } from "../shared/frameBomProjectItems.js";

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
  visibleToClient: false,
};

const baseItem = (over = {}) => ({
  id: "it_m034",
  materialId: "m034",
  name: m034Material.name,
  qty: 12,
  price: 85,
  supplier: "ВентПро",
  link: "https://example.com/m034",
  includedInProject: true,
  itemType: "material",
  ...over,
});

describe("item client visibility override", () => {
  it("m034 material default hidden + item visibleToClient=true → visible", () => {
    const item = baseItem({ visibleToClient: true, visible: true, approved: true });
    expect(lineVisibleToClient(item, m034Material)).toBe(true);
  });

  it("m034 material default hidden + item visibleToClient=false → hidden", () => {
    const item = baseItem({ visibleToClient: false, visible: false, approved: false });
    expect(lineVisibleToClient(item, m034Material)).toBe(false);
  });

  it("hide payload forces hidden even when material default is visible", () => {
    const material = { id: "m010", visibleToClient: true, clientVisibleDefault: true };
    const shown = baseItem({
      materialId: "m010",
      visibleToClient: true,
      visible: true,
      approved: true,
    });
    const hidden = applyClientVisibilityPatch(shown, buildClientVisibilityPatch(false));
    expect(hidden).toMatchObject({
      visibleToClient: false,
      visible: false,
      approved: false,
      showToClient: false,
      clientVisible: false,
    });
    expect(lineVisibleToClient(hidden, material)).toBe(false);
  });

  it("m034 show/hide patches round-trip via applyClientVisibilityPatch", () => {
    const hidden = applyClientVisibilityPatch(
      baseItem({ visibleToClient: false, visible: false, approved: false }),
      buildClientVisibilityPatch(true)
    );
    expect(lineVisibleToClient(hidden, m034Material)).toBe(true);
    const againHidden = applyClientVisibilityPatch(hidden, buildClientVisibilityPatch(false));
    expect(lineVisibleToClient(againHidden, m034Material)).toBe(false);
  });

  it("m034 material default hidden + no item override → hidden", () => {
    const item = baseItem();
    expect(lineVisibleToClient(item, m034Material)).toBe(false);
  });

  it("legacy stale visible_to_client=false + visible/approved=true → visible", () => {
    const item = baseItem({
      visibleToClient: false,
      visible: true,
      approved: true,
    });
    expect(lineVisibleToClient(item, m034Material)).toBe(true);
    const reconciled = reconcileItemClientVisibilityFlags(item, m034Material);
    expect(reconciled.visibleToClient).toBe(true);
    expect(reconciled.visible).toBe(true);
    expect(reconciled.approved).toBe(true);
  });

  it("hide with showToClient:false wins over stale visible/approved true", () => {
    const item = {
      ...baseItem({ visibleToClient: false, visible: true, approved: true }),
      showToClient: false,
      clientVisible: false,
    };
    expect(lineVisibleToClient(item)).toBe(false);
  });

  it("refreshItemFromMaterial does not reset visibleToClient=true", () => {
    const item = baseItem({ visibleToClient: true });
    const patch = buildRefreshPatchForItem(item, m034Material, ["price"]);
    expect(patch).toEqual({ price: 85 });
    expect(patch.visibleToClient).toBeUndefined();
    const refreshed = reconcileItemClientVisibilityFlags({ ...item, ...patch }, m034Material);
    expect(refreshed.visibleToClient).toBe(true);
  });

  it("bulk fallback show-to-client sets visible for hidden-default material", async () => {
    const calls = [];
    const request = vi.fn(async (path, opts) => {
      calls.push({ path, opts });
      if (path.endsWith("/bulk-patch")) {
        const err = new Error("HTTP 404");
        err.status = 404;
        throw err;
      }
      return {
        id: "it_fbom:d1:rack1:m034",
        materialId: "m034",
        visibleToClient: false,
        visible: true,
        approved: true,
        includedInProject: true,
        ...opts.body,
      };
    });

    const res = await bulkPatchItemsWithFallback(request, "p1", {
      itemIds: ["it_fbom:d1:rack1:m034"],
      patch: { visibleToClient: true, visible: true, approved: true },
    });

    expect(res.fallback).toBe(true);
    expect(res.updated[0].visibleToClient).toBe(true);
    expect(calls.some((c) => c.path.includes(encodeURIComponent("it_fbom:d1:rack1:m034")))).toBe(true);
  });

  it("dashboard summary counts m034 as clientVisible when item override true", () => {
    const summary = buildProjectDashboardSummary([
      baseItem({ visibleToClient: true, visible: true, approved: true }),
      baseItem({ id: "other", materialId: "m010", visibleToClient: false, visible: false, approved: false }),
    ]);
    expect(summary.clientVisibleItems).toBe(1);
    expect(summary.hiddenFromClientItems).toBe(1);
  });

  it("client purchase rows include m034 when item override true", () => {
    const items = [baseItem({ visibleToClient: true, visible: true, approved: true })];
    expect(filterClientPurchaseItems(items)).toHaveLength(1);
    const rows = prepareClientPurchaseItems(items, [m034Material]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toContain("Соединитель");
  });

  it("publish/readiness does not report hidden_from_client for m034 override true", () => {
    const item = baseItem({
      visibleToClient: true,
      visible: true,
      approved: true,
      imageUrl: "/photos/m034.jpg",
      clientSection: "trays_channels",
      clientSubsection: "NFT-каналы",
    });
    const res = runPrePublishCheck([item]);
    expect(res.problems.some((p) => p.issue === "hidden_from_client")).toBe(false);
    expect(res.problems.some((p) => p.issue === "not_approved")).toBe(false);
  });

  it("PDF/Excel client rows include m034 when override true", () => {
    const rows = prepareClientPurchaseItems(
      [baseItem({ visibleToClient: true, visible: true, approved: true })],
      [m034Material]
    );
    const merged = mergedPurchaseRows(rows);
    expect(merged).toHaveLength(1);
    expect(buildClientPdfRowLabel(merged[0])).toContain("Соединитель");
  });

  it("no regression for normal visible materials", () => {
    const item = {
      id: "it_norm",
      materialId: "m010",
      name: "Воздуховод",
      qty: 2,
      price: 100,
      includedInProject: true,
      visibleToClient: true,
      itemType: "material",
    };
    const mat = { id: "m010", clientVisibleDefault: true };
    expect(lineVisibleToClient(item, mat)).toBe(true);
    expect(filterClientPurchaseItems([item])).toHaveLength(1);
  });

  it("reconcileProjectItemsVisibility fixes legacy mismatch after load", () => {
    const project = {
      id: "p1",
      items: [
        baseItem({
          visibleToClient: false,
          visible: true,
          approved: true,
        }),
      ],
    };
    const next = reconcileProjectItemsVisibility(project, [m034Material]);
    expect(next.items[0].visibleToClient).toBe(true);
  });

  it("frame BOM re-merge preserves visibleToClient override", () => {
    const existing = [
      baseItem({
        id: "it_fbom_d1_rack1_air_duct_connector_55x110",
        source: "frame_bom",
        sourceKey: "frame_bom:d1:rack1:air_duct_connector_55x110",
        sourceObjectIds: { moduleRackKey: "rack1", bomKey: "air_duct_connector_55x110" },
        visibleToClient: true,
        visible: true,
        approved: true,
      }),
    ];
    const result = mergeFrameBomIntoProjectItems(
      existing,
      [{ key: "air_duct_connector_55x110", materialId: "m034", qty: 12, unit: "шт" }],
      {
        drawingId: "d1",
        moduleRackKey: "rack1",
        materials: [m034Material],
      }
    );
    const row = result.items.find((it) => it.materialId === "m034");
    expect(row.visibleToClient).toBe(true);
    expect(lineVisibleToClient(row, m034Material)).toBe(true);
  });
});
