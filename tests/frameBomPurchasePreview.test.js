import { describe, expect, it } from "vitest";
import { generateCutList } from "../src/frameConstructor/frameCutList.js";
import { calculateFrameGeometry } from "../src/frameConstructor/frameGeometry.js";
import { extractTubeCutsFromCutList, calculateTubeStockOptions } from "../src/frameConstructor/frameTubeStock.js";
import { calculateAngleStockOptions } from "../src/frameConstructor/frameAngleStock.js";
import { defaultFrameParams } from "../src/frameConstructor/framePresets.js";
import {
  PREVIEW_BANNER_TEXT,
  PREVIEW_FUTURE_NOTE,
  buildFramePurchaseDraftFromContext,
  visiblePurchaseDraftItems,
  groupPurchasePreviewItems,
  findMissingMaterialIds,
} from "../src/frameConstructor/frameBomPurchasePreviewData.js";
import {
  FRAME_BOM_ADD_BUTTON_LABEL,
  FRAME_BOM_NO_PROJECT_REASON,
  evaluateFrameBomAddToProject,
} from "../src/frameConstructor/frameBomAddToProject.js";
import FrameBomPurchasePreview from "../src/frameConstructor/FrameBomPurchasePreview.jsx";

describe("frameBomPurchasePreview data", () => {
  it("exposes preview banner and hint copy", () => {
    expect(PREVIEW_BANNER_TEXT).toBe("Предпросмотр. В закупку ещё не добавлено.");
    expect(PREVIEW_FUTURE_NOTE).toContain("Повторное нажатие");
  });

  it("filters out qty=0 positions", () => {
    const draft = [
      { key: "crab_g", qty: 4, materialId: "m072" },
      { key: "crab_a4", qty: 0, materialId: "m_Vsbox6xIlT" },
    ];
    expect(visiblePurchaseDraftItems(draft)).toHaveLength(1);
    expect(groupPurchasePreviewItems(draft).crabs).toHaveLength(1);
  });

  it("reports missing material_id for visible items", () => {
    const draft = [
      { key: "crab_g", qty: 1, materialId: "m072" },
      { key: "crab_x", qty: 2 },
    ];
    expect(findMissingMaterialIds(draft)).toEqual(["crab_x"]);
  });

  it("tube_crab context draft includes m036 with pipeCuts", () => {
    const params = {
      ...defaultFrameParams,
      constructionType: "tube_crab",
      postCountX: 3,
      postCountY: 2,
      connectionType: "crab",
    };
    const cutList = generateCutList(params);
    const stockOptions = calculateTubeStockOptions(extractTubeCutsFromCutList(cutList));
    const draft = buildFramePurchaseDraftFromContext({
      params,
      cutList,
      geom: null,
      stockOptions,
    });

    const tube = draft.find((i) => i.materialId === "m036");
    expect(tube).toBeDefined();
    expect(tube.key).toBe("profile_tube_20x20");
    expect(tube.pipeCuts?.length).toBeGreaterThan(0);
    expect(tube.qty).toBeGreaterThan(0);

    const visible = visiblePurchaseDraftItems(draft);
    expect(visible.every((i) => (Number(i.qty) || 0) > 0)).toBe(true);
    expect(visible.some((i) => i.key === "crab_t")).toBe(true);
  });

  it("perforated_angle context draft includes angle stock and fasteners", () => {
    const params = {
      ...defaultFrameParams,
      constructionType: "perforated_angle",
      angleProfile: "30×30",
      crossBeamFasteningMode: "bolts_only",
      angleOverlapMm: 150,
    };
    const cutList = generateCutList(params);
    const geom = calculateFrameGeometry(params);
    const stockOptions = calculateAngleStockOptions(cutList, { overlapMm: params.angleOverlapMm });
    const draft = buildFramePurchaseDraftFromContext({
      params,
      cutList,
      geom,
      stockOptions,
    });

    const groups = groupPurchasePreviewItems(draft);
    expect(groups.angleStock.length).toBeGreaterThan(0);
    expect(groups.fasteners.length).toBeGreaterThan(0);
    expect(groups.fasteners.some((i) => i.key === "bolt_m6x20")).toBe(true);
    expect(groups.fasteners.some((i) => i.key === "foot_plate")).toBe(true);
    expect(groups.angleStock[0].techNote).toBeTruthy();
  });

  it("returns empty draft when cutList is empty", () => {
    expect(
      buildFramePurchaseDraftFromContext({
        params: defaultFrameParams,
        cutList: [],
        stockOptions: null,
      }),
    ).toEqual([]);
  });
});

describe("FrameBomPurchasePreview component", () => {
  it("is a pure UI component without api imports", () => {
    expect(FrameBomPurchasePreview).toBeTypeOf("function");
    expect(String(FrameBomPurchasePreview)).not.toMatch(/api\./);
  });

  it("add gating disables without projectId", () => {
    const evalResult = evaluateFrameBomAddToProject({
      projectId: "",
      project: null,
      purchaseDraft: [{ key: "crab_g", materialId: "m072", qty: 1 }],
      drawingContext: { moduleRackKey: "rack1" },
      materials: [{ id: "m072" }],
    });
    expect(evalResult.canAddToProject).toBe(false);
    expect(evalResult.addDisabledReason).toBe(FRAME_BOM_NO_PROJECT_REASON);
    expect(FRAME_BOM_ADD_BUTTON_LABEL).toContain("стеллажа");
  });
});
