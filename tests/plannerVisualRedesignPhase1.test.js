/**
 * Phase 1 visual redesign — integrated workspace contracts.
 */
import { describe, expect, it } from "vitest";
import {
  buildPlannerToolRailTools,
  resolveRailActiveToolId,
} from "../src/planner/plannerToolRailCatalog.js";
import {
  VISUAL_LAYERS,
  visualLayerIdForSheet,
} from "../src/planner/ui/PlannerLayerSwitcher.jsx";
import { plannerSaveStatusLabel } from "../src/planner/ui/PlannerTopBar.jsx";
import { DG_THEME } from "../src/planner/plannerVisualTheme.js";
import { computePlanContentBounds, computeFitTransform, shouldAutoFitPlan } from "../src/planner/viewport.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("planner redesigned workspace", () => {
  it("builds rail tools from TOOL_REGISTRY mapping", () => {
    const tools = buildPlannerToolRailTools();
    expect(tools.map((t) => t.id)).toEqual([
      "select",
      "wall",
      "door",
      "window",
      "measure",
      "objects",
      "engineering",
      "zones",
      "pan",
    ]);
    const measure = tools.find((t) => t.id === "measure");
    expect(measure.group).toBe(true);
    expect(measure.children.map((c) => c.id)).toEqual([
      "measure_linear",
      "measure_diagonal",
      "measure_angular",
    ]);
    expect(tools.find((t) => t.id === "objects").children.length).toBeGreaterThan(0);
  });

  it("resolves a single active rail tool id", () => {
    expect(resolveRailActiveToolId({ tool: "wall", activeToolId: "wall_draw", measureKind: "linear" })).toBe("wall");
    expect(resolveRailActiveToolId({ tool: "measure", activeToolId: "measure", measureKind: "angle" })).toBe("measure_angular");
    expect(resolveRailActiveToolId({ tool: "select", activeToolId: "select", measureKind: "linear" })).toBe("select");
  });

  it("maps visual layers onto existing planner sheets", () => {
    expect(VISUAL_LAYERS.map((l) => l.label)).toEqual([
      "Архитектура",
      "Стеллажи",
      "Вода",
      "Электрика",
      "Климат",
      "Автоматика",
      "Зоны",
    ]);
    expect(visualLayerIdForSheet("base_plan")).toBe("architecture");
    expect(visualLayerIdForSheet("partitions")).toBe("architecture");
  });

  it("keeps save status labels for the compact topbar", () => {
    expect(plannerSaveStatusLabel("hydrating")).toBe("Загрузка…");
    expect(plannerSaveStatusLabel("saved")).toBe("Сохранено");
    expect(plannerSaveStatusLabel("error")).toBe("Ошибка сохранения");
  });

  it("uses higher-contrast wall and dimension theme colors", () => {
    expect(DG_THEME.wall.toLowerCase()).toBe("#1e2421");
    expect(DG_THEME.dimNormal.toLowerCase()).toBe("#5a6a62");
  });

  it("fit bounds prefer drawn wall geometry over empty 12×8 sheet", () => {
    const plan = JSON.parse(readFileSync(join(root, "tests/fixtures/planner/two-rooms.json"), "utf8"));
    const bounds = computePlanContentBounds({ ...plan, walls: resolvePlanWalls(plan) });
    expect(bounds.empty).toBe(false);
    expect(bounds.width).toBeLessThan(9000);
    expect(bounds.height).toBeLessThan(5000);
    const fit = computeFitTransform({
      bounds,
      width: 1400,
      height: 900,
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
      padding: 40,
    });
    expect(fit.zoom).toBeGreaterThan(0.12);
    expect(fit.zoom).toBeLessThan(0.25);
  });

  it("does not auto-fit after manual pan/zoom or ordinary edits", () => {
    const id = { mode: "standalone", id: "d1" };
    expect(shouldAutoFitPlan({}, { identity: id, hasGeometry: true }, "open")).toBe(true);
    expect(shouldAutoFitPlan(
      { identity: id, hasGeometry: true, fitted: true, manual: true },
      { identity: id, hasGeometry: true, fitted: true, manual: true },
      "open",
    )).toBe(false);
    expect(shouldAutoFitPlan(
      { identity: id, hasGeometry: true, fitted: true },
      { identity: id, hasGeometry: true, fitted: true },
      "fit-button",
    )).toBe(true);
  });
});
