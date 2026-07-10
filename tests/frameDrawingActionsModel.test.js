import { describe, expect, it } from "vitest";
import {
  resolveFrameDrawingActionBehavior,
  canRefreshFrameBom,
  drawingHasUsableRefreshContext,
  FRAME_BOM_REFRESH_BUTTON_LABEL,
  FRAME_DRAWING_EDIT_SCHEME_LABEL,
  FRAME_DRAWING_OPEN_SCHEME_LABEL,
} from "../shared/frameDrawingActionsModel.js";

const ctx = {
  projectId: "p1",
  drawingId: "d1",
  moduleRackKey: "mod:st1",
  rackId: "st1",
  rackLabel: "Стеллаж 1",
};

const legacyDuctRow = {
  id: "st_st1__ln_duct1",
  materialId: "m010",
  module: "Стеллаж 1",
  price: 0,
  supplier: "",
  clientNote: "Из схемы стеллажа",
};

const pricedDuctRow = {
  id: "it_fbom_d1_mod:st1_duct_55",
  materialId: "m010",
  module: "Стеллаж 1",
  price: 120,
  supplier: "Shop",
  clientNote: "Из схемы стеллажа",
  source: "frame_bom",
  sourceObjectIds: { moduleRackKey: "mod:st1", bomKey: "duct_55" },
};

describe("frameDrawingActionsModel", () => {
  it("Обновить BOM does not navigate/open constructor", () => {
    const behavior = resolveFrameDrawingActionBehavior(FRAME_BOM_REFRESH_BUTTON_LABEL, ctx);
    expect(behavior.navigates).toBe(false);
    expect(behavior.opensConstructor).toBe(false);
    expect(behavior.constructorTab).toBeNull();
    expect(behavior.action).toBe("refresh_bom");
  });

  it("Открыть схему opens drawing route", () => {
    const behavior = resolveFrameDrawingActionBehavior(FRAME_DRAWING_OPEN_SCHEME_LABEL, ctx);
    expect(behavior.navigates).toBe(true);
    expect(behavior.opensConstructor).toBe(true);
    expect(behavior.href).toContain("/planner/frame");
    expect(behavior.href).toContain("drawingId=d1");
  });

  it("Редактировать схему opens edit/replace flow", () => {
    const editCtx = { ...ctx, mode: "replace" };
    const behavior = resolveFrameDrawingActionBehavior(FRAME_DRAWING_EDIT_SCHEME_LABEL, editCtx);
    expect(behavior.navigates).toBe(true);
    expect(behavior.action).toBe("edit_scheme");
  });

  it("refresh BOM action never sets constructorTab=cutlist", () => {
    const behavior = resolveFrameDrawingActionBehavior(FRAME_BOM_REFRESH_BUTTON_LABEL, {
      ...ctx,
      constructorTab: "cutlist",
    });
    expect(behavior.constructorTab).toBeNull();
  });

  it("drawingHasUsableRefreshContext accepts legacy list row shape", () => {
    expect(drawingHasUsableRefreshContext({ id: "fd1", pdfUrl: "/x.pdf", version: 1 })).toBe(true);
    expect(drawingHasUsableRefreshContext({ drawingId: "fd1" })).toBe(true);
    expect(drawingHasUsableRefreshContext(null)).toBe(false);
  });

  it("canRefreshFrameBom enabled when drawing exists", () => {
    const state = canRefreshFrameBom({
      drawing: { id: "d1", pdfUrl: "/x.pdf" },
      projectItems: [],
      context: ctx,
    });
    expect(state.enabled).toBe(true);
    expect(state.mode).toBe("full");
  });

  it("canRefreshFrameBom enabled when legacy scheme rows exist without drawing", () => {
    const state = canRefreshFrameBom({
      drawing: null,
      projectItems: [legacyDuctRow, pricedDuctRow],
      context: { ...ctx, drawingId: "" },
    });
    expect(state.enabled).toBe(true);
    expect(state.hasLegacy).toBe(true);
    expect(state.mode).toBe("dedupe");
  });

  it("canRefreshFrameBom enabled when canonical frame_bom rows exist", () => {
    const state = canRefreshFrameBom({
      drawing: null,
      projectItems: [pricedDuctRow],
      context: ctx,
    });
    expect(state.enabled).toBe(true);
    expect(state.hasBom).toBe(true);
  });

  it("canRefreshFrameBom disabled only when no drawing and no BOM rows", () => {
    const state = canRefreshFrameBom({
      drawing: null,
      projectItems: [{ id: "manual1", materialId: "m010", source: "manual" }],
      context: { ...ctx, drawingId: "" },
    });
    expect(state.enabled).toBe(false);
    expect(state.reason).toMatch(/Нет схемы/);
  });

  it("refresh BOM enabled for drawing with legacy-shaped fields only", () => {
    const state = canRefreshFrameBom({
      drawing: { drawingId: "legacy_fd", pdfUrl: "/old.pdf" },
      projectItems: [legacyDuctRow],
      context: { ...ctx, drawingId: "legacy_fd" },
    });
    expect(state.enabled).toBe(true);
  });
});
