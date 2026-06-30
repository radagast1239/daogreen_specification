import { describe, expect, it } from "vitest";
import {
  nearestNode, alignmentGuides, angleAt, draftChainArea,
} from "../src/planner/wallGeometry.js";
import { WALL_MATERIALS, wallMaterialById } from "../src/planner/catalog.js";
import { wallFieldsFromTool, defaultWallThkForTool } from "../src/planner/wallToolPresets.js";

describe("WALL_MATERIALS", () => {
  it("defines remplanner materials with thickness", () => {
    expect(WALL_MATERIALS.bearing.thk).toBe(250);
    expect(WALL_MATERIALS.glass.thk).toBe(40);
    expect(wallMaterialById("pgb").color).toBe("#2f6f8f");
  });
});

describe("wallToolPresets", () => {
  it("maps tools to material defaults", () => {
    expect(defaultWallThkForTool("wall_bearing")).toBe(250);
    expect(wallFieldsFromTool("wall_glass", "partition", {}, 100).material).toBe("glass");
    expect(wallFieldsFromTool("wall_glass", "partition", {}, 100).thk).toBe(40);
  });
});

describe("wall draft helpers", () => {
  const walls = [
    { id: "h", pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] },
    { id: "v", pts: [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }] },
  ];
  const nodes = { n1: { x: 4000, y: 0 } };

  it("nearestNode finds wall endpoint", () => {
    const hit = nearestNode({ x: 4005, y: 3 }, nodes, walls, 1, 12);
    expect(hit).toBeTruthy();
    expect(hit.kind).toMatch(/node|wall/);
  });

  it("alignmentGuides returns axis guides from start point", () => {
    const guides = alignmentGuides(nodes, walls, { x: 2000, y: 100 }, { w: 12000, h: 8000 }, { x: 0, y: 0 });
    expect(guides.some((g) => g.type === "H")).toBe(true);
    expect(guides.some((g) => g.type === "V")).toBe(true);
  });

  it("angleAt returns corner angle at node", () => {
    const angles = angleAt({ x: 4000, y: 0 }, walls);
    expect(angles).toContain(90);
  });

  it("draftChainArea for closing rectangle", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 3000 },
      { x: 0, y: 3000 },
      { x: 0, y: 0 },
    ];
    const area = draftChainArea(pts);
    expect(area).toBeCloseTo(12, 0);
  });
});
