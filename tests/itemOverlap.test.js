import { describe, expect, it } from "vitest";
import {
  canStackOnTable,
  isAllowedTableStack,
  isTableSurface,
  itemOverlapsBlocked,
} from "../src/planner/itemOverlap.js";

describe("itemOverlap", () => {
  const tank = { id: "t1", kind: "tank", x: 0, y: 0, w: 2000, h: 1400, layer: "water" };
  const rack = { id: "r1", kind: "rack", x: 100, y: 100, w: 1220, h: 600, layer: "racks" };
  const table = { id: "tb1", kind: "table_sow", x: 500, y: 500, w: 2000, h: 800, layer: "furn" };
  const notebook = { id: "n1", kind: "notebook", x: 600, y: 600, w: 370, h: 260, layer: "furn" };
  const benchScales = { id: "s1", kind: "scales_tb", x: 700, y: 650, w: 320, h: 280, layer: "furn" };
  const floorScales = { id: "sf1", kind: "scales_fl", x: 700, y: 650, w: 700, h: 700, layer: "furn" };

  it("recognizes table surfaces and stackable kinds", () => {
    expect(isTableSurface("table_sow")).toBe(true);
    expect(isTableSurface("rack")).toBe(false);
    expect(canStackOnTable("notebook")).toBe(true);
    expect(canStackOnTable("scales_tb")).toBe(true);
    expect(canStackOnTable("rack")).toBe(false);
  });

  it("blocks rack overlapping tank on another layer", () => {
    const candidate = { ...rack, x: 200, y: 300 };
    const r = itemOverlapsBlocked(candidate, [tank]);
    expect(r.blocked).toBe(true);
    expect(r.conflicting?.id).toBe("t1");
  });

  it("allows notebook on table", () => {
    expect(isAllowedTableStack(notebook, table)).toBe(true);
    const r = itemOverlapsBlocked(notebook, [table]);
    expect(r.blocked).toBe(false);
  });

  it("allows bench scales on table", () => {
    const r = itemOverlapsBlocked(benchScales, [table]);
    expect(r.blocked).toBe(false);
  });

  it("blocks rack on table", () => {
    const candidate = { ...rack, x: 600, y: 600 };
    const r = itemOverlapsBlocked(candidate, [table]);
    expect(r.blocked).toBe(true);
  });

  it("blocks notebook on floor scales", () => {
    const candidate = { ...notebook, x: 720, y: 700 };
    const r = itemOverlapsBlocked(candidate, [floorScales]);
    expect(r.blocked).toBe(true);
  });

  it("ignores wall-mounted items", () => {
    const door = { id: "d1", kind: "door", x: 600, y: 600, w: 900, h: 120, wall: true };
    const r = itemOverlapsBlocked(notebook, [door]);
    expect(r.blocked).toBe(false);
  });

  it("excludes moving items from collision set", () => {
    const candidate = { ...rack, x: 100, y: 100 };
    const r = itemOverlapsBlocked(candidate, [rack], { excludeId: "r1" });
    expect(r.blocked).toBe(false);
  });
});
