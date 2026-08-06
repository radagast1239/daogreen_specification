/**
 * Final UX pass regressions — confirmed user-flow defects only.
 */
import { describe, expect, it } from "vitest";
import { findNodeIdAt } from "../src/planner/wallNetwork.js";
import { NODE_LINK_THR } from "../src/planner/core/walls/wallOps.js";
import { createAngleDimension } from "../src/planner/core/dimensions/anchorOperations.js";
import { sheetById } from "../src/planner/plannerSheets.js";
import { plannerSaveStatusLabel } from "../src/planner/ui/PlannerTopBar.jsx";

function resolveDimAnchorAt(nodes, pt) {
  const nodeId = findNodeIdAt(nodes || {}, pt, NODE_LINK_THR);
  if (nodeId) return { type: "node", nodeId };
  return { type: "free", point: { x: pt.x, y: pt.y } };
}

describe("planner final UX pass", () => {
  it("autosave status distinguishes loading from saving", () => {
    expect(plannerSaveStatusLabel("hydrating")).toBe("Загрузка…");
    expect(plannerSaveStatusLabel("saving")).toBe("Сохранение…");
    expect(plannerSaveStatusLabel("dirty")).toBe("Сохранение…");
    expect(plannerSaveStatusLabel("saved")).toBe("Сохранено");
    expect(plannerSaveStatusLabel("error")).toBe("Ошибка сохранения");
  });

  it("measure commit prefers node anchors when cursor is near a node", () => {
    const nodes = {
      nA: { x: 0, y: 0 },
      nB: { x: 4000, y: 0 },
    };
    const a = resolveDimAnchorAt(nodes, { x: 5, y: 0 });
    const b = resolveDimAnchorAt(nodes, { x: 3998, y: 2 });
    const free = resolveDimAnchorAt(nodes, { x: 2000, y: 2000 });
    expect(a).toEqual({ type: "node", nodeId: "nA" });
    expect(b).toEqual({ type: "node", nodeId: "nB" });
    expect(free.type).toBe("free");
    expect(free.point).toEqual({ x: 2000, y: 2000 });
  });

  it("angle dimension can mix node and free anchors without null node ids", () => {
    const nodes = { v: { x: 0, y: 0 }, r1: { x: 1000, y: 0 } };
    const a0 = resolveDimAnchorAt(nodes, { x: 0, y: 0 });
    const a1 = resolveDimAnchorAt(nodes, { x: 1000, y: 0 });
    const a2 = resolveDimAnchorAt(nodes, { x: 0, y: 800 });
    const dim = {
      ...createAngleDimension({
        id: "ang1",
        vertexNodeId: a0.type === "node" ? a0.nodeId : null,
        rayNodeId1: a1.type === "node" ? a1.nodeId : null,
        rayNodeId2: a2.type === "node" ? a2.nodeId : null,
      }),
      anchors: [a0, a1, a2],
    };
    expect(dim.anchors[0]).toEqual({ type: "node", nodeId: "v" });
    expect(dim.anchors[1]).toEqual({ type: "node", nodeId: "r1" });
    expect(dim.anchors[2].type).toBe("free");
    expect(dim.anchors.every((a) => a.type !== "node" || !!a.nodeId)).toBe(true);
  });

  it("base and partitions sheets surface door_std and window_std", () => {
    const base = sheetById("base_plan");
    const parts = sheetById("partitions");
    const baseTools = base.toolGroups.flatMap((g) => g.tools);
    const partTools = parts.toolGroups.flatMap((g) => g.tools);
    expect(baseTools).toContain("door_std");
    expect(baseTools).toContain("window_std");
    expect(partTools).toContain("door_std");
    expect(partTools).toContain("window_std");
  });
});
