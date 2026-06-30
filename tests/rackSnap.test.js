import { describe, expect, it } from "vitest";
import { snapRackNeighbor } from "../src/planner/plannerSnap.js";

describe("snapRackNeighbor", () => {
  const rackA = { id: "a", kind: "rack", x: 0, y: 0, w: 1000, h: 600 };
  const rackB = { id: "b", kind: "rack", x: 1200, y: 0, w: 1000, h: 600 };

  it("snaps left edge flush to neighbor right edge", () => {
    const moving = { id: "c", kind: "rack", w: 1000, h: 600 };
    const sticky = { x: null, y: null, atX: null, atY: null };
    const r = snapRackNeighbor(moving, 1010, 5, [rackA, moving], 80, sticky);
    expect(r.x).toBe(1000);
    expect(r.snappedX).toBe(true);
  });

  it("prefers adjacency over center alignment", () => {
    const moving = { id: "c", kind: "rack", w: 1000, h: 600 };
    const sticky = { x: null, y: null, atX: null, atY: null };
    const r = snapRackNeighbor(moving, 1010, 0, [rackA, moving], 80, sticky);
    expect(r.x).toBe(1000);
    expect(r.y).toBe(0);
  });

  it("keeps sticky snap inside release zone", () => {
    const moving = { id: "c", kind: "rack", w: 1000, h: 600 };
    const sticky = { x: null, y: null, atX: null, atY: null };
    snapRackNeighbor(moving, 1010, 0, [rackA, moving], 80, sticky);
    const r2 = snapRackNeighbor(moving, 1055, 0, [rackA, moving], 80, sticky);
    expect(r2.x).toBe(1000);
    expect(r2.snappedX).toBe(true);
  });
});
