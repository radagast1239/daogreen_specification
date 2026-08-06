/**
 * Rendered regions must never masquerade as topology rooms.
 *
 * The contour generator finds visible enclosed regions from the drawn wall mass,
 * which is what makes dimensions correct even when wall topology is damaged. But
 * that same strength can hide a broken plan: two partitions that CROSS without a
 * shared node leave detectRooms reporting one room while the mass plainly
 * encloses four. Geometry may be measured; identity may not be invented.
 */
import { describe, it, expect } from "vitest";
import { detectRooms } from "../src/planner/core/rooms/detectRooms.js";
import {
  buildRenderedContours,
  reconcileRegionsWithRooms,
  findUnnodedCrossings,
  regionFingerprint,
  CONTOUR_DIAGNOSTICS,
} from "../src/planner/core/walls/renderedContours.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { commitDrawnWall } from "../src/planner/core/walls/wallDrawTopology.js";
import { syncRoomsSafe } from "../src/planner/core/rooms/syncRooms.js";

const W = (id, ax, ay, bx, by, thk = 100) => ({
  id, thk, role: "outer", kind: "new", thicknessSide: "center", height: 3000,
  a: { x: ax, y: ay }, b: { x: bx, y: by },
  pts: [{ x: ax, y: ay }, { x: bx, y: by }],
});
const mkPlan = (walls) => ({
  room: { w: 12000, h: 8000, wallThk: 100, height: 3000 },
  walls, nodes: {}, items: [], zones: [], rooms: [], lines: [],
  dimensions: [], structurals: [], validationWarnings: [],
});

/** Partitions cross at (4000,2500) but neither is split there. */
const crossingWithoutNode = () => mkPlan([
  W("t", 0, 0, 8000, 0), W("b", 0, 5000, 8000, 5000),
  W("l", 0, 0, 0, 5000), W("r", 8000, 0, 8000, 5000),
  W("ph", 0, 2500, 8000, 2500),
  W("pv", 4000, 0, 4000, 5000),
]);

/** Same shape, but every crossing already split into a shared node. */
function normalizedCross() {
  let seq = 0;
  const mkId = (p = "id") => `${p}_${++seq}`;
  const props = { role: "outer", kind: "new", thicknessSide: "center", thk: 100, height: 3000 };
  let plan = mkPlan([]);
  const commit = (a, b) => {
    const r = commitDrawnWall(plan, a, b, { ...props, chainId: mkId("ch") }, mkId);
    if (r.changed) plan = r.plan;
  };
  commit({ x: 0, y: 0 }, { x: 8000, y: 0 });
  commit({ x: 8000, y: 0 }, { x: 8000, y: 5000 });
  commit({ x: 8000, y: 5000 }, { x: 0, y: 5000 });
  commit({ x: 0, y: 5000 }, { x: 0, y: 0 });
  commit({ x: 4000, y: 0 }, { x: 4000, y: 5000 });
  commit({ x: 0, y: 2500 }, { x: 4000, y: 2500 });
  commit({ x: 4000, y: 2500 }, { x: 8000, y: 2500 });
  const safe = syncRoomsSafe({ ...plan, walls: resolvePlanWalls(plan) });
  return safe.ok ? { ...plan, rooms: safe.rooms, zones: safe.zones } : plan;
}

describe("topology / region reconciliation", () => {
  it("1. a crossing without a shared node is reported, not absorbed", () => {
    const plan = crossingWithoutNode();
    const walls = resolvePlanWalls(plan);
    const crossings = findUnnodedCrossings(walls);
    expect(crossings.length).toBeGreaterThanOrEqual(1);
    expect(crossings[0].at.x).toBeCloseTo(4000, 0);
    expect(crossings[0].at.y).toBeCloseTo(2500, 0);

    const contours = buildRenderedContours(plan);
    // the drawn mass encloses four cells...
    expect(contours.renderedRegionCount).toBe(4);
    // ...while topology sees fewer rooms
    expect(detectRooms(plan).length).toBeLessThan(4);

    const mismatch = contours.diagnostics.find(
      (d) => d.code === CONTOUR_DIAGNOSTICS.TOPOLOGY_REGION_MISMATCH,
    );
    expect(mismatch).toBeTruthy();
    expect(mismatch.renderedRegionCount).toBe(4);
    expect(mismatch.geometricCrossingCount).toBeGreaterThanOrEqual(1);
    expect(mismatch.affectedWallIds).toContain("ph");
    expect(mismatch.affectedWallIds).toContain("pv");
    expect(mismatch.missingTopologyNodes.length).toBeGreaterThanOrEqual(1);
  });

  it("2. an unmatched region is never given an invented roomId", () => {
    const contours = buildRenderedContours(crossingWithoutNode());
    const anonymous = contours.roomContours.filter((rc) => rc.anonymous);
    expect(anonymous.length).toBeGreaterThan(0);
    for (const rc of anonymous) {
      expect(rc.roomId).toBeNull();
      expect(rc.detectedRoomId).toBeNull();
      expect(rc.fingerprint).toBeTruthy();
    }
    // No roomId may exist outside the reconciliation: every non-null id must be
    // one the reconciliation actually matched to a detected room, and the number
    // of identified regions can never exceed the number of detected rooms.
    const matchedIds = new Set(contours.reconciliation.matched.map((m) => m.roomId));
    const identified = contours.roomContours.filter((rc) => rc.roomId != null);
    for (const rc of identified) expect(matchedIds.has(rc.roomId)).toBe(true);
    expect(identified.length).toBe(contours.reconciliation.matched.length);
    expect(identified.length).toBeLessThanOrEqual(detectRooms(crossingWithoutNode()).length);
    // the four visible cells cannot all be presented as rooms
    expect(identified.length).toBeLessThan(contours.renderedRegionCount);
  });

  it("3. normalized topology reconciles: 4 regions = 4 rooms, no mismatch", () => {
    const plan = normalizedCross();
    const walls = resolvePlanWalls(plan);
    expect(findUnnodedCrossings(walls)).toEqual([]);

    const rooms = detectRooms(plan);
    expect(rooms).toHaveLength(4);

    const contours = buildRenderedContours(plan, { rooms });
    expect(contours.renderedRegionCount).toBe(4);
    expect(contours.detectedRoomCount).toBe(4);
    expect(contours.reconciliation.matched).toHaveLength(4);
    expect(contours.reconciliation.unmatchedRegions).toEqual([]);
    expect(contours.reconciliation.unmatchedRooms).toEqual([]);
    expect(
      contours.diagnostics.filter((d) => d.code === CONTOUR_DIAGNOSTICS.TOPOLOGY_REGION_MISMATCH),
    ).toEqual([]);
    for (const rc of contours.roomContours) {
      expect(rc.roomId).toBeTruthy();
      expect(rc.anonymous).toBe(false);
    }
  });

  it("4. every matched region maps to exactly one room (no double-claiming)", () => {
    const plan = normalizedCross();
    const contours = buildRenderedContours(plan);
    const roomIds = contours.reconciliation.matched.map((m) => m.roomId);
    expect(new Set(roomIds).size).toBe(roomIds.length);
  });

  it("5. wall order reversal preserves the reconciliation", () => {
    const plan = normalizedCross();
    const sig = (p) => {
      const c = buildRenderedContours(p);
      return JSON.stringify({
        regions: c.renderedRegionCount,
        rooms: c.detectedRoomCount,
        matched: c.reconciliation.matched.map((m) => m.fingerprint).sort(),
        unmatched: c.reconciliation.unmatchedRegions.map((r) => r.fingerprint).sort(),
      });
    };
    expect(sig({ ...plan, walls: [...plan.walls].reverse() })).toBe(sig(plan));
  });

  it("6. fingerprints are geometric and stable across rebuilds", () => {
    const plan = normalizedCross();
    const a = buildRenderedContours(plan).roomContours.map((rc) => rc.fingerprint).sort();
    const b = buildRenderedContours(plan).roomContours.map((rc) => rc.fingerprint).sort();
    expect(b).toEqual(a);
    expect(a.every((f) => /^-?\d+:-?\d+:-?\d+:-?\d+$/.test(f))).toBe(true);
  });

  it("7. reconcileRegionsWithRooms is pure and reports both directions", () => {
    const regionOnly = reconcileRegionsWithRooms(
      [{ id: "r1", loop: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], bbox: { x0: 0, y0: 0, x1: 100, y1: 100, w: 100, h: 100 } }],
      [],
      [],
    );
    expect(regionOnly.unmatchedRegions).toHaveLength(1);
    expect(regionOnly.matched).toEqual([]);
    expect(regionOnly.diagnostics[0].code).toBe(CONTOUR_DIAGNOSTICS.TOPOLOGY_REGION_MISMATCH);

    const roomOnly = reconcileRegionsWithRooms([], [{ id: "room-x", polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }], []);
    expect(roomOnly.unmatchedRooms).toEqual(["room-x"]);
  });

  it("8. a shared endpoint is not reported as an unnoded crossing", () => {
    // an L: the two walls meet at a shared node, which is not a crossing
    const plan = mkPlan([W("a", 0, 0, 4000, 0), W("b", 4000, 0, 4000, 3000)]);
    expect(findUnnodedCrossings(resolvePlanWalls(plan))).toEqual([]);
  });

  it("9. regionFingerprint rounds to whole millimetres", () => {
    expect(regionFingerprint({ x0: 49.9999, y0: 50.0001, x1: 3950.4, y1: 2949.6 }))
      .toBe("50:50:3950:2950");
  });
});
