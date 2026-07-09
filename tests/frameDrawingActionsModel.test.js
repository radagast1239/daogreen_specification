import { describe, expect, it } from "vitest";
import {
  resolveFrameDrawingActionBehavior,
  FRAME_BOM_REFRESH_BUTTON_LABEL,
  FRAME_DRAWING_EDIT_SCHEME_LABEL,
  FRAME_DRAWING_OPEN_SCHEME_LABEL,
} from "../shared/frameDrawingActionsModel.js";

const ctx = {
  projectId: "p1",
  drawingId: "d1",
  moduleRackKey: "mod:st1",
  rackId: "st1",
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
});
