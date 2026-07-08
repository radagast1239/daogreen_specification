import { describe, expect, it, vi } from "vitest";
import {
  FRAME_BOM_ADD_BUTTON_LABEL,
  FRAME_BOM_ADD_CONFIRM_TITLE,
  FRAME_BOM_NO_PROJECT_REASON,
  FRAME_BOM_UNSAVED_DRAWING_WARNING,
  evaluateFrameBomAddToProject,
  buildFrameBomProjectMerge,
  formatFrameBomAddSuccessSummary,
  resolveFrameBomModuleRackKey,
  findDraftMaterialsMissingInCatalog,
  buildFrameBomAddConfirmMessage,
  countExistingFrameBomForRack,
  executeFrameBomProjectAdd,
} from "../src/frameConstructor/frameBomAddToProject.js";

const draft = [
  {
    key: "profile_tube_20x20",
    materialId: "m036",
    qty: 10,
    unit: "м",
    name: "Труба",
    pipeCuts: [{ lengthMm: 3200, qty: 2 }],
  },
  { key: "crab_g", materialId: "m072", qty: 4, unit: "шт", name: "Краб G" },
];

const materials = [
  { id: "m036", name: "Труба" },
  { id: "m072", name: "Краб" },
];

const drawingContext = {
  projectId: "p1",
  drawingId: "d1",
  moduleRackKey: "rack1",
  rackLabel: "Стеллаж 1",
};

describe("evaluateFrameBomAddToProject", () => {
  it("disables without projectId", () => {
    const result = evaluateFrameBomAddToProject({
      projectId: "",
      project: { items: [] },
      purchaseDraft: draft,
      drawingContext,
      materials,
    });
    expect(result.canAddToProject).toBe(false);
    expect(result.addDisabledReason).toBe(FRAME_BOM_NO_PROJECT_REASON);
  });

  it("enables when project, rack and draft are ready", () => {
    const result = evaluateFrameBomAddToProject({
      projectId: "p1",
      project: { items: [{ id: "x" }] },
      purchaseDraft: draft,
      drawingContext,
      materials,
    });
    expect(result.canAddToProject).toBe(true);
    expect(result.addDisabledReason).toBe("");
    expect(result.moduleRackKey).toBe("rack1");
  });

  it("warns when drawingId is missing but still allows add", () => {
    const result = evaluateFrameBomAddToProject({
      projectId: "p1",
      project: { items: [] },
      purchaseDraft: draft,
      drawingContext: { ...drawingContext, drawingId: "" },
      materials,
    });
    expect(result.canAddToProject).toBe(true);
    expect(result.warnings).toContain(FRAME_BOM_UNSAVED_DRAWING_WARNING);
  });

  it("disables when draft materials missing in catalog", () => {
    const result = evaluateFrameBomAddToProject({
      projectId: "p1",
      project: { items: [] },
      purchaseDraft: draft,
      drawingContext,
      materials: [{ id: "m036" }],
    });
    expect(result.canAddToProject).toBe(false);
    expect(result.addDisabledReason).toContain("m072");
    expect(findDraftMaterialsMissingInCatalog(draft, [{ id: "m036" }])).toEqual(["m072"]);
  });

  it("uses stellage fallback for moduleRackKey", () => {
    expect(
      resolveFrameBomModuleRackKey({ stellageId: "st42" }),
    ).toBe("stellage:st42");
  });
});

describe("buildFrameBomProjectMerge", () => {
  it("returns PATCH payload with merged items and does not mutate project", () => {
    const project = {
      items: [
        { id: "keep", source: "manual" },
        {
          id: "old",
          source: "frame_bom",
          sourceKey: "frame_bom:d1:rack1:profile_tube_20x20",
        },
      ],
    };
    const snapshot = JSON.parse(JSON.stringify(project));
    const { patch, mergeResult } = buildFrameBomProjectMerge(project, draft, drawingContext);

    expect(project).toEqual(snapshot);
    expect(patch).toEqual({ items: mergeResult.items });
    expect(mergeResult.removedCount).toBe(1);
    expect(mergeResult.addedCount).toBe(2);
    expect(mergeResult.keptCount).toBe(1);
    expect(mergeResult.items.some((i) => i.id === "keep")).toBe(true);
    expect(mergeResult.items.some((i) => i.id === "old")).toBe(false);
    expect(mergeResult.sourceRackPrefix).toBe("frame_bom:d1:rack1");
  });
});

describe("formatFrameBomAddSuccessSummary", () => {
  it("formats success counts", () => {
    const summary = formatFrameBomAddSuccessSummary({
      addedCount: 2,
      removedCount: 1,
      keptCount: 5,
      sourceRackPrefix: "frame_bom:d1:rack1",
      warnings: [],
    });
    expect(summary.title).toContain("добавлен");
    expect(summary.addedCount).toBe(2);
    expect(summary.removedCount).toBe(1);
    expect(summary.keptCount).toBe(5);
  });
});

describe("frame BOM add button copy", () => {
  it("exposes button label for preview", () => {
    expect(FRAME_BOM_ADD_BUTTON_LABEL).toContain("обновить BOM");
  });
});

describe("buildFrameBomAddConfirmMessage", () => {
  it("uses replace text when old BOM exists", () => {
    const message = buildFrameBomAddConfirmMessage({ addedPreviewCount: 2, hasExistingBom: true });
    expect(message).toContain("Будет добавлено: 2 позиций.");
    expect(message).toContain("будут заменены");
    expect(message).toContain("Продолжить?");
  });

  it("uses add text when no old BOM", () => {
    const message = buildFrameBomAddConfirmMessage({ addedPreviewCount: 3, hasExistingBom: false });
    expect(message).toContain("будут добавлены в закупочный лист");
  });
});

describe("executeFrameBomProjectAdd confirmation", () => {
  const project = {
    items: [
      { id: "keep", source: "manual" },
      {
        id: "old",
        source: "frame_bom",
        sourceKey: "frame_bom:d1:rack1:profile_tube_20x20",
      },
    ],
  };

  it("confirm cancel does not call api.updateProject", async () => {
    const updateProject = vi.fn();
    const confirm = vi.fn().mockResolvedValue(false);
    const result = await executeFrameBomProjectAdd({
      project,
      purchaseDraft: draft,
      drawingContext,
      confirm,
      updateProject,
    });
    expect(result.cancelled).toBe(true);
    expect(updateProject).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: FRAME_BOM_ADD_CONFIRM_TITLE }),
    );
  });

  it("confirm ok calls api.updateProject", async () => {
    const updateProject = vi.fn().mockResolvedValue({ id: "p1", items: [] });
    const confirm = vi.fn().mockResolvedValue(true);
    const result = await executeFrameBomProjectAdd({
      project,
      purchaseDraft: draft,
      drawingContext,
      confirm,
      updateProject,
    });
    expect(result.cancelled).toBe(false);
    expect(updateProject).toHaveBeenCalledTimes(1);
    expect(updateProject.mock.calls[0][0]).toBe("p1");
    expect(updateProject.mock.calls[0][1]).toHaveProperty("items");
    expect(result.summary.addedCount).toBe(2);
  });

  it("counts existing BOM for rack", () => {
    expect(countExistingFrameBomForRack(project.items, drawingContext)).toBe(1);
    expect(countExistingFrameBomForRack([{ source: "manual" }], drawingContext)).toBe(0);
  });
});
