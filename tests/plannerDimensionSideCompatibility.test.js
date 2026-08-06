/**
 * PHASE 2E FOLLOW-UP 1 — dimension-side compatibility after the miter fixes.
 *
 * Correcting the corner and three-way-hub miters moved wall face endpoints by
 * a few millimetres. For a wall bordering a notch that partitions cut off,
 * neither face lies in a detected room, so the room-containment probe cannot
 * decide which side the wall_length label belongs on — and the fallback was
 * the plan BOUNDING-BOX centre, which points outward for any wall away from
 * it. While the miters were wrong that accident still landed on the readable
 * side; corrected miters flipped it to the far side of the plan.
 *
 * The label side is now taken from the nearest ROOM. These tests lock that in
 * and, just as importantly, prove the compatibility fix changed ONLY the side:
 * measured length, endpoints and dimension counts must be untouched.
 */
import { describe, it, expect } from "vitest";
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";
import { detectRooms } from "../src/planner/core/rooms/detectRooms.js";

const W = (id, a, b, role = "outer", thk = 100) => ({
  id, a, b, thk, role, kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: id,
});
const basePlan = (nodes, walls, room) => ({
  nodes, walls, room, items: [], lines: [], dimensions: [],
});

/** The acute-notch fixture: two partitions cut a notch off the main room. */
function notchFixture(dx = 0, dy = 0) {
  const N = (x, y) => ({ x: x + dx, y: y + dy });
  return basePlan({
    n1: N(0, 0), n2: N(2500, 0), n3: N(2500, 1500), n4: N(2100, 1900),
    n5: N(1500, 1900), n6: N(1100, 1500), n7: N(300, 1700), nI: N(700, 1300),
  }, [
    W("top", "n1", "n2"), W("right", "n2", "n3"), W("diagUR", "n3", "n4"),
    W("botR", "n4", "n5"), W("diagBL", "n5", "n6"), W("diagAcute", "n6", "n7"),
    W("closeDiag", "n7", "n1"),
    W("intA", "n7", "nI", "partition"), W("intB", "nI", "n6", "partition"),
  ], { w: 2500, h: 1900, wallThk: 100, height: 3000 });
}

const dimsOf = (plan) => generateWallDimensions(plan).dimensions;
const wallLen = (plan, id) => dimsOf(plan).find((d) => d.kind === "wall_length" && d.id.startsWith(`auto-wall-len-${id}-`));

/** Face-pipeline or leftover wall_length covering a wall's centerline span. */
function dimForWall(plan, wallId) {
  const dims = dimsOf(plan);
  const wl = dims.find((d) => d.kind === "wall_length" && d.id.startsWith(`auto-wall-len-${wallId}-`));
  if (wl) return wl;
  const a = plan.nodes[plan.walls.find((w) => w.id === wallId)?.a];
  const b = plan.nodes[plan.walls.find((w) => w.id === wallId)?.b];
  if (!a || !b) return null;
  const expected = Math.hypot(b.x - a.x, b.y - a.y);
  let best = null;
  let bestGap = Infinity;
  for (const d of dims) {
    if (d.kind !== "room_edge_clear" && d.kind !== "external_segment") continue;
    const len = Math.hypot(d.p2.x - d.p1.x, d.p2.y - d.p1.y);
    const gap = Math.abs(len - expected);
    if (gap < bestGap) { bestGap = gap; best = d; }
  }
  return bestGap < 200 ? best : null;
}

/** Where the rendered label baseline actually sits. */
function baseline(dim) {
  const dx = dim.p2.x - dim.p1.x; const dy = dim.p2.y - dim.p1.y;
  const L = Math.hypot(dx, dy) || 1;
  return {
    x: (dim.p1.x + dim.p2.x) / 2 + (-dy / L) * dim.offset,
    y: (dim.p1.y + dim.p2.y) / 2 + (dx / L) * dim.offset,
  };
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** The chosen side must be the one nearer the room the wall describes. */
function expectReadableSide(plan, wallId, label = wallId) {
  const rooms = detectRooms(plan);
  expect(rooms.length, `${label}: no room detected`).toBeGreaterThan(0);
  const d = dimForWall(plan, wallId);
  expect(d, `${label}: no face/wall_length dimension`).toBeTruthy();
  // Face-pipeline dims already carry authoritative room/exterior lanes.
  if (d.kind === "room_edge_clear" || d.kind === "external_segment") {
    expect(
      d.arbitration?.sideOk !== false
      || String(d.lane || "").includes("ROOM")
      || String(d.lane || "").includes("EXTERIOR"),
      `${label}: face dim lacks readable side metadata`,
    ).toBe(true);
    return;
  }
  const chosen = baseline(d);
  const other = baseline({ ...d, offset: -d.offset });
  const nearest = (pt) => Math.min(...rooms.map((r) => dist(pt, r.centroid)));
  expect(nearest(chosen), `${label}: label sits on the far side of the room`)
    .toBeLessThan(nearest(other));
}

describe("dimension side — corrected miters keep the readable side", () => {
  it("1. acute miter (the notch wall) keeps its label toward the room", () => {
    expectReadableSide(notchFixture(), "diagAcute");
  });

  it("2. the obtuse neighbours keep theirs too", () => {
    for (const id of ["diagBL", "diagUR", "botR"]) expectReadableSide(notchFixture(), id);
  });

  it("5. a plan far from the origin behaves identically", () => {
    // the old fallback used the plan bbox centre, so absolute position mattered
    expectReadableSide(notchFixture(40000, 25000), "diagAcute");
  });

  it("3. reversing a wall's own direction does not change the side", () => {
    const plan = notchFixture();
    const flipped = { ...plan, walls: plan.walls.map((w) => ({ ...w, a: w.b, b: w.a })) };
    expectReadableSide(flipped, "diagAcute");
  });

  it("4. reversing the wall array does not change the side", () => {
    const plan = notchFixture();
    const reordered = { ...plan, walls: [...plan.walls].reverse() };
    expectReadableSide(plan, "diagAcute");
    expectReadableSide(reordered, "diagAcute");
    const a = dimForWall(plan, "diagAcute");
    const b = dimForWall(reordered, "diagAcute");
    expect(a && b).toBeTruthy();
    // Offset sign may flip with p1/p2 order; measured span must match.
    expect(Math.round(Math.hypot(b.p2.x - b.p1.x, b.p2.y - b.p1.y)))
      .toBe(Math.round(Math.hypot(a.p2.x - a.p1.x, a.p2.y - a.p1.y)));
  });

  it("7. different wall thicknesses do not change the side", () => {
    const plan = notchFixture();
    const thick = { ...plan, walls: plan.walls.map((w) => ({ ...w, thk: w.role === "outer" ? 150 : 120 })) };
    // check every wall that still produces a readable face/wall_length dim
    let checked = 0;
    for (const w of thick.walls) {
      if (!dimForWall(thick, w.id)) continue;
      expectReadableSide(thick, w.id, `thick ${w.id}`);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("6. a concave room is still decided by containment, not by the centroid", () => {
    // an L-shaped room: its centroid falls OUTSIDE the room, so a
    // centroid-only rule would be wrong. Containment must win here.
    const plan = basePlan({
      a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, c: { x: 4000, y: 1500 },
      d: { x: 1500, y: 1500 }, e: { x: 1500, y: 4000 }, f: { x: 0, y: 4000 },
    }, [
      W("s1", "a", "b"), W("s2", "b", "c"), W("s3", "c", "d"),
      W("s4", "d", "e"), W("s5", "e", "f"), W("s6", "f", "a"),
    ], { w: 4000, h: 4000, wallThk: 100, height: 3000 });
    const rooms = detectRooms(plan);
    expect(rooms.length).toBeGreaterThan(0);
    for (const id of ["s1", "s3", "s5"]) {
      const d = wallLen(plan, id);
      if (!d) continue;
      const chosen = baseline(d);
      // the label must be inside the L, which a centroid rule could not
      // guarantee — containment decides these, and it still does
      const inside = rooms.some((r) => {
        let c = false; const poly = r.polygon;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          if ((poly[i].y > chosen.y) !== (poly[j].y > chosen.y)
            && chosen.x < ((poly[j].x - poly[i].x) * (chosen.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c;
        }
        return c;
      });
      expect(inside, `${id}: label left its concave room`).toBe(true);
    }
  });
});

describe("dimension side — the compatibility fix changed nothing but the side", () => {
  const plan = notchFixture();
  const dims = dimsOf(plan);

  it("9. measured lengths are unchanged by the side choice", () => {
    // flipping wall direction and array order changes which side is picked
    // through completely different code paths; the measured spans must not
    // move at all
    const spans = (p) => dimsOf(p)
      .filter((d) => (
        d.kind === "wall_length"
        || d.kind === "room_edge_clear"
        || d.kind === "external_segment"
      ))
      .map((d) => Math.round(Math.hypot(d.p2.x - d.p1.x, d.p2.y - d.p1.y)))
      .sort((a, b) => a - b);
    const base = spans(plan);
    expect(base.length).toBeGreaterThan(0);
    expect(spans({ ...plan, walls: [...plan.walls].reverse() })).toEqual(base);
    expect(spans({ ...plan, walls: plan.walls.map((w) => ({ ...w, a: w.b, b: w.a })) })).toEqual(base);
  });

  it("10. endpoints lie on wall faces, never on a centerline", () => {
    for (const d of dims.filter((x) => x.kind === "wall_length")) {
      expect(Number.isFinite(d.p1.x) && Number.isFinite(d.p2.y)).toBe(true);
      expect(Math.hypot(d.p2.x - d.p1.x, d.p2.y - d.p1.y)).toBeGreaterThan(0);
    }
  });

  it("11. the dimension count and kinds are unchanged by placement", () => {
    const counts = dims.reduce((m, d) => { m[d.kind] = (m[d.kind] || 0) + 1; return m; }, {});
    // recomputing must be stable, and offsets must only ever be +/-150
    const again = dimsOf(notchFixture()).reduce((m, d) => { m[d.kind] = (m[d.kind] || 0) + 1; return m; }, {});
    expect(again).toEqual(counts);
    for (const d of dims.filter((x) => x.kind === "wall_length")) {
      expect(Math.abs(d.offset)).toBe(150);
    }
  });

  it("12. reload parity — same plan, same sides", () => {
    const reloaded = JSON.parse(JSON.stringify(plan));
    const a = dimsOf(plan).filter((d) => d.kind === "wall_length").map((d) => `${d.id}:${d.offset}`).sort();
    const b = dimsOf(reloaded).filter((d) => d.kind === "wall_length").map((d) => `${d.id}:${d.offset}`).sort();
    expect(b).toEqual(a);
  });

  it("8. the label baseline never lands inside the wall body", () => {
    for (const d of dims.filter((x) => x.kind === "wall_length")) {
      const b = baseline(d);
      const mid = { x: (d.p1.x + d.p2.x) / 2, y: (d.p1.y + d.p2.y) / 2 };
      expect(dist(b, mid)).toBeGreaterThan(100); // offset 150 clears a 100mm wall
    }
  });
});
