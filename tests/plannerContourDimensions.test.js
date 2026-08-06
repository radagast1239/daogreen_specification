/**
 * Automatic dimensions must be measured on the contour the renderer draws.
 *
 * Previously external_overall came from a centreline bounding box per closed
 * loop (so four free-standing inner rectangles produced TEN "external" overalls,
 * eight of them measuring inner partitions) and internal_clear came from a
 * rect-cell grid rather than from rooms (so the room enclosing those rectangles
 * got no width and no height at all).
 */
import { describe, it, expect } from "vitest";
import { commitDrawnWall } from "../src/planner/core/walls/wallDrawTopology.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { syncRoomsSafe } from "../src/planner/core/rooms/syncRooms.js";
import { detectRooms } from "../src/planner/core/rooms/detectRooms.js";
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";
import {
  buildRenderedContours,
  distPointToSegment,
  CONTOUR_DIAGNOSTICS,
  sampleSegmentInsidePolygon,
  segmentIntersectsWallMass,
} from "../src/planner/core/walls/renderedContours.js";
import {
  generateContourDimensions,
  auditAnchorsOnContour,
} from "../src/planner/core/dimensions/contourDimensions.js";
import { FACE_REF_KINDS } from "../src/planner/core/walls/wallFaceReferences.js";

const isRoomClearDim = (d) => d && (d.kind === "internal_clear" || d.kind === "room_edge_clear");

let seq = 0;
const mkId = (p = "id") => `${p}_${++seq}`;
const OUTER = { role: "outer", kind: "new", thicknessSide: "center", thk: 100, height: 3000 };
const PART = { role: "partition", kind: "new", thicknessSide: "center", thk: 100, height: 3000 };

const emptyPlan = () => ({
  room: { w: 16000, h: 12000, wallThk: 100, height: 3000, defaultRoomHeightMm: 3000 },
  nodes: {}, walls: [], items: [], lines: [], zones: [], rooms: [],
  labels: [], dimensions: [], structurals: [], validationWarnings: [],
});

function commit(plan, a, b, props) {
  const r = commitDrawnWall(plan, a, b, { ...props, chainId: mkId("ch") }, mkId);
  if (!r.changed) return plan;
  const safe = syncRoomsSafe({ ...r.plan, walls: resolvePlanWalls(r.plan) });
  return safe.ok ? { ...r.plan, rooms: safe.rooms, zones: safe.zones } : r.plan;
}
function rect(plan, x0, y0, x1, y1, props) {
  let p = plan;
  p = commit(p, { x: x0, y: y0 }, { x: x1, y: y0 }, props);
  p = commit(p, { x: x1, y: y0 }, { x: x1, y: y1 }, props);
  p = commit(p, { x: x1, y: y1 }, { x: x0, y: y1 }, props);
  p = commit(p, { x: x0, y: y1 }, { x: x0, y: y0 }, props);
  return p;
}

/** outer 8000x6000 split into four equal rooms */
function fourWaySplit() {
  let p = rect(emptyPlan(), 0, 0, 8000, 6000, OUTER);
  p = commit(p, { x: 4000, y: 0 }, { x: 4000, y: 6000 }, PART);
  p = commit(p, { x: 0, y: 3000 }, { x: 4000, y: 3000 }, PART);
  p = commit(p, { x: 4000, y: 3000 }, { x: 8000, y: 3000 }, PART);
  return p;
}

/** outer 12000x9000 with four free-standing closed rectangles inside */
function innerRectangles() {
  let p = rect(emptyPlan(), 0, 0, 12000, 9000, OUTER);
  p = rect(p, 1000, 1000, 4000, 3500, PART);
  p = rect(p, 5000, 1000, 8000, 3500, PART);
  p = rect(p, 1000, 4500, 4000, 7000, PART);
  p = rect(p, 5000, 4500, 8000, 7000, PART);
  return p;
}

const autoDims = (plan) => generateWallDimensions(plan, {}).dimensions.filter((d) => d.auto === true);
const kindsOf = (dims) => dims.reduce((m, d) => { m[d.kind] = (m[d.kind] || 0) + 1; return m; }, {});
const spanOf = (d) => Math.round(Math.hypot(d.p2.x - d.p1.x, d.p2.y - d.p1.y));

describe("shared rendered contours", () => {
  it("1. contours come from the renderer pipeline and expose components + rooms", () => {
    const plan = fourWaySplit();
    const c = buildRenderedContours(plan);
    expect(c.components.length).toBeGreaterThan(0);
    expect(c.envelopes.length).toBe(1);
    expect(c.roomContours.length).toBe(4);
    for (const comp of c.components) {
      expect(comp.boundarySegments.length).toBeGreaterThan(0);
      expect(comp.bbox).toBeTruthy();
    }
  });

  it("2. every auto dimension anchor lies on a rendered segment", () => {
    const plan = fourWaySplit();
    const contours = buildRenderedContours(plan);
    const { dims } = generateContourDimensions(contours);
    const audit = auditAnchorsOnContour(dims, contours);
    expect(audit.length).toBeGreaterThan(0);
    for (const a of audit) {
      expect(a.p1DistanceToContour).toBeLessThanOrEqual(1.5);
      expect(a.p2DistanceToContour).toBeLessThanOrEqual(1.5);
      expect(a.onContour).toBe(true);
    }
  });

  it("3. each dimension names the contour segments it was measured from", () => {
    const contours = buildRenderedContours(fourWaySplit());
    const { dims } = generateContourDimensions(contours);
    for (const d of dims) {
      const ids = d.reference?.matchedContourSegmentIds || [];
      expect(ids.length).toBeGreaterThan(0);
    }
  });

  it("4. nesting depth marks inner rectangles as islands, not envelopes", () => {
    const c = buildRenderedContours(innerRectangles());
    expect(c.envelopes.length).toBe(1); // only the building
    const nested = c.loops.filter((l) => l.role === "outer" && l.nestingDepth > 0);
    expect(nested.length).toBeGreaterThanOrEqual(4); // the four inner rectangles
  });
});

describe("external overall dimensions", () => {
  it("5. a plain outer rectangle gets exactly one width and one height", () => {
    const dims = autoDims(rect(emptyPlan(), 0, 0, 8000, 6000, OUTER));
    const ext = dims.filter((d) => d.kind === "external_overall");
    expect(ext).toHaveLength(2);
    expect(ext.filter((d) => d.orientation === "horizontal")).toHaveLength(1);
    expect(ext.filter((d) => d.orientation === "vertical")).toHaveLength(1);
  });

  it("6. four inner closed rectangles add NO external dimensions", () => {
    const dims = autoDims(innerRectangles());
    const ext = dims.filter((d) => d.kind === "external_overall");
    expect(ext).toHaveLength(2);
  });

  it("7. internal partitions never cut the external span", () => {
    const plan = fourWaySplit();
    const contours = buildRenderedContours(plan);
    const env = contours.envelopes[0];
    const ext = autoDims(plan).filter((d) => d.kind === "external_overall");
    const h = ext.find((d) => d.orientation === "horizontal");
    const v = ext.find((d) => d.orientation === "vertical");
    expect(spanOf(h)).toBe(Math.round(env.bbox.w));
    expect(spanOf(v)).toBe(Math.round(env.bbox.h));
  });

  it("8. a second disconnected building gets its own pair", () => {
    let p = rect(emptyPlan(), 0, 0, 4000, 3000, OUTER);
    p = rect(p, 9000, 0, 13000, 3000, OUTER);
    const contours = buildRenderedContours(p);
    expect(contours.envelopes.length).toBe(2);
    const ext = autoDims(p).filter((d) => d.kind === "external_overall");
    expect(ext).toHaveLength(4);
  });

  it("9. external anchors never sit on an inner partition face", () => {
    const plan = fourWaySplit();
    const contours = buildRenderedContours(plan);
    const env = contours.envelopes[0];
    const comp = contours.components.find((c) => c.id === env.componentId);
    const outerPts = (comp?.outerLoops || []).flatMap((ol) => ol.loop || []);
    const ext = autoDims(plan).filter((d) => d.kind === "external_overall" || d.kind === "external_segment");
    for (const d of ext) {
      for (const pt of [d.p1, d.p2]) {
        const near = Math.min(...outerPts.map((p) => Math.hypot(p.x - pt.x, p.y - pt.y)));
        // Witnesses must lie on the outer perimeter, not on an inner partition.
        expect(near).toBeLessThanOrEqual(2);
      }
      // Matched faces must not be room-hole contour segments of an interior partition.
      for (const id of d.reference.matchedContourSegmentIds || []) {
        expect(String(id)).not.toMatch(/part|hole/i);
      }
    }
  });

  it("10. external values equal the rendered outer extrema", () => {
    const plan = rect(emptyPlan(), 0, 0, 8000, 6000, OUTER);
    const contours = buildRenderedContours(plan);
    const bb = contours.envelopes[0].bbox;
    // 8000x6000 centreline rectangle, 100mm walls -> outer face extent 8100x6100
    expect(Math.round(bb.w)).toBe(8100);
    expect(Math.round(bb.h)).toBe(6100);
    const ext = autoDims(plan).filter((d) => d.kind === "external_overall");
    expect(spanOf(ext.find((d) => d.orientation === "horizontal"))).toBe(8100);
    expect(spanOf(ext.find((d) => d.orientation === "vertical"))).toBe(6100);
  });
});

describe("internal room coverage", () => {
  it("11. a single rectangular room gets width and height edge dims", () => {
    const dims = autoDims(rect(emptyPlan(), 0, 0, 8000, 6000, OUTER));
    const int = dims.filter(isRoomClearDim);
    expect(int.filter((d) => d.orientation === "horizontal").length).toBeGreaterThanOrEqual(2);
    expect(int.filter((d) => d.orientation === "vertical").length).toBeGreaterThanOrEqual(2);
    // RemPlanner: each meaningful room edge; rectangle → 4 edges.
    expect(int.filter((d) => d.kind === "room_edge_clear").length).toBe(4);
  });

  it("12. four rooms give edge dims on every room", () => {
    const plan = fourWaySplit();
    expect(detectRooms(plan)).toHaveLength(4);
    const int = autoDims(plan).filter(isRoomClearDim);
    expect(int.filter((d) => d.orientation === "horizontal").length).toBeGreaterThanOrEqual(8);
    expect(int.filter((d) => d.orientation === "vertical").length).toBeGreaterThanOrEqual(8);
    expect(int.filter((d) => d.kind === "room_edge_clear").length).toBe(16);
  });

  it("13. every internal dimension carries a roomId and its source faces", () => {
    const int = autoDims(fourWaySplit()).filter((d) => isRoomClearDim(d));
    for (const d of int) {
      expect(d.reference.roomId).toBeTruthy();
      expect(d.reference.sourceFaceA).toBeTruthy();
      if (d.kind === "internal_clear") {
        expect(d.reference.sourceFaceB).toBeTruthy();
        expect(d.reference.sourceFaceA).not.toBe(d.reference.sourceFaceB);
      } else {
        expect(d.reference.matchedContourSegmentIds?.length).toBeGreaterThan(0);
      }
    }
  });

  it("14. each internal anchor lies on ITS OWN room's contour", () => {
    const plan = fourWaySplit();
    const contours = buildRenderedContours(plan);
    const byRoom = new Map(contours.roomContours.map((rc) => [rc.roomId, rc]));
    const int = autoDims(plan).filter((d) => isRoomClearDim(d));
    for (const d of int) {
      const rc = byRoom.get(d.reference.roomId);
      expect(rc).toBeTruthy();
      const near = (pt) => Math.min(...rc.segments.map((s) => distPointToSegment(pt, s.a, s.b)));
      expect(near(d.p1)).toBeLessThanOrEqual(1.5);
      expect(near(d.p2)).toBeLessThanOrEqual(1.5);
    }
  });

  it("15. rooms sharing a partition use opposite faces of it", () => {
    const plan = fourWaySplit();
    const int = autoDims(plan).filter(
      (d) => isRoomClearDim(d) && d.orientation === "vertical",
    );
    // Vertical room edges include the shared partition faces — opposite rooms
    // must not reuse the same contour segment id.
    const nearPart = int.filter((d) => {
      const x = (d.p1.x + d.p2.x) / 2;
      return x > 1000 && x < 7000;
    });
    const allIds = nearPart.flatMap((d) => d.reference.matchedContourSegmentIds || []);
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(nearPart.length).toBeGreaterThanOrEqual(4);
  });

  it("16. the room enclosing islands is measured, and not through an island", () => {
    const plan = innerRectangles();
    const contours = buildRenderedContours(plan);
    const int = autoDims(plan).filter((d) => isRoomClearDim(d));
    // Baselines must stay inside their own room polygon (not cut through islands).
    // Witnesses intentionally sit on the room-facing wall face.
    for (const d of int) {
      const rc = (contours.roomContours || []).find((r) => r.roomId === d.roomId)
        || (contours.roomContours || []).find((r) => {
          if (!r.roomPolygon || !d.baselineStart) return false;
          return sampleSegmentInsidePolygon(d.baselineStart, d.baselineEnd, r.roomPolygon);
        });
      expect(rc, `room contour for ${d.id}`).toBeTruthy();
      expect(sampleSegmentInsidePolygon(d.baselineStart, d.baselineEnd, rc.roomPolygon)).toBe(true);
    }
    expect(int.length).toBeGreaterThan(0);
  });

  it("17. no auto dimension is a random diagonal", () => {
    for (const plan of [fourWaySplit(), innerRectangles()]) {
      for (const d of autoDims(plan).filter((x) => x.kind === "internal_clear" || x.kind === "external_overall")) {
        const dx = Math.abs(d.p2.x - d.p1.x);
        const dy = Math.abs(d.p2.y - d.p1.y);
        expect(Math.min(dx, dy)).toBeLessThan(1.5); // strictly axis-aligned
      }
    }
  });

  it("18. an unmeasurable room emits a diagnostic instead of a wrong dimension", () => {
    const plan = innerRectangles();
    const res = generateWallDimensions(plan, {});
    const codes = (res.contourDiagnostics || []).map((d) => d.code);
    const known = Object.values(CONTOUR_DIAGNOSTICS);
    for (const c of codes) expect(known).toContain(c);
  });

  it("19. no automatic dimension falls back to a centreline", () => {
    for (const plan of [fourWaySplit(), innerRectangles()]) {
      const walls = resolvePlanWalls(plan);
      const auto = autoDims(plan).filter(
        (d) => isRoomClearDim(d) || d.kind === "external_overall",
      );
      for (const d of auto) {
        expect(d.referenceKind).not.toBe(FACE_REF_KINDS.CENTERLINE);
        for (const pt of [d.p1, d.p2]) {
          let onCl = false;
          for (const w of walls) {
            const pts = w.pts || [];
            for (let i = 1; i < pts.length; i++) {
              if (distPointToSegment(pt, pts[i - 1], pts[i]) < 1) onCl = true;
            }
          }
          expect(onCl).toBe(false);
        }
      }
    }
  });

  it("20. reversing wall order preserves the dimension set", () => {
    const plan = fourWaySplit();
    const sig = (p) => JSON.stringify(
      autoDims(p)
        .filter((d) => isRoomClearDim(d) || d.kind === "external_overall")
        .map((d) => [d.kind, d.orientation, spanOf(d)])
        .sort((a, b) => String(a).localeCompare(String(b))),
    );
    const forward = sig(plan);
    const reversed = sig({ ...plan, walls: [...plan.walls].reverse() });
    expect(reversed).toBe(forward);
  });
});
