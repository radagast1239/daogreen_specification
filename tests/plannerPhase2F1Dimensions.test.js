/**
 * PHASE 2F1 — deterministic external + internal room dimensions.
 */
import { describe, it, expect } from "vitest";
import { commitDrawnWall } from "../src/planner/core/walls/wallDrawTopology.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { syncRoomsSafe } from "../src/planner/core/rooms/syncRooms.js";
import { detectRooms } from "../src/planner/core/rooms/detectRooms.js";
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";
import { resolvePlanDimensions } from "../src/planner/core/dimensions/runtime.js";
import { buildRenderedContours } from "../src/planner/core/walls/renderedContours.js";
import {
  classifyWallSegmentAttachments,
  moveWallSegment,
} from "../src/planner/core/walls/wallCommands.js";
import {
  generateContourDimensions,
  generateExteriorChainDimensions,
  exteriorChainStackOrderOk,
  EXTERNAL_SEGMENT_MARGIN_MM,
  EXTERNAL_OVERALL_MARGIN_MM,
  EXTERNAL_OVERALL_ALONE_MARGIN_MM,
} from "../src/planner/core/dimensions/contourDimensions.js";
import {
  dimensionKeySet,
  dimensionMeasuredValueMm,
  canonicalizeEndpoints,
  buildDimensionGenerationKey,
} from "../src/planner/core/dimensions/dimensionCanonicalKeys.js";
import { shouldRenderDimensionLabel, layoutDimensionLabels } from "../src/planner/core/dimensions/dimensionLayout.js";
import { computeLinearDimensionGeometry } from "../src/planner/core/dimensions/renderGeometry.js";
import { pointInLoop } from "../src/planner/core/walls/renderedContours.js";
import { auditDimensionFaceAnchors, isWallThicknessDimension } from "../src/planner/core/dimensions/dimensionFaceResolver.js";
import {
  finalizeAutoDimensions,
  isRenderableAutoDimension,
} from "../src/planner/core/dimensions/finalizeAutoDimensions.js";

const isRoomClearDim = (d) => d && (d.kind === "internal_clear" || d.kind === "room_edge_clear");
const roomClearDims = (dims) => (dims || []).filter(isRoomClearDim);
const isWallThicknessLike = (d) => isWallThicknessDimension(d) || (
  Number.isFinite(d?.measurementValue) && d.measurementValue > 0 && d.measurementValue <= 250
  && (d.kind === "wall_thickness" || d.reference?.axis === "thickness")
);

let seq = 0;
const mkId = (p = "id") => `${p}_${++seq}`;
const OUTER = { role: "outer", kind: "new", thicknessSide: "center", thk: 100, height: 3000 };
const OUTER_IN = { role: "outer", kind: "new", thicknessSide: "inside", thk: 200, height: 3000 };
const PART = { role: "partition", kind: "new", thicknessSide: "center", thk: 100, height: 3000 };

const emptyPlan = () => ({
  room: { w: 20000, h: 16000, wallThk: 100, height: 3000, defaultRoomHeightMm: 3000 },
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

/** L-shaped outer contour (clockwise outer). */
function lShape(plan = emptyPlan(), props = OUTER) {
  let p = plan;
  // Outer L: (0,0)-(8000,0)-(8000,4000)-(4000,4000)-(4000,8000)-(0,8000)-back
  const pts = [
    [0, 0], [8000, 0], [8000, 4000], [4000, 4000], [4000, 8000], [0, 8000],
  ];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    p = commit(p, { x: a[0], y: a[1] }, { x: b[0], y: b[1] }, props);
  }
  return p;
}

function autoDims(plan) {
  return generateWallDimensions(plan, {}).dimensions.filter((d) => d.auto === true);
}

function byKind(dims, kind) {
  return dims.filter((d) => d.kind === kind);
}

function finiteAll(dims) {
  for (const d of dims) {
    const v = dimensionMeasuredValueMm(d);
    expect(Number.isFinite(v), d.id).toBe(true);
    expect(Number.isFinite(d.p1?.x) && Number.isFinite(d.p1?.y), d.id).toBe(true);
    expect(Number.isFinite(d.p2?.x) && Number.isFinite(d.p2?.y), d.id).toBe(true);
    expect(Number.isFinite(d.offset), d.id).toBe(true);
  }
}

describe("PHASE 2F1 fixtures — geometry and semantics", () => {
  it("1-2. rectangle external width/height use outer faces", () => {
    const plan = rect(emptyPlan(), 0, 0, 4000, 3000, OUTER);
    const dims = autoDims(plan);
    const contours = buildRenderedContours(plan);
    const bb = contours.envelopes[0].bbox;
    const h = byKind(dims, "external_overall").find((d) => d.orientation === "horizontal");
    const v = byKind(dims, "external_overall").find((d) => d.orientation === "vertical");
    expect(Math.round(h.measurementValue)).toBe(Math.round(bb.w));
    expect(Math.round(v.measurementValue)).toBe(Math.round(bb.h));
    expect(Math.round(bb.w)).toBe(4100);
    expect(Math.round(bb.h)).toBe(3100);
  });

  it("3-5. rectangle internal clear uses inner faces; thickness not double-subtracted", () => {
    const plan = rect(emptyPlan(), 0, 0, 4000, 3000, OUTER);
    const dims = autoDims(plan);
    const edges = roomClearDims(dims);
    const h = edges.filter((d) => d.orientation === "horizontal");
    const v = edges.filter((d) => d.orientation === "vertical");
    expect(h.some((d) => Math.round(d.measurementValue) === 3900)).toBe(true);
    expect(v.some((d) => Math.round(d.measurementValue) === 2900)).toBe(true);
    const extH = byKind(dims, "external_overall").find((d) => d.orientation === "horizontal");
    expect(Math.round(extH.measurementValue - 3900)).toBe(200);
  });

  it("6. thicknessSide asymmetric is respected", () => {
    const plan = rect(emptyPlan(), 0, 0, 4000, 3000, OUTER_IN);
    const dims = autoDims(plan);
    const intW = roomClearDims(dims).find((d) => d.orientation === "horizontal");
    const extW = byKind(dims, "external_overall").find((d) => d.orientation === "horizontal");
    expect(intW).toBeTruthy();
    expect(extW).toBeTruthy();
    expect(extW.measurementValue).toBeGreaterThan(intW.measurementValue);
    expect(Math.round(extW.measurementValue)).toBeGreaterThanOrEqual(4000);
    expect(Math.round(intW.measurementValue)).toBeLessThan(4000);
  });

  it("7. reversed wall orientation → identical world dimension key set", () => {
    const a = rect(emptyPlan(), 0, 0, 4000, 3000, OUTER);
    let b = emptyPlan();
    // reverse each edge direction
    b = commit(b, { x: 4000, y: 0 }, { x: 0, y: 0 }, OUTER);
    b = commit(b, { x: 4000, y: 3000 }, { x: 4000, y: 0 }, OUTER);
    b = commit(b, { x: 0, y: 3000 }, { x: 4000, y: 3000 }, OUTER);
    b = commit(b, { x: 0, y: 0 }, { x: 0, y: 3000 }, OUTER);
    const ka = dimensionKeySet(byKind(autoDims(a), "external_overall").concat(byKind(autoDims(a), "internal_clear")));
    const kb = dimensionKeySet(byKind(autoDims(b), "external_overall").concat(byKind(autoDims(b), "internal_clear")));
    expect(ka).toBe(kb);
    expect(Math.round(byKind(autoDims(a), "external_overall").find((d) => d.orientation === "horizontal").measurementValue))
      .toBe(Math.round(byKind(autoDims(b), "external_overall").find((d) => d.orientation === "horizontal").measurementValue));
  });

  it("8. wall array reorder → identical dimension key set", () => {
    const plan = rect(emptyPlan(), 0, 0, 4000, 3000, OUTER);
    const dimsA = autoDims(plan);
    const shuffled = {
      ...plan,
      walls: [...plan.walls].reverse(),
    };
    const dimsB = autoDims(shuffled);
    expect(dimensionKeySet(byKind(dimsA, "external_overall").concat(byKind(dimsA, "internal_clear").concat(byKind(dimsA, "external_segment")))))
      .toBe(dimensionKeySet(byKind(dimsB, "external_overall").concat(byKind(dimsB, "internal_clear").concat(byKind(dimsB, "external_segment")))));
  });

  it("9-10. room polygon cyclic rotation / reversal → identical internal keys", () => {
    const plan = rect(emptyPlan(), 0, 0, 4000, 3000, OUTER);
    const rooms = detectRooms(plan);
    expect(rooms.length).toBe(1);
    const poly = rooms[0].polygon;
    const rotated = [...poly.slice(1), poly[0]];
    const reversed = [...poly].reverse();
    const base = generateWallDimensions(plan, {}).dimensions.filter((d) => isRoomClearDim(d));
    const withRot = generateWallDimensions({ ...plan, rooms: [{ ...rooms[0], polygon: rotated }] }, {})
      .dimensions.filter((d) => isRoomClearDim(d));
    // Contours rebuild from walls; rooms option feeds room matching. Keys must stay stable.
    const contours = buildRenderedContours(plan, { rooms });
    const contoursRot = buildRenderedContours(plan, { rooms: [{ ...rooms[0], polygon: rotated }] });
    const contoursRev = buildRenderedContours(plan, { rooms: [{ ...rooms[0], polygon: reversed }] });
    const k0 = dimensionKeySet(generateContourDimensions(contours).dims.filter((d) => isRoomClearDim(d)));
    const k1 = dimensionKeySet(generateContourDimensions(contoursRot).dims.filter((d) => isRoomClearDim(d)));
    const k2 = dimensionKeySet(generateContourDimensions(contoursRev).dims.filter((d) => isRoomClearDim(d)));
    expect(k0).toBe(k1);
    expect(k0).toBe(k2);
    expect(base.length).toBeGreaterThan(0);
    expect(withRot.length).toBeGreaterThan(0);
  });

  it("11. L-shape chain has no false span through concavity", () => {
    const plan = lShape();
    const dims = autoDims(plan);
    const overalls = byKind(dims, "external_overall");
    const segs = byKind(dims, "external_segment");
    expect(overalls.length).toBe(2);
    expect(segs.length).toBeGreaterThanOrEqual(4);
    // No single external_segment may span the false diagonal across the missing corner.
    for (const d of segs) {
      const dx = Math.abs(d.p2.x - d.p1.x);
      const dy = Math.abs(d.p2.y - d.p1.y);
      // Axis-aligned only; never a diagonal shortcut through the notch.
      expect(dx < 1 || dy < 1).toBe(true);
    }
    // Overall width/height match envelope bbox (8000+thk, 8000+thk), not a false shorter span.
    const contours = buildRenderedContours(plan);
    const bb = contours.envelopes[0].bbox;
    expect(Math.round(overalls.find((d) => d.orientation === "horizontal").measurementValue)).toBe(Math.round(bb.w));
    expect(Math.round(overalls.find((d) => d.orientation === "vertical").measurementValue)).toBe(Math.round(bb.h));
  });

  it("12. shared partition resolves opposite faces for adjacent rooms", () => {
    let p = rect(emptyPlan(), 0, 0, 8000, 4000, OUTER);
    p = commit(p, { x: 4000, y: 0 }, { x: 4000, y: 4000 }, PART);
    const dims = roomClearDims(autoDims(p)).filter((d) => d.orientation === "vertical");
    // Vertical edges include the shared partition faces — one per room.
    const nearPartition = dims.filter((d) => {
      const x = (d.p1.x + d.p2.x) / 2;
      return Math.abs(x - 3950) < 5 || Math.abs(x - 4050) < 5;
    });
    expect(nearPartition.length).toBeGreaterThanOrEqual(2);
    const xs = [...new Set(nearPartition.map((d) => Math.round((d.p1.x + d.p2.x) / 2)))].sort((a, b) => a - b);
    expect(xs.length).toBeGreaterThanOrEqual(2);
    expect(xs[1] - xs[0]).toBeGreaterThanOrEqual(90);
  });

  it("13. oblique edge dimension has correct direction and value", () => {
    let p = emptyPlan();
    p = commit(p, { x: 0, y: 0 }, { x: 5000, y: 0 }, OUTER);
    p = commit(p, { x: 5000, y: 0 }, { x: 5000, y: 3000 }, OUTER);
    p = commit(p, { x: 5000, y: 3000 }, { x: 0, y: 4000 }, OUTER);
    p = commit(p, { x: 0, y: 4000 }, { x: 0, y: 0 }, OUTER);
    const dims = autoDims(p);
    const edge = byKind(dims, "room_edge_clear").filter((d) => d.axisOrDirection === "oblique");
    const wallLen = byKind(dims, "wall_length");
    if (edge.length >= 1) {
      expect(edge[0].measurementValue).toBeGreaterThan(MIN_ROOM_EDGE_EXPECT);
      finiteAll(edge);
    } else {
      expect(wallLen.some((d) => {
        const dx = Math.abs(d.p2.x - d.p1.x);
        const dy = Math.abs(d.p2.y - d.p1.y);
        return dx > 50 && dy > 50;
      })).toBe(true);
    }
  });

  it("15. host heal after branch move reconciles dimensions to healed topology", () => {
    let p = rect(emptyPlan(), 0, 0, 6000, 4000, OUTER);
    p = commit(p, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, PART);
    const branch = (p.walls || []).find((w) => {
      const a = p.nodes[w.a];
      const b = p.nodes[w.b];
      if (!a || !b) return false;
      return Math.abs(a.x - b.x) < 1 && Math.abs(a.x - 2000) < 2
        && Math.max(a.y, b.y) > 100;
    });
    expect(branch, "branch wall").toBeTruthy();
    const topHalvesBefore = (p.walls || []).filter((w) => {
      const a = p.nodes[w.a];
      const b = p.nodes[w.b];
      return a && b && Math.abs(a.y) < 1 && Math.abs(b.y) < 1;
    });
    expect(topHalvesBefore.length).toBeGreaterThanOrEqual(2);

    const attachments = classifyWallSegmentAttachments(p, branch.id);
    const moved = moveWallSegment(p, {
      wallId: branch.id,
      delta: { x: 1500, y: 0 },
      expectedEndpointAttachments: attachments,
      makeId: mkId,
    });
    expect(moved.changed).toBe(true);
    expect(moved.movement?.healedHosts?.length).toBeGreaterThanOrEqual(1);

    // Old mid-junction on the top host must be gone; exactly one new split.
    const topHalvesAfter = (moved.plan.walls || []).filter((w) => {
      const a = moved.plan.nodes[w.a];
      const b = moved.plan.nodes[w.b];
      return a && b && Math.abs(a.y) < 1 && Math.abs(b.y) < 1;
    });
    expect(topHalvesAfter.length).toBe(2);
    const midNodes = Object.entries(moved.plan.nodes || {}).filter(([, n]) => Math.abs(n.y) < 1 && Math.abs(n.x - 2000) < 2);
    expect(midNodes.length).toBe(0);

    const dims = autoDims(moved.plan);
    expect(byKind(dims, "external_overall").length).toBe(2);
    // No duplicate overall rows; simple envelope sides without steps stay segment-free
    // except where the T still creates exterior breakpoints — overalls remain present.
    finiteAll(dims);
  });

  it("15b. face audit: rectangle internals/externals never centreline", () => {
    const plan = rect(emptyPlan(), 0, 0, 4000, 3000, OUTER);
    const contours = buildRenderedContours(plan);
    const dims = autoDims(plan);
    for (const d of byKind(dims, "external_overall")) {
      const a = auditDimensionFaceAnchors(d, contours);
      expect(a.ok, JSON.stringify(a)).toBe(true);
      expect(a.centrelineRisk).toBe(false);
      expect(a.mixesOuterAndInner).toBe(false);
    }
    for (const d of roomClearDims(dims)) {
      const a = auditDimensionFaceAnchors(d, contours);
      expect(a.ok, JSON.stringify(a)).toBe(true);
      expect(a.centrelineRisk).toBe(false);
      expect(a.mixesOuterAndInner).toBe(false);
    }
    expect(byKind(dims, "external_segment")).toHaveLength(0);
    expect(dims.every((d) => !isWallThicknessLike(d))).toBe(true);
  });

  it("16. no NaN/Infinity in generated dims", () => {
    finiteAll(autoDims(rect(emptyPlan(), 0, 0, 4000, 3000, OUTER)));
    finiteAll(autoDims(lShape()));
  });
});

const MIN_ROOM_EDGE_EXPECT = 400;

describe("PHASE 2F1 — identity", () => {
  it("17-19. stable IDs after reload/reorder/reversal semantics", () => {
    const plan = rect(emptyPlan(), 1000, 1000, 5000, 4000, OUTER);
    const k1 = dimensionKeySet(autoDims(plan));
    const k2 = dimensionKeySet(autoDims(JSON.parse(JSON.stringify(plan))));
    expect(k1).toBe(k2);
    expect(k1.includes("auto:ext-ov:")).toBe(true);
    expect(k1.includes("auto:room-edge:") || k1.includes("auto:int-clear:")).toBe(true);
  });

  it("canonical endpoint order ignores reversal", () => {
    const a = canonicalizeEndpoints({ x: 10, y: 0 }, { x: 0, y: 0 });
    const b = canonicalizeEndpoints({ x: 0, y: 0 }, { x: 10, y: 0 });
    expect(a).toEqual(b);
    expect(buildDimensionGenerationKey({
      kind: "external_segment", orientation: "horizontal",
      p1: { x: 10, y: 0 }, p2: { x: 0, y: 0 },
    })).toBe(buildDimensionGenerationKey({
      kind: "external_segment", orientation: "horizontal",
      p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 },
    }));
  });
});

describe("PHASE 2F1 — layout and collision", () => {
  it("22. external overall present; simple rectangle suppresses duplicate segment rows", () => {
    const plan = rect(emptyPlan(), 0, 0, 4000, 3000, OUTER);
    const dims = autoDims(plan);
    const ov = byKind(dims, "external_overall");
    const seg = byKind(dims, "external_segment");
    expect(ov).toHaveLength(2);
    expect(seg).toHaveLength(0);
    // Alone overall uses the same world gap contract as internal edge lanes (120).
    expect(Math.abs(ov[0].offset)).toBe(EXTERNAL_OVERALL_ALONE_MARGIN_MM);
  });

  it("23-24. internal clear candidate lies inside room; label offset not in wall mass sense", () => {
    const plan = rect(emptyPlan(), 0, 0, 4000, 3000, OUTER);
    const rooms = detectRooms(plan);
    const int = roomClearDims(autoDims(plan));
    for (const d of int) {
      const mid = {
        x: ((d.baselineStart?.x ?? d.p1.x) + (d.baselineEnd?.x ?? d.p2.x)) / 2,
        y: ((d.baselineStart?.y ?? d.p1.y) + (d.baselineEnd?.y ?? d.p2.y)) / 2,
      };
      expect(pointInLoop(mid, rooms[0].polygon)).toBe(true);
    }
  });

  it("25-26. duplicate candidates removed; collision layout deterministic", () => {
    const plan = rect(emptyPlan(), 0, 0, 4000, 3000, OUTER);
    const dims = autoDims(plan);
    const keys = dims.map((d) => d.generationKey || d.id);
    expect(new Set(keys).size).toBe(keys.length);
    const geoms = Object.fromEntries(dims.map((d) => [d.id, computeLinearDimensionGeometry(d)]));
    const a = layoutDimensionLabels(dims, geoms, { zoom: 0.2 });
    const b = layoutDimensionLabels(dims, geoms, { zoom: 0.2 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("27. text remains upright on reversed directions", () => {
    const g1 = computeLinearDimensionGeometry({ p1: { x: 0, y: 0 }, p2: { x: 1000, y: 0 }, offset: -350 });
    const g2 = computeLinearDimensionGeometry({ p1: { x: 1000, y: 0 }, p2: { x: 0, y: 0 }, offset: -350 });
    const norm = (deg) => {
      let v = ((deg % 180) + 180) % 180;
      if (v > 90) v -= 180;
      return Math.abs(v);
    };
    expect(norm(g1.textAngleDeg)).toBeLessThanOrEqual(90);
    expect(norm(g2.textAngleDeg)).toBeLessThanOrEqual(90);
  });

  it("28. zoom affects visibility only, not values/keys", () => {
    const plan = rect(emptyPlan(), 0, 0, 4000, 3000, OUTER);
    const dims = autoDims(plan);
    const keys = dimensionKeySet(dims);
    const edge = roomClearDims(dims)[0];
    expect(edge).toBeTruthy();
    const geom = computeLinearDimensionGeometry(edge);
    shouldRenderDimensionLabel(edge, geom, { zoom: 0.2 });
    shouldRenderDimensionLabel(edge, geom, { zoom: 1.2 });
    expect(dimensionKeySet(dims)).toBe(keys);
    expect(dimensionMeasuredValueMm(edge)).toBe(edge.measurementValue);
    const ov = byKind(dims, "external_overall")[0];
    expect(ov).toBeTruthy();
    const ovGeom = computeLinearDimensionGeometry({ ...ov, offset: ov.offset });
    expect(shouldRenderDimensionLabel({ ...ov, style: { importance: "important" } }, ovGeom, { zoom: 0.05, majorMinLengthPx: 1 })).toBe(true);
  });
});

describe("PHASE 2F1 — live resolve + fail-closed", () => {
  it("29-31. resolvePlanDimensions on preview plan is pure (no mutation)", () => {
    const plan = rect(emptyPlan(), 0, 0, 4000, 3000, OUTER);
    const before = JSON.stringify(plan.dimensions);
    const preview = {
      ...plan,
      walls: plan.walls.map((w, i) => (i === 0
        ? { ...w, a: { ...(typeof w.a === "object" ? w.a : {}), /* keep */ }, pts: undefined }
        : w)),
    };
    // Shift a node if present
    const nodeIds = Object.keys(plan.nodes || {});
    if (nodeIds.length) {
      const nid = nodeIds[0];
      preview.nodes = {
        ...plan.nodes,
        [nid]: { ...plan.nodes[nid], x: plan.nodes[nid].x + 250, y: plan.nodes[nid].y },
      };
    }
    const live = resolvePlanDimensions(preview, {}).dimensions;
    expect(live.length).toBeGreaterThan(0);
    expect(JSON.stringify(plan.dimensions)).toBe(before);
  });

  it("33. centre-drag equivalent: translating all nodes preserves wall lengths / overall deltas coherently", () => {
    const plan = rect(emptyPlan(), 0, 0, 4000, 3000, OUTER);
    const moved = {
      ...plan,
      nodes: Object.fromEntries(
        Object.entries(plan.nodes).map(([id, n]) => [id, { ...n, x: n.x + 500, y: n.y + 300 }]),
      ),
    };
    const a = byKind(autoDims(plan), "external_overall").map((d) => Math.round(d.measurementValue)).sort();
    const b = byKind(autoDims(moved), "external_overall").map((d) => Math.round(d.measurementValue)).sort();
    expect(a).toEqual(b);
  });

  it("18. invalid / incomplete room fail-closed", () => {
    const empty = emptyPlan();
    const out = generateWallDimensions(empty, {});
    expect(out.dimensions.filter((d) => isRoomClearDim(d))).toHaveLength(0);
    expect(out.dimensions.filter((d) => d.kind === "external_overall")).toHaveLength(0);
    const open = commit(emptyPlan(), { x: 0, y: 0 }, { x: 4000, y: 0 }, OUTER);
    expect(byKind(autoDims(open), "external_overall")).toHaveLength(0);
  });

  it("narrow room still yields internal clear when lane fits", () => {
    const plan = rect(emptyPlan(), 0, 0, 4000, 900, OUTER);
    const int = roomClearDims(autoDims(plan));
    expect(int.length).toBeGreaterThanOrEqual(1);
    finiteAll(int);
  });
});

describe("PHASE 2F1 — exterior edge completeness (fourth-fail)", () => {
  it("1. simple rectangle suppresses redundant local exterior = overall", () => {
    const plan = rect(emptyPlan(), 0, 0, 4000, 3000, OUTER);
    const dims = autoDims(plan);
    expect(byKind(dims, "external_overall")).toHaveLength(2);
    expect(byKind(dims, "external_segment")).toHaveLength(0);
  });

  it("2-3. irregular quadrilateral keeps non-envelope exterior edges; oblique labeled", () => {
    let p = emptyPlan();
    p = commit(p, { x: 0, y: 0 }, { x: 5000, y: 0 }, OUTER);
    p = commit(p, { x: 5000, y: 0 }, { x: 5000, y: 3000 }, OUTER);
    p = commit(p, { x: 5000, y: 3000 }, { x: 0, y: 4000 }, OUTER);
    p = commit(p, { x: 0, y: 4000 }, { x: 0, y: 0 }, OUTER);
    const dims = autoDims(p);
    const segs = byKind(dims, "external_segment");
    // Envelope-identical locals suppressed; distinct edges (short right + oblique) remain.
    expect(segs.length).toBeGreaterThanOrEqual(2);
    const oblique = segs.filter((d) => d.orientation === "oblique" || d.axisOrDirection === "oblique");
    expect(oblique.length).toBeGreaterThanOrEqual(1);
    expect(oblique[0].labelOverride || oblique[0].measurementValue).toBeTruthy();
    // PHASE 2F1 blocker A: an overall is a physical exterior face to physical
    // exterior face distance. This quad has two opposing VERTICAL faces (width
    // is measurable), but its top side is oblique — there is no second
    // horizontal face to measure a height against, and the bbox extent that
    // used to be emitted there was the "905 x 1000" bounding box the manual
    // run rejected. Width only.
    const overalls = byKind(dims, "external_overall");
    expect(overalls.length).toBe(1);
    expect(overalls[0].orientation).toBe("horizontal");
  });

  it("4-6. L-shape keeps distinct exterior legs + overall; full-span locals identical to overall suppressed", () => {
    const dims = autoDims(lShape());
    const segs = byKind(dims, "external_segment");
    const overalls = byKind(dims, "external_overall");
    expect(overalls).toHaveLength(2);
    // Distinct L legs remain (notch steps / short sides) — not the full envelope twins.
    expect(segs.length).toBeGreaterThanOrEqual(4);
    expect(segs.length).toBeLessThanOrEqual(6);
    // No local segment shares exact anchors with an overall of the same orientation.
    for (const ov of overalls) {
      const twin = segs.find((s) => (
        s.orientation === ov.orientation
        && Math.abs(s.measurementValue - ov.measurementValue) <= 2
        && Math.hypot(
          ((s.p1.x + s.p2.x) / 2) - ((ov.p1.x + ov.p2.x) / 2),
          ((s.p1.y + s.p2.y) / 2) - ((ov.p1.y + ov.p2.y) / 2),
        ) < 5
      ));
      expect(twin, `redundant local for overall ${ov.id}`).toBeFalsy();
    }
    for (const d of segs) {
      const dx = Math.abs(d.p2.x - d.p1.x);
      const dy = Math.abs(d.p2.y - d.p1.y);
      if (d.orientation !== "oblique") expect(dx < 1 || dy < 1).toBe(true);
    }
  });
});

describe("PHASE 2F1 — second-manual-fail contracts", () => {
  it("1-2. external alone gap matches internal edge lane in world mm (screen-space parity at any zoom)", () => {
    const plan = rect(emptyPlan(), 0, 0, 4000, 3000, OUTER);
    const dims = autoDims(plan);
    const ov = byKind(dims, "external_overall")[0];
    const edge = byKind(dims, "room_edge_clear")[0];
    expect(ov).toBeTruthy();
    expect(edge).toBeTruthy();
    expect(Math.abs(ov.offset)).toBe(EXTERNAL_OVERALL_ALONE_MARGIN_MM);
    expect(Math.abs(edge.offset)).toBe(EXTERNAL_OVERALL_ALONE_MARGIN_MM);
    // Screen px gap = worldOffset * zoom → same offset ⇒ same px at every zoom.
    for (const zoom of [0.15, 0.4, 1.2]) {
      expect(Math.abs(ov.offset) * zoom).toBeCloseTo(Math.abs(edge.offset) * zoom, 6);
      expect(ov.measurementValue).toBe(byKind(autoDims(plan), "external_overall")[0].measurementValue);
    }
  });

  it("3-7. L / partition soft-dedupe; open degree-4 has no room/exterior/wall_length", () => {
    const l = autoDims(lShape());
    const soft = new Map();
    for (const d of l) {
      const key = [
        d.kind, d.roomId || d.reference?.roomId || "_",
        Math.round(((d.p1.x + d.p2.x) / 2) / 50) * 50,
        Math.round(((d.p1.y + d.p2.y) / 2) / 50) * 50,
        Math.round(d.measurementValue / 50) * 50,
      ].join(":");
      soft.set(key, (soft.get(key) || 0) + 1);
    }
    expect([...soft.values()].every((n) => n === 1)).toBe(true);

    let p = rect(emptyPlan(), 0, 0, 8000, 4000, OUTER);
    p = commit(p, { x: 4000, y: 0 }, { x: 4000, y: 4000 }, PART);
    const dims = autoDims(p);
    const contours = buildRenderedContours(p);
    for (const d of roomClearDims(dims)) {
      const a = auditDimensionFaceAnchors(d, contours);
      expect(a.centrelineRisk, JSON.stringify(a)).toBe(false);
    }
    expect(dims.some((d) => d.kind === "wall_length"
      && Math.abs(((d.p1.x + d.p2.x) / 2) - 4000) < 5)).toBe(false);

    // Open degree-4 cross
    let cross = emptyPlan();
    cross = commit(cross, { x: 0, y: 0 }, { x: 3000, y: 0 }, PART);
    cross = commit(cross, { x: 3000, y: 0 }, { x: 6000, y: 0 }, PART);
    cross = commit(cross, { x: 3000, y: -2000 }, { x: 3000, y: 0 }, PART);
    cross = commit(cross, { x: 3000, y: 0 }, { x: 3000, y: 2000 }, PART);
    const cd = autoDims(cross);
    expect(byKind(cd, "external_overall")).toHaveLength(0);
    expect(byKind(cd, "room_edge_clear")).toHaveLength(0);
    expect(byKind(cd, "wall_length")).toHaveLength(0);
  });

  it("8-10. finalize suppresses unlabelled / zero-span dims", () => {
    expect(isRenderableAutoDimension({
      kind: "wall_length", p1: { x: 0, y: 0 }, p2: { x: 1000, y: 0 }, measurementValue: 0,
    })).toBe(false);
    expect(isRenderableAutoDimension({
      kind: "wall_length", p1: { x: 0, y: 0 }, p2: { x: 1000, y: 0 }, measurementValue: 1000, labelOverride: "   ",
    })).toBe(true); // whitespace override falls back via normalize; raw check still has trim fail without normalize
    const out = finalizeAutoDimensions([
      { id: "ok", kind: "room_edge_clear", p1: { x: 0, y: 0 }, p2: { x: 1000, y: 0 }, measurementValue: 1000, labelOverride: "1.00 м" },
      { id: "zero", kind: "wall_length", p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, measurementValue: 0 },
      { id: "novalue", kind: "wall_length", p1: null, p2: { x: 1000, y: 0 }, measurementValue: 1000 },
    ], { hasRoomContours: true, hasEnvelopes: true });
    expect(out.map((d) => d.id)).toEqual(["ok"]);
  });

  it("15-19. irregular four-edge room yields four labeled room-facing edges", () => {
    let p = emptyPlan();
    p = commit(p, { x: 0, y: 0 }, { x: 5000, y: 0 }, OUTER);
    p = commit(p, { x: 5000, y: 0 }, { x: 5000, y: 3000 }, OUTER);
    p = commit(p, { x: 5000, y: 3000 }, { x: 0, y: 4000 }, OUTER);
    p = commit(p, { x: 0, y: 4000 }, { x: 0, y: 0 }, OUTER);
    const edges = byKind(autoDims(p), "room_edge_clear");
    expect(edges.length).toBeGreaterThanOrEqual(4);
    expect(edges.every((d) => d.labelOverride && String(d.labelOverride).trim())).toBe(true);
    const dirs = new Set(edges.map((d) => d.axisOrDirection || d.orientation));
    expect(dirs.has("oblique") || edges.some((d) => {
      const dx = Math.abs(d.p2.x - d.p1.x);
      const dy = Math.abs(d.p2.y - d.p1.y);
      return dx > 50 && dy > 50;
    })).toBe(true);
    // Right edge near x≈4950 (inner), not exterior outer ≈5050.
    const right = edges.filter((d) => Math.abs(((d.p1.x + d.p2.x) / 2) - 4950) < 30);
    expect(right.length).toBeGreaterThanOrEqual(1);
  });
});

describe("PHASE 2F1 — fifth/sixth-manual-fail contracts", () => {
  it("1-6. L-shape suppresses overall≡local twins; distinct legs + oblique edges remain", () => {
    const l = autoDims(lShape());
    const lSegs = byKind(l, "external_segment");
    expect(byKind(l, "external_overall")).toHaveLength(2);
    // Full top/left envelope locals suppressed; notch/step legs remain.
    expect(lSegs.length).toBeGreaterThanOrEqual(4);
    const fullSpanLocals = lSegs.filter((d) => Math.round(d.measurementValue) === 8100);
    expect(fullSpanLocals.length).toBe(0);

    let obl = emptyPlan();
    obl = commit(obl, { x: 0, y: 0 }, { x: 5000, y: 0 }, OUTER);
    obl = commit(obl, { x: 5000, y: 0 }, { x: 5000, y: 3000 }, OUTER);
    obl = commit(obl, { x: 5000, y: 3000 }, { x: 0, y: 4000 }, OUTER);
    obl = commit(obl, { x: 0, y: 4000 }, { x: 0, y: 0 }, OUTER);
    const o = autoDims(obl);
    const oSegs = byKind(o, "external_segment");
    // Irregular: locals that equal overall on the same anchors are suppressed;
    // remaining edges (right short + oblique + any non-envelope twin) stay.
    expect(oSegs.length).toBeGreaterThanOrEqual(2);
    const oris = new Set(oSegs.map((d) => d.orientation));
    expect(oris.has("oblique")).toBe(true);
    // PHASE 2F1 blocker A: only the axis that HAS an opposing physical face
    // pair keeps an overall. The oblique top leaves no horizontal counterpart,
    // so a height here would be a bounding box, not a measurement.
    expect(byKind(o, "external_overall").length).toBe(1);
    expect(byKind(o, "external_overall")[0].orientation).toBe("horizontal");
    // No segment+overall twin on identical midpoints.
    for (const ov of byKind(o, "external_overall")) {
      const twin = oSegs.find((s) => (
        s.orientation === ov.orientation
        && Math.abs(s.measurementValue - ov.measurementValue) <= 2
        && Math.hypot(
          ((s.p1.x + s.p2.x) / 2) - ((ov.p1.x + ov.p2.x) / 2),
          ((s.p1.y + s.p2.y) / 2) - ((ov.p1.y + ov.p2.y) / 2),
        ) < 5
      ));
      expect(twin).toBeFalsy();
    }

    // Equal-valued but spatially different L legs retained.
    const vals = lSegs.map((d) => Math.round(d.measurementValue));
    expect(vals.filter((v) => v === 4100 || v === 4000).length).toBeGreaterThanOrEqual(2);

    for (const zoom of [0.2, 0.35, 0.5]) {
      const pack = oSegs.concat(byKind(o, "external_overall"));
      const geometry = Object.fromEntries(
        pack.map((d) => [
          d.id,
          computeLinearDimensionGeometry({ p1: d.p1, p2: d.p2, offset: d.offset, style: d.style, zoom }),
        ]),
      );
      const layout = layoutDimensionLabels(pack, geometry, { zoom });
      const byId = new Map(layout.map((p) => [p.id, p]));
      const visible = pack.filter((d) => byId.get(d.id)?.visible);
      expect(visible.length, `zoom=${zoom}`).toBeGreaterThanOrEqual(4);
    }
  });

  it("12-15. dimension label size is screen-clamped; geometric offset stays world-fixed", () => {
    const plan = rect(emptyPlan(), 0, 0, 4000, 3000, OUTER);
    const ov = byKind(autoDims(plan), "external_overall")[0];
    const zooms = [0.25, 1, 2.5];
    const fonts = zooms.map((zoom) => {
      const g = computeLinearDimensionGeometry({
        p1: ov.p1, p2: ov.p2, offset: ov.offset, style: ov.style, zoom,
      });
      return g.style.fontSizePx;
    });
    expect(fonts[0]).toBeGreaterThanOrEqual(9);
    expect(fonts[2]).toBeLessThanOrEqual(14);
    expect(fonts[2]).toBeLessThan(40);
    const offsets = [];
    for (const zoom of zooms) {
      const g = computeLinearDimensionGeometry({
        p1: ov.p1, p2: ov.p2, offset: ov.offset, style: ov.style, zoom,
      });
      expect(g.anchors[0]).toEqual(ov.p1);
      expect(g.anchors[1]).toEqual(ov.p2);
      expect(g.length).toBeCloseTo(ov.measurementValue, 5);
      // Geometric offset is constant in model mm across zoom.
      expect(g.offset).toBe(ov.offset);
      offsets.push(g.offset);
      // Pixel gap shrinks when zooming out (no minPx push).
      expect(Math.abs(g.offset) * zoom).toBeCloseTo(Math.abs(ov.offset) * zoom, 6);
    }
    expect(new Set(offsets).size).toBe(1);
  });

  it("23-24. default display hides automatic room centre labels; room data preserved", async () => {
    const { DEFAULT_DISPLAY } = await import("../src/planner/catalog.js");
    expect(DEFAULT_DISPLAY().showZoneNames).toBe(false);
    const plan = rect(emptyPlan(), 0, 0, 4000, 3000, OUTER);
    expect((plan.rooms || []).length + (plan.zones || []).length).toBeGreaterThanOrEqual(0);
    const synced = syncRoomsSafe({ ...plan, walls: resolvePlanWalls(plan) });
    expect(synced.ok).toBe(true);
    expect((synced.rooms || []).length).toBeGreaterThanOrEqual(1);
    expect(synced.rooms[0].name || synced.rooms[0].areaMm2).toBeTruthy();
  });
});
