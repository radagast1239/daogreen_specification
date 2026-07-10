import { describe, expect, it, vi } from "vitest";
import {
  applyFrameBomRefreshRepair,
  applyFrameBomLegacyDedupeRepair,
  deleteProjectItemsByIds,
  executeFrameBomRefreshFromDrawing,
} from "../src/frameConstructor/frameBomAddToProject.js";
import * as previewData from "../src/frameConstructor/frameBomPurchasePreviewData.js";

const materials = [
  { id: "m073", name: "Болт", unit: "шт", basePrice: 0.5, supplier: "S", link: "https://b", photoUrl: "/b.jpg" },
];

const drawingContext = {
  projectId: "p1",
  drawingId: "d1",
  moduleRackKey: "mod_protochka:st_mrdwu5kzthoor",
  stellageId: "st_mrdwu5kzthoor",
  rackLabel: "Стеллаж 1",
};

const purchaseDraft = [
  { key: "bolt_m6x20", materialId: "m073", name: "Болт", unit: "шт", qty: 312 },
];

const project = {
  id: "p1",
  items: [
    {
      id: "st_mrdwu5kzthoor__ln_legacy",
      materialId: "m073",
      qty: 312,
      price: 0,
      supplier: "",
    },
    {
      id: "it_fbom_d1_mod_protochka:st_mrdwu5kzthoor_bolt_m6x20",
      materialId: "m073",
      qty: 312,
      price: 0.5,
      supplier: "S",
      clientNote: "Из схемы стеллажа",
      sourceKey: "frame_bom:d1:mod_protochka:st_mrdwu5kzthoor:bolt_m6x20",
      sourceObjectIds: { moduleRackKey: "mod_protochka:st_mrdwu5kzthoor", bomKey: "bolt_m6x20" },
    },
    { id: "manual1", materialId: "m073", qty: 3, source: "manual" },
  ],
};

describe("deleteProjectItemsByIds", () => {
  it("calls DELETE for each removeItemId", async () => {
    const deleteItem = vi.fn().mockResolvedValue(undefined);
    const result = await deleteProjectItemsByIds("p1", ["a", "b"], deleteItem);
    expect(deleteItem).toHaveBeenCalledTimes(2);
    expect(result.deleted).toEqual(["a", "b"]);
    expect(result.errors).toEqual([]);
  });

  it("reports delete failures", async () => {
    const deleteItem = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error("fail"), { status: 500 }));
    const result = await deleteProjectItemsByIds("p1", ["ok", "bad"], deleteItem);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].itemId).toBe("bad");
  });
});

describe("applyFrameBomRefreshRepair", () => {
  it("DELETE legacy ids then full replace items", async () => {
    const deleteItem = vi.fn().mockResolvedValue(undefined);
    const updateProject = vi.fn().mockResolvedValue({ id: "p1", items: [] });
    const loadProject = vi.fn().mockResolvedValue({ id: "p1", items: [] });

    const outcome = await applyFrameBomRefreshRepair({
      project,
      purchaseDraft,
      drawingContext,
      materials,
      deleteItem,
      updateProject,
      loadProject,
    });

    expect(deleteItem).toHaveBeenCalled();
    expect(deleteItem.mock.calls.some((c) => c[1] === "st_mrdwu5kzthoor__ln_legacy")).toBe(true);
    expect(updateProject).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ items: expect.any(Array) }),
    );
    expect(loadProject).toHaveBeenCalledWith("p1");
    expect(outcome.plan.removeItemIds.length).toBeGreaterThan(0);
    expect(outcome.summary.removedCount).toBeGreaterThan(0);
  });

  it("does not silently succeed when delete fails", async () => {
    const deleteItem = vi.fn().mockRejectedValue(Object.assign(new Error("db"), { status: 500 }));
    await expect(
      applyFrameBomRefreshRepair({
        project,
        purchaseDraft,
        drawingContext,
        materials,
        deleteItem,
        updateProject: vi.fn(),
      }),
    ).rejects.toThrow(/Не удалось удалить/);
  });

  it("after reload removed ids are absent from cleaned items", async () => {
    const deleteItem = vi.fn().mockResolvedValue(undefined);
    let savedItems = project.items;
    const updateProject = vi.fn().mockImplementation(async (_id, patch) => {
      savedItems = patch.items;
      return { id: "p1", items: patch.items };
    });
    const loadProject = vi.fn().mockImplementation(async () => ({ id: "p1", items: savedItems }));

    await applyFrameBomRefreshRepair({
      project,
      purchaseDraft,
      drawingContext,
      materials,
      deleteItem,
      updateProject,
      loadProject,
    });

    const reloaded = await loadProject("p1");
    expect(reloaded.items.some((i) => i.id === "st_mrdwu5kzthoor__ln_legacy")).toBe(false);
    expect(reloaded.items.filter((i) => i.materialId === "m073" && i.source !== "manual")).toHaveLength(1);
    expect(reloaded.items.some((i) => i.id === "manual1")).toBe(true);
  });
});

describe("executeFrameBomRefreshFromDrawing", () => {
  it("uses saved drawing frameConfig and runs repair pipeline", async () => {
    vi.spyOn(previewData, "buildFramePurchaseDraftFromFrameConfig").mockReturnValue(purchaseDraft);
    const deleteItem = vi.fn().mockResolvedValue(undefined);
    const updateProject = vi.fn().mockResolvedValue({ id: "p1", items: [] });
    const confirm = vi.fn().mockResolvedValue(true);

    const outcome = await executeFrameBomRefreshFromDrawing({
      project,
      drawing: { id: "d1", frameConfig: { constructionType: "tube_crab" } },
      drawingContext,
      materials,
      confirm,
      deleteItem,
      updateProject,
      loadProject: vi.fn().mockResolvedValue({ id: "p1", items: [] }),
    });

    expect(confirm).toHaveBeenCalled();
    expect(outcome.cancelled).toBe(false);
    expect(deleteItem).toHaveBeenCalled();
    expect(updateProject).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("direct repair works when drawing missing but canonical+legacy rows exist", async () => {
    const ductProject = {
      id: "p1",
      items: [
        {
          id: "st_mrdwu5kzthoor__ln_duct",
          materialId: "m010",
          module: "Стеллаж 1",
          price: 0,
          clientNote: "Из схемы стеллажа",
        },
        {
          id: "it_fbom_d1_mod_protochka:st_mrdwu5kzthoor_duct",
          materialId: "m010",
          module: "Стеллаж 1",
          price: 500,
          supplier: "S",
          clientNote: "Из схемы стеллажа",
          source: "frame_bom",
          sourceObjectIds: { moduleRackKey: "mod_protochka:st_mrdwu5kzthoor", bomKey: "duct" },
        },
      ],
    };
    const deleteItem = vi.fn().mockResolvedValue(undefined);
    const updateProject = vi.fn().mockResolvedValue({ id: "p1", items: [] });
    const confirm = vi.fn().mockResolvedValue(true);

    const outcome = await executeFrameBomRefreshFromDrawing({
      project: ductProject,
      drawing: null,
      drawingContext,
      materials,
      confirm,
      deleteItem,
      updateProject,
      loadProject: vi.fn().mockResolvedValue({ id: "p1", items: [] }),
    });

    expect(outcome.cancelled).toBe(false);
    expect(deleteItem).toHaveBeenCalled();
    expect(deleteItem.mock.calls.some((c) => c[1] === "st_mrdwu5kzthoor__ln_duct")).toBe(true);
    expect(updateProject).toHaveBeenCalled();
  });
});

describe("applyFrameBomLegacyDedupeRepair", () => {
  it("DELETE called for legacy duct ids and project refresh after repair", async () => {
    const project = {
      id: "p1",
      items: [
        {
          id: "st_mrdwu5kzthoor__ln_conn",
          materialId: "m012",
          module: "Стеллаж 1",
          price: 0,
          clientNote: "Из схемы стеллажа",
        },
        {
          id: "it_fbom_x",
          materialId: "m012",
          module: "Стеллаж 1",
          price: 40,
          supplier: "S",
          source: "frame_bom",
          sourceObjectIds: { moduleRackKey: "mod_protochka:st_mrdwu5kzthoor", bomKey: "conn" },
        },
      ],
    };
    const deleteItem = vi.fn().mockResolvedValue(undefined);
    const updateProject = vi.fn().mockResolvedValue({ id: "p1", items: [] });
    const loadProject = vi.fn().mockResolvedValue({ id: "p1", items: [] });

    const outcome = await applyFrameBomLegacyDedupeRepair({
      project,
      drawingContext,
      deleteItem,
      updateProject,
      loadProject,
    });

    expect(deleteItem.mock.calls.some((c) => c[1] === "st_mrdwu5kzthoor__ln_conn")).toBe(true);
    expect(loadProject).toHaveBeenCalledWith("p1");
    expect(outcome.summary.removedCount).toBeGreaterThan(0);
  });
});
