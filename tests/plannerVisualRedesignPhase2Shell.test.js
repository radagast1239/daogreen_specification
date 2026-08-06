/**
 * Phase 2 — fullscreen Planner shell + responsive inspector contracts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  estimatePlannerCanvasWidth,
  getDefaultInspectorOpen,
  getPlannerInspectorBreakpoint,
  getPlannerInspectorMode,
  getPlannerInspectorWidthPx,
  isPlannerWorkspacePath,
  meetsPlannerCanvasWidthTarget,
  PLANNER_TOOL_RAIL_WIDTH,
  PLANNER_TOOL_RAIL_WIDTH_COMPACT,
} from "../src/planner/plannerWorkspaceShell.js";
import { computeFitTransform, computePlanContentBounds, shouldAutoFitPlan } from "../src/planner/viewport.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("planner phase2 workspace shell", () => {
  it("detects CAD planner routes only", () => {
    expect(isPlannerWorkspacePath("/project/abc/plan")).toBe(true);
    expect(isPlannerWorkspacePath("/planner/draft/d1")).toBe(true);
    expect(isPlannerWorkspacePath("/planner")).toBe(false);
    expect(isPlannerWorkspacePath("/planner/frame")).toBe(false);
    expect(isPlannerWorkspacePath("/project/abc")).toBe(false);
    expect(isPlannerWorkspacePath("/")).toBe(false);
  });

  it("maps inspector breakpoints and dock vs overlay", () => {
    expect(getPlannerInspectorBreakpoint(1920)).toBe("desktop");
    expect(getPlannerInspectorBreakpoint(1440)).toBe("desktop");
    expect(getPlannerInspectorBreakpoint(1439)).toBe("mid");
    expect(getPlannerInspectorBreakpoint(1280)).toBe("mid");
    expect(getPlannerInspectorBreakpoint(1279)).toBe("narrow");
    expect(getPlannerInspectorMode("desktop")).toBe("dock");
    expect(getPlannerInspectorMode("mid")).toBe("dock");
    expect(getPlannerInspectorMode("narrow")).toBe("overlay");
    expect(getDefaultInspectorOpen("desktop")).toBe(true);
    expect(getDefaultInspectorOpen("mid")).toBe(true);
    expect(getDefaultInspectorOpen("narrow")).toBe(false);
    expect(getPlannerInspectorWidthPx("desktop")).toBe(328);
    expect(getPlannerInspectorWidthPx("mid")).toBe(288);
  });

  it("meets canvas width targets via layout (not zoom)", () => {
    const at1920 = meetsPlannerCanvasWidthTarget({ viewportWidth: 1920, inspectorOpen: true, appNavWidth: 0 });
    expect(at1920.width).toBeGreaterThanOrEqual(1250);
    expect(at1920.ok).toBe(true);

    const at1440 = meetsPlannerCanvasWidthTarget({ viewportWidth: 1440, inspectorOpen: true, appNavWidth: 0 });
    expect(at1440.width).toBeGreaterThanOrEqual(850);
    expect(at1440.ok).toBe(true);

    const at1280 = meetsPlannerCanvasWidthTarget({ viewportWidth: 1280, inspectorOpen: false, appNavWidth: 0 });
    expect(at1280.width).toBeGreaterThanOrEqual(850);
    expect(at1280.ok).toBe(true);

    // Overlay inspector must not shrink canvas
    const narrowOpen = estimatePlannerCanvasWidth({
      viewportWidth: 1200,
      appNavWidth: 0,
      railWidth: PLANNER_TOOL_RAIL_WIDTH_COMPACT,
      inspectorOpen: true,
      inspectorMode: "overlay",
      inspectorWidth: 320,
    });
    const narrowClosed = estimatePlannerCanvasWidth({
      viewportWidth: 1200,
      appNavWidth: 0,
      railWidth: PLANNER_TOOL_RAIL_WIDTH_COMPACT,
      inspectorOpen: false,
      inspectorMode: "overlay",
    });
    expect(narrowOpen).toBe(narrowClosed);
    expect(narrowOpen).toBe(1200 - PLANNER_TOOL_RAIL_WIDTH_COMPACT);
  });

  it("documents before/after chrome at 1440", () => {
    const before = estimatePlannerCanvasWidth({
      viewportWidth: 1440,
      appNavWidth: 220,
      railWidth: PLANNER_TOOL_RAIL_WIDTH,
      inspectorOpen: true,
      inspectorWidth: 328,
      inspectorMode: "dock",
    });
    const after = estimatePlannerCanvasWidth({
      viewportWidth: 1440,
      appNavWidth: 0,
      railWidth: PLANNER_TOOL_RAIL_WIDTH,
      inspectorOpen: true,
      inspectorWidth: 328,
      inspectorMode: "dock",
    });
    expect(before).toBe(1440 - 220 - 80 - 328);
    expect(after).toBe(1440 - 80 - 328);
    expect(after - before).toBe(220);
    expect(after).toBeGreaterThanOrEqual(850);
  });

  it("fit zoom grows with larger canvas width; manual zoom not auto-reset", () => {
    const plan = JSON.parse(readFileSync(join(root, "tests/fixtures/planner/two-rooms.json"), "utf8"));
    const bounds = computePlanContentBounds({ ...plan, walls: resolvePlanWalls(plan) });
    const small = computeFitTransform({
      bounds,
      width: 580,
      height: 900,
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
      padding: 40,
    });
    const large = computeFitTransform({
      bounds,
      width: 1032,
      height: 900,
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
      padding: 40,
    });
    expect(large.zoom).toBeGreaterThan(small.zoom);

    const id = { mode: "standalone", id: "d1" };
    expect(shouldAutoFitPlan(
      { identity: id, hasGeometry: true, fitted: true, manual: true },
      { identity: id, hasGeometry: true, fitted: true, manual: true },
      "open",
    )).toBe(false);
  });

  it("Layout and redesign CSS keep route-aware fullscreen hooks", () => {
    const layout = readFileSync(join(root, "src/components/Layout.jsx"), "utf8");
    const css = readFileSync(join(root, "src/planner/planner-redesign.css"), "utf8");
    const theme = readFileSync(join(root, "src/styles/theme.css"), "utf8");
    expect(layout).toContain("shell--planner-workspace");
    expect(layout).toContain("isPlannerWorkspacePath");
    expect(layout).toContain("planner-app-chrome");
    expect(layout).toContain("!plannerWorkspace && <GlobalSearch");
    expect(theme).toContain(".shell--planner-workspace");
    expect(theme).toContain("sidebar--planner-overlay");
    expect(css).toContain("planner-inspector-slot--overlay");
    expect(css).toContain("planner-inspector-reopen");
    expect(css).toContain("--pl-inspector-w: 288px");
  });
});
