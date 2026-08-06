import { describe, it, expect } from "vitest";
import { detectRooms, resolveRoomLabelPosition } from "../src/planner/core/rooms/detectRooms.js";
import { weldWallNodes, resolveWallPtsList } from "../src/planner/core/walls/wallOps.js";
import { pointInPolygon, polygonArea } from "../src/planner/core/geometry/index.js";
// Four-room diagonal split (Remplanner reference structure):
// one outer rectangle, one central vertical partition (split into segments),
// an upper diagonal splitting the LEFT half, a lower diagonal splitting the
// RIGHT half -> exactly four rooms.
const W = (id, ax, ay, bx, by, thk = 100, role = "partition") => ({
  id, thk, role, kind: "new", thicknessSide: "center",
  a: { x: ax, y: ay }, b: { x: bx, y: by }, pts: [{ x: ax, y: ay }, { x: bx, y: by }],
});
function fourRoomWalls() {
  const OW = 150, PW = 100;
  return [
    W("top-l", 0, 0, 2300, 0, OW, "outer"), W("top-r", 2300, 0, 4600, 0, OW, "outer"),
    W("right-t", 4600, 0, 4600, 2400, OW, "outer"), W("right-b", 4600, 2400, 4600, 3200, OW, "outer"),
    W("bot-r", 4600, 3200, 2300, 3200, OW, "outer"), W("bot-l", 2300, 3200, 0, 3200, OW, "outer"),
    W("left-b", 0, 3200, 0, 1500, OW, "outer"), W("left-t", 0, 1500, 0, 0, OW, "outer"),
    W("cp-1", 2300, 0, 2300, 1200, PW, "partition"), W("cp-2", 2300, 1200, 2300, 2000, PW, "partition"),
    W("cp-3", 2300, 2000, 2300, 3200, PW, "partition"),
    W("diag-up", 0, 1500, 2300, 1200, PW, "partition"), W("diag-lo", 2300, 2000, 4600, 2400, PW, "partition"),
  ];
}
const fourRoomPlan = (walls = fourRoomWalls()) => ({
  room: { w: 4600, h: 3200, wallThk: 150, height: 2800 },
  walls, nodes: {}, items: [], zones: [], rooms: [], lines: [], dimensions: [], structurals: [],
});
const ENVELOPE = 4600 * 3200; // mm²

function polysOverlap(a, b, samples = 24) {
  const xs = [...a, ...b].map((p) => p.x), ys = [...a, ...b].map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let both = 0, cell = ((x1 - x0) / samples) * ((y1 - y0) / samples);
  for (let i = 0; i < samples; i++) for (let j = 0; j < samples; j++) {
    const p = { x: x0 + (i + 0.5) * (x1 - x0) / samples, y: y0 + (j + 0.5) * (y1 - y0) / samples };
    // shrink toward centroid a hair to avoid shared-edge false positives
    if (pointInPolygon(p, a) && pointInPolygon(p, b)) both++;
  }
  return both * cell;
}

describe("four-room diagonal split — room detection", () => {
  it("1/2. produces exactly 4 rooms, no ghost parent", () => {
    const rooms = detectRooms(fourRoomPlan());
    expect(rooms).toHaveLength(4);
    for (const r of rooms) expect(r.areaMm2).toBeLessThan(ENVELOPE * 0.75); // none is the whole envelope
  });

  it("3. room polygons do not meaningfully overlap", () => {
    const rooms = detectRooms(fourRoomPlan());
    for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
      const ov = polysOverlap(rooms[i].polygon, rooms[j].polygon);
      const smaller = Math.min(rooms[i].areaMm2, rooms[j].areaMm2);
      expect(ov).toBeLessThan(smaller * 0.05);
    }
  });

  it("4/5. room areas positive and sum ≈ clean interior (< envelope, > 80% of it)", () => {
    const rooms = detectRooms(fourRoomPlan());
    for (const r of rooms) expect(r.areaMm2).toBeGreaterThan(0);
    const sum = rooms.reduce((s, r) => s + r.areaMm2, 0);
    expect(sum).toBeLessThan(ENVELOPE);
    expect(sum).toBeGreaterThan(ENVELOPE * 0.8);
  });

  it("13/14. each room gets exactly one label placed inside its own polygon", () => {
    const rooms = detectRooms(fourRoomPlan());
    const walls = weldWallNodes(resolveWallPtsList(fourRoomPlan().walls, {}));
    const labels = rooms.map((r) => resolveRoomLabelPosition(r.polygon, walls, []));
    for (let i = 0; i < rooms.length; i++) {
      expect(pointInPolygon(labels[i], rooms[i].polygon)).toBe(true);
      // label of room i is not inside any OTHER room
      for (let j = 0; j < rooms.length; j++) {
        if (j !== i) expect(pointInPolygon(labels[i], rooms[j].polygon)).toBe(false);
      }
    }
  });

  it("19. reversed wall endpoints preserve exactly 4 rooms", () => {
    const rev = fourRoomWalls().map((w) => W(w.id, w.b.x, w.b.y, w.a.x, w.a.y, w.thk, w.role));
    expect(detectRooms(fourRoomPlan(rev))).toHaveLength(4);
  });

  it("20. shuffled wall array is deterministic (same 4 rooms by area)", () => {
    const base = detectRooms(fourRoomPlan()).map((r) => Math.round(r.areaMm2)).sort((a, b) => a - b);
    const shuffled = [...fourRoomWalls()].reverse();
    const got = detectRooms(fourRoomPlan(shuffled)).map((r) => Math.round(r.areaMm2)).sort((a, b) => a - b);
    expect(got).toEqual(base);
  });

  it("21. re-running detection on the same plan is stable", () => {
    const a = detectRooms(fourRoomPlan()).map((r) => Math.round(r.areaMm2)).sort((x, y) => x - y);
    const b = detectRooms(fourRoomPlan()).map((r) => Math.round(r.areaMm2)).sort((x, y) => x - y);
    expect(b).toEqual(a);
  });
});
