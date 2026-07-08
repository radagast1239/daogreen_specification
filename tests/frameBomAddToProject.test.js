import { describe, expect, it, vi } from "vitest";
import {
  FRAME_BOM_ADD_BUTTON_LABEL,
  FRAME_BOM_ADD_CONFIRM_TITLE,
  FRAME_BOM_NO_PROJECT_REASON,
  FRAME_BOM_UNSAVED_DRAWING_WARNING,
  FRAME_SAVE_PDF_AND_BOM_BUTTON_LABEL,
  FRAME_SAVE_PDF_AND_BOM_CONFIRM_TITLE,
  FRAME_SAVE_PDF_AND_BOM_SUCCESS_TITLE,
  evaluateFrameBomAddToProject,
  evaluateFrameSavePdfAndBom,
  buildFrameBomProjectMerge,
  formatFrameBomAddSuccessSummary,
  formatFrameSavePdfAndBomSuccess,
  resolveFrameBomModuleRackKey,
  findDraftMaterialsMissingInCatalog,
  buildFrameBomAddConfirmMessage,
  buildFrameSavePdfAndBomConfirmMessage,
  countExistingFrameBomForRack,
  executeFrameBomProjectAdd,
  executeFrameSavePdfAndBom,
  requestFrameSavePdfAndBomConfirmation,
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
  { id: "m036", name: "Труба", unit: "м", basePrice: 100, supplier: "S1", link: "https://t", imageUrl: "/t.jpg" },
  { id: "m072", name: "Краб", unit: "шт", basePrice: 50, supplier: "S2", link: "https://c", photoUrl: "/c.jpg" },
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
      materials: [{ id: "m036", name: "Труба" }],
    });
    expect(result.canAddToProject).toBe(false);
    expect(result.addDisabledReason).toContain("BOM не добавлен");
    expect(result.addDisabledReason).toContain("m072");
    expect(findDraftMaterialsMissingInCatalog(draft, [{ id: "m036" }])).toEqual(["m072"]);
  });

  it("disables while materials catalog is loading", () => {
    const result = evaluateFrameBomAddToProject({
      projectId: "p1",
      project: { items: [] },
      purchaseDraft: draft,
      drawingContext,
      materials: null,
    });
    expect(result.canAddToProject).toBe(false);
    expect(result.addDisabledReason).toContain("Загрузка каталога");
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
    const { patch, mergeResult } = buildFrameBomProjectMerge(project, draft, drawingContext, materials);

    expect(project).toEqual(snapshot);
    expect(patch).toEqual({ items: mergeResult.items });
    expect(mergeResult.removedCount).toBe(1);
    expect(mergeResult.addedCount).toBe(2);
    expect(mergeResult.keptCount).toBe(1);
    expect(mergeResult.items.some((i) => i.id === "keep")).toBe(true);
    expect(mergeResult.items.some((i) => i.id === "old")).toBe(false);
    expect(mergeResult.sourceRackPrefix).toBe("frame_bom:d1:rack1");
    const tube = mergeResult.items.find((i) => i.materialId === "m036");
    expect(tube.price).toBe(100);
    expect(tube.supplier).toBe("S1");
  });

  it("throws when materials missing from catalog", () => {
    const project = { items: [] };
    expect(() =>
      buildFrameBomProjectMerge(project, draft, drawingContext, [{ id: "m036", name: "Труба" }]),
    ).toThrow(/BOM не добавлен/);
  });

  it("second save with new drawingId replaces rack BOM without duplicates", () => {
    const project = {
      items: [
        { id: "keep", source: "manual", materialId: "m999", qty: 1 },
        {
          id: "old_bom",
          source: "frame_bom",
          sourceType: "frame_bom",
          sourceKey: "frame_bom:drawing_v1:rack1:profile_tube_20x20",
          sourceObjectIds: { moduleRackKey: "rack1", frameDrawingId: "drawing_v1" },
          materialId: "m036",
          qty: 88,
        },
      ],
    };
    const { patch: patchV2 } = buildFrameBomProjectMerge(
      project,
      [{ ...draft[0], qty: 70 }],
      { ...drawingContext, drawingId: "drawing_v2" },
      materials,
    );
    const bomLines = patchV2.items.filter((i) => i.source === "frame_bom");
    expect(bomLines).toHaveLength(1);
    expect(bomLines[0].qty).toBe(70);
    expect(bomLines[0].sourceKey).toContain("drawing_v2");
    expect(patchV2.items.some((i) => i.id === "old_bom")).toBe(false);
    expect(patchV2.items.some((i) => i.id === "keep")).toBe(true);
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
      materials,
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
      materials,
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

describe("evaluateFrameSavePdfAndBom", () => {
  it("enables combined action only with project context and BOM", () => {
    const ready = evaluateFrameSavePdfAndBom({
      projectId: "p1",
      project: { items: [{ id: "x" }] },
      purchaseDraft: draft,
      drawingContext,
      materials,
    });
    expect(ready.canSavePdfAndBom).toBe(true);

    const noProject = evaluateFrameSavePdfAndBom({
      projectId: "",
      project: { items: [] },
      purchaseDraft: draft,
      drawingContext: { moduleRackKey: "rack1" },
      materials,
    });
    expect(noProject.canSavePdfAndBom).toBe(false);
    expect(noProject.addDisabledReason).toBe(FRAME_BOM_NO_PROJECT_REASON);
  });
});

describe("frame save PDF + BOM copy", () => {
  it("exposes combined button and success labels", () => {
    expect(FRAME_SAVE_PDF_AND_BOM_BUTTON_LABEL).toContain("BOM");
    expect(FRAME_SAVE_PDF_AND_BOM_CONFIRM_TITLE).toContain("закупочный лист");
    expect(FRAME_SAVE_PDF_AND_BOM_SUCCESS_TITLE).toContain("Чертёж сохранён");
  });

  it("builds combined confirm message", () => {
    const message = buildFrameSavePdfAndBomConfirmMessage();
    expect(message).toContain("будут заменены");
    expect(message).toContain("Продолжить?");
  });

  it("formats combined success summary", () => {
    const summary = formatFrameSavePdfAndBomSuccess({
      bomSummary: formatFrameBomAddSuccessSummary({
        addedCount: 2,
        removedCount: 1,
        keptCount: 5,
        sourceRackPrefix: "frame_bom:d1:rack1",
        warnings: [],
      }),
    });
    expect(summary.title).toBe(FRAME_SAVE_PDF_AND_BOM_SUCCESS_TITLE);
    expect(summary.detail).toContain("добавлено: 2");
  });
});

describe("executeFrameSavePdfAndBom", () => {
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

  it("confirm cancel does not save PDF and does not PATCH project", async () => {
    const savePdf = vi.fn();
    const updateProject = vi.fn();
    const confirm = vi.fn().mockResolvedValue(false);
    const result = await executeFrameSavePdfAndBom({
      confirm,
      savePdf,
      project,
      purchaseDraft: draft,
      drawingContext,
      updateProject,
      materials,
    });
    expect(result.cancelled).toBe(true);
    expect(savePdf).not.toHaveBeenCalled();
    expect(updateProject).not.toHaveBeenCalled();
  });

  it("confirm ok saves PDF then PATCH project", async () => {
    const savePdf = vi.fn().mockResolvedValue({ id: "d-new" });
    const updateProject = vi.fn().mockResolvedValue({ id: "p1", items: [] });
    const confirm = vi.fn().mockResolvedValue(true);
    const result = await executeFrameSavePdfAndBom({
      confirm,
      savePdf,
      project,
      purchaseDraft: draft,
      drawingContext,
      updateProject,
      materials,
    });
    expect(result.cancelled).toBe(false);
    expect(savePdf).toHaveBeenCalledTimes(1);
    expect(updateProject).toHaveBeenCalledTimes(1);
    expect(result.combinedSummary.title).toBe(FRAME_SAVE_PDF_AND_BOM_SUCCESS_TITLE);
  });

  it("requestFrameSavePdfAndBomConfirmation uses combined title", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    await requestFrameSavePdfAndBomConfirmation({ confirm });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: FRAME_SAVE_PDF_AND_BOM_CONFIRM_TITLE }),
    );
  });
});
