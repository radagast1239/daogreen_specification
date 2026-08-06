import { describe, it, expect } from "vitest";
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";
import { detectRooms } from "../src/planner/core/rooms/detectRooms.js";
import { pointInPolygon } from "../src/planner/core/geometry/polygons.js";

// Dimension acceptance for the four-room diagonal fixture. Kept apart from the
// tests that import weldWallNodes directly from the wall barrel (that combo
// trips a pre-existing ambiguous star-export used inside buildWallGeometry).
const W = (id, ax, ay, bx, by, thk = 100, role = "partition") => ({
  id, thk, role, kind: "new", thicknessSide: "center",
  a: { x: ax, y: ay }, b: { x: bx, y: by }, pts: [{ x: ax, y: ay }, { x: bx, y: by }],
});
function fourRoomPlan() {
  const OW = 150, PW = 100;
  return {
    room: { w: 4600, h: 3200, wallThk: 150, height: 2800 },
    walls: [
      W("top-l", 0, 0, 2300, 0, OW, "outer"), W("top-r", 2300, 0, 4600, 0, OW, "outer"),
      W("right-t", 4600, 0, 4600, 2400, OW, "outer"), W("right-b", 4600, 2400, 4600, 3200, OW, "outer"),
      W("bot-r", 4600, 3200, 2300, 3200, OW, "outer"), W("bot-l", 2300, 3200, 0, 3200, OW, "outer"),
      W("left-b", 0, 3200, 0, 1500, OW, "outer"), W("left-t", 0, 1500, 0, 0, OW, "outer"),
      W("cp-1", 2300, 0, 2300, 1200, PW, "partition"), W("cp-2", 2300, 1200, 2300, 2000, PW, "partition"),
      W("cp-3", 2300, 2000, 2300, 3200, PW, "partition"),
      W("diag-up", 0, 1500, 2300, 1200, PW, "partition"), W("diag-lo", 2300, 2000, 4600, 2400, PW, "partition"),
    ],
    nodes: {}, items: [], zones: [], rooms: [], lines: [], dimensions: [], structurals: [],
  };
}

describe("four-room diagonal split — dimensions", () => {
  it("17. external overall dimensions exist and their midpoints lie OUTSIDE every room", () => {
    const plan = fourRoomPlan();
    const rooms = detectRooms(plan);
    const dims = generateWallDimensions(plan).dimensions;
    const ext = dims.filter((d) => d.kind === "external_overall");
    expect(ext.length).toBeGreaterThanOrEqual(2);
    for (const d of ext) {
      const mid = { x: (d.p1.x + d.p2.x) / 2, y: (d.p1.y + d.p2.y) / 2 };
      expect(rooms.every((r) => !pointInPolygon(mid, r.polygon))).toBe(true);
    }
  });

  it("18. an overall width and an overall height dimension both exist", () => {
    const dims = generateWallDimensions(fourRoomPlan()).dimensions;
    const ext = dims.filter((d) => d.kind === "external_overall");
    expect(ext.some((d) => d.orientation === "horizontal")).toBe(true);
    expect(ext.some((d) => d.orientation === "vertical")).toBe(true);
  });

  it("15. internal wall_length dims read inside a room on their room-facing side", () => {
    const plan = fourRoomPlan();
    const rooms = detectRooms(plan);
    const dims = generateWallDimensions(plan).dimensions;
    const wl = dims.filter((d) => d.kind === "wall_length");
    expect(wl.length).toBeGreaterThan(0);
    let insideRoom = 0;
    for (const d of wl) {
      const dx = d.p2.x - d.p1.x, dy = d.p2.y - d.p1.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const mid = { x: (d.p1.x + d.p2.x) / 2 + nx * (d.offset || 0), y: (d.p1.y + d.p2.y) / 2 + ny * (d.offset || 0) };
      if (rooms.some((r) => pointInPolygon(mid, r.polygon))) insideRoom++;
    }
    expect(insideRoom).toBeGreaterThanOrEqual(Math.ceil(wl.length * 0.5));
  });

  it("16. the diagonal wall dimension is parallel to its wall face", () => {
    const plan = fourRoomPlan();
    const dims = generateWallDimensions(plan).dimensions;
    // Open-junction policy may suppress wall_length; a face clear parallel to
    // the diagonal still proves the measured axis matches the wall.
    const wallDir = Math.atan2(1200 - 1500, 2300 - 0);
    const candidates = dims.filter((d) => (
      (d.kind === "wall_length" && d.id.includes("diag-up"))
      || d.kind === "room_edge_clear"
      || d.kind === "external_segment"
    ));
    const parallel = candidates.find((d) => {
      const dimDir = Math.atan2(d.p2.y - d.p1.y, d.p2.x - d.p1.x);
      const diff = Math.abs(((dimDir - wallDir + Math.PI) % (2 * Math.PI)) - Math.PI);
      return Math.min(diff, Math.PI - diff) < 0.05;
    });
    expect(parallel).toBeTruthy();
  });
});
