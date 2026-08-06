/**
 * PHASE 2F1 blocker A — rooms are described by their EDGES, never by a
 * rectangular bounding box.
 *
 * The producer diagnosis (C:\tmp\phase2f1-dimensions\room-bbox-dimension-diagnosis.txt)
 * traced the manually visible "905 x 1.00 m" and "4.22 x 1.15 m" to
 * external_overall falling back to envelope bbox min/max — minting synthetic
 * `env:bbox-w0/w1` faces whenever no opposing physical exterior face pair
 * existed. On a trapezoid that is a number measured between nothing.
 *
 * Covers required cases 1-9.
 */
import { describe, it, expect } from "vitest";
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";
import { buildRenderedContours, pointInLoop } from "../src/planner/core/walls/renderedContours.js";
import {
  DIMENSION_SEMANTIC,
  CONTOUR_ROLE,
  classifyContourRoles,
  classifyDimensionSemantic,
  isRectangularContour,
} from "../src/planner/core/dimensions/contourSemantics.js";
import { MIN_ROOM_EDGE_MM } from "../src/planner/core/dimensions/roomEdgeClearDimensions.js";

const W = {
  thk: 100, role: "outer", kind: "new", thicknessSide: "center",
  height: 3000, material: "", type: "wall",
};

function planFrom(points, chainId = "shape") {
  const nodes = {};
  points.forEach((p, i) => { nodes[`n${i}`] = { x: p.x, y: p.y }; });
  const walls = points.map((_, i) => ({
    ...W,
    id: `w${i}`,
    a: `n${i}`,
    b: `n${(i + 1) % points.length}`,
    chainId: `${chainId}_${i}`,
  }));
  return {
    nodes,
    walls,
    items: [], rooms: [], zones: [], links: [], labels: [], lines: [],
    dimensions: [], validationWarnings: [],
    room: { w: 20000, h: 20000, wallThk: 100, height: 3000 },
  };
}

const RECTANGLE = () => planFrom([
  { x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 },
]);
/** Two parallel horizontals, two oblique sides — the manual "905 x 1000" shape. */
const TRAPEZOID = () => planFrom([
  { x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 3400, y: 3000 }, { x: 600, y: 3000 },
]);
/** Oblique quadrilateral — no two opposing faces are parallel to an axis pair. */
const IRREGULAR = () => planFrom([
  { x: 0, y: 0 }, { x: 4200, y: 300 }, { x: 3900, y: 3100 }, { x: 250, y: 2600 },
]);
const L_SHAPE = () => planFrom([
  { x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 4000 },
  { x: 4000, y: 4000 }, { x: 4000, y: 8000 }, { x: 0, y: 8000 },
]);

function analyse(plan) {
  const contours = buildRenderedContours(plan, {});
  const out = generateWallDimensions(plan, {});
  const dims = out.dimensions || [];
  const roles = classifyContourRoles(contours);
  return {
    contours,
    dims,
    roles,
    semanticsOf: (d) => classifyDimensionSemantic(d, contours, roles).semantic,
    ofKind: (kind) => dims.filter((d) => d.kind === kind),
    bboxLike: dims.filter((d) => {
      const s = classifyDimensionSemantic(d, contours, roles).semantic;
      return s === DIMENSION_SEMANTIC.ROOM_BOUNDING_BOX_WIDTH
        || s === DIMENSION_SEMANTIC.ROOM_BOUNDING_BOX_HEIGHT;
    }),
  };
}

/** Labels a user would read as belonging to a room: drawn inside a room polygon. */
function dimsInsideRooms(contours, dims) {
  return dims.filter((d) => {
    const a = d.baselineStart || d.p1;
    const b = d.baselineEnd || d.p2;
    if (!a || !b) return false;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return (contours.roomContours || []).some((rc) => {
      const poly = rc.roomPolygon || rc.loop;
      return poly && pointInLoop(mid, poly);
    });
  });
}

/** Room-facing edges long enough to deserve their own dimension. */
function meaningfulRoomEdges(contours) {
  return (contours.roomContours || [])
    .flatMap((rc) => (rc.segments || []).filter((s) => (s.len || 0) >= MIN_ROOM_EDGE_MM));
}

describe("PHASE 2F1 — no rectangular room bounding-box dimensions", () => {
  it("1. an irregular room has no room bbox W/H dimensions", () => {
    const { contours, bboxLike, dims } = analyse(IRREGULAR());
    expect(contours.roomContours.length).toBeGreaterThan(0);
    expect(contours.roomContours.every((rc) => !isRectangularContour(rc))).toBe(true);
    expect(bboxLike).toEqual([]);
    expect(dims.filter((d) => d.kind === "internal_clear")).toEqual([]);
  });

  it("2. a trapezoid has no room bbox W/H dimensions", () => {
    const { contours, bboxLike, dims } = analyse(TRAPEZOID());
    expect(contours.roomContours.every((rc) => !isRectangularContour(rc))).toBe(true);
    expect(bboxLike).toEqual([]);
    expect(dims.filter((d) => d.kind === "internal_clear")).toEqual([]);
    // Specifically: no OVERALL reproduces the envelope bbox WIDTH, which is what
    // the manual screenshot showed as "905". A physical bottom edge that happens
    // to span the same extent is a real edge and stays.
    const env = contours.envelopes[0];
    const widthLike = dims.filter((d) => d.kind === "external_overall"
      && d.orientation === "horizontal"
      && Math.abs((d.measurementValue || 0) - env.bbox.w) <= 1);
    expect(widthLike).toEqual([]);
  });

  it("3. an L-shaped room has no room bbox W/H dimensions", () => {
    const { contours, bboxLike, dims } = analyse(L_SHAPE());
    expect(contours.roomContours.every((rc) => !isRectangularContour(rc))).toBe(true);
    expect(bboxLike).toEqual([]);
    expect(dims.filter((d) => d.kind === "internal_clear")).toEqual([]);
  });

  it("4. every meaningful room edge is still dimensioned, on all four shapes", () => {
    for (const make of [RECTANGLE, TRAPEZOID, IRREGULAR, L_SHAPE]) {
      const { contours, dims } = analyse(make());
      const edges = meaningfulRoomEdges(contours);
      const edgeDims = dims.filter((d) => d.kind === "room_edge_clear");
      expect(edges.length).toBeGreaterThan(0);
      expect(edgeDims.length).toBe(edges.length);
      // Each dimension is anchored ON its own edge, parallel to it, and reports
      // that edge's actual length — never a span between unrelated faces.
      const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) <= 1;
      for (const d of edgeDims) {
        const match = edges.find((s) => (near(s.a, d.p1) && near(s.b, d.p2))
          || (near(s.a, d.p2) && near(s.b, d.p1)));
        expect(match, `no room edge anchored at ${JSON.stringify(d.p1)}-${JSON.stringify(d.p2)}`).toBeTruthy();
        expect(Math.abs(match.len - d.measurementValue)).toBeLessThanOrEqual(1);
        const dimDir = Math.atan2(d.p2.y - d.p1.y, d.p2.x - d.p1.x);
        const edgeDir = Math.atan2(match.b.y - match.a.y, match.b.x - match.a.x);
        expect(Math.abs(Math.sin(dimDir - edgeDir))).toBeLessThan(0.02);
      }
    }
  });

  it("5. the outermost building contour may retain exterior overall W/H", () => {
    const { contours, dims, roles, semanticsOf } = analyse(RECTANGLE());
    const env = contours.envelopes[0];
    expect(roles.get(env.id).role).toBe(CONTOUR_ROLE.BUILDING_OUTERMOST);
    const overalls = dims.filter((d) => d.kind === "external_overall");
    expect(overalls.length).toBe(2);
    expect(overalls.every((d) => semanticsOf(d) === DIMENSION_SEMANTIC.BUILDING_EXTERIOR_OVERALL)).toBe(true);
    expect(overalls.map((d) => Math.round(d.measurementValue)).sort((a, b) => a - b))
      .toEqual([Math.round(env.bbox.h), Math.round(env.bbox.w)].sort((a, b) => a - b));
  });

  it("6. building exterior overall is never presented as a room width/height", () => {
    for (const make of [RECTANGLE, TRAPEZOID, IRREGULAR, L_SHAPE]) {
      const { contours, dims, semanticsOf } = analyse(make());
      const overalls = dims.filter((d) => d.kind === "external_overall");
      for (const d of overalls) {
        expect(semanticsOf(d)).toBe(DIMENSION_SEMANTIC.BUILDING_EXTERIOR_OVERALL);
        expect(d.roomId ?? null).toBeNull();
        expect(d.reference?.side).toBe("outer");
      }
      // Nothing drawn INSIDE a room may be anything but a room edge dimension.
      for (const d of dimsInsideRooms(contours, dims)) {
        expect(["room_edge_clear", "wall_length"]).toContain(d.kind);
      }
    }
  });

  it("7. rectangle -> irregular immediately removes room bbox semantics", () => {
    const before = analyse(RECTANGLE());
    expect(before.dims.filter((d) => d.kind === "external_overall").length).toBe(2);

    // Drag one corner off-axis: the same walls, a now-irregular shape.
    const edited = RECTANGLE();
    edited.nodes.n2 = { x: 4300, y: 3400 };
    const after = analyse(edited);
    expect(after.contours.roomContours.every((rc) => !isRectangularContour(rc))).toBe(true);
    expect(after.bboxLike).toEqual([]);
    expect(after.dims.filter((d) => d.kind === "internal_clear")).toEqual([]);
    const env = after.contours.envelopes[0];
    expect(after.dims.filter((d) => d.kind === "external_overall"
      && Math.abs(d.measurementValue - env.bbox.w) <= 1
      && (d.reference?.matchedContourSegmentIds || []).some((id) => String(id).includes(":bbox-"))))
      .toEqual([]);
  });

  it("8. irregular -> rectangle does not create duplicate room/bbox sets", () => {
    const irregular = IRREGULAR();
    const straightened = planFrom([
      { x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 },
    ]);
    void irregular;
    const { dims, bboxLike, contours } = analyse(straightened);
    expect(bboxLike).toEqual([]);
    const keys = dims.map((d) => d.generationKey || d.id);
    expect(new Set(keys).size).toBe(keys.length);
    // One overall per axis, one edge dimension per room edge — no second set.
    expect(dims.filter((d) => d.kind === "external_overall").length).toBe(2);
    expect(dims.filter((d) => d.kind === "room_edge_clear").length)
      .toBe(meaningfulRoomEdges(contours).length);
  });

  it("9. repeated edits never restore room bbox dimensions", () => {
    let plan = TRAPEZOID();
    for (let i = 0; i < 5; i++) {
      plan = {
        ...plan,
        nodes: {
          ...plan.nodes,
          n1: { x: 4000 + i * 60, y: 0 },
          n2: { x: 3400 - i * 40, y: 3000 + i * 25 },
        },
      };
      const { bboxLike, dims } = analyse(plan);
      expect(bboxLike, `iteration ${i}`).toEqual([]);
      expect(dims.filter((d) => d.kind === "internal_clear"), `iteration ${i}`).toEqual([]);
      expect(dims.filter((d) => (d.reference?.matchedContourSegmentIds || [])
        .some((id) => String(id).includes(":bbox-"))), `iteration ${i}`).toEqual([]);
    }
  });
});
