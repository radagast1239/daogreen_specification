import { describe, expect, it } from "vitest";
import {
  createWallGestureState,
  wallGesturePointerDown,
  wallGesturePointerMove,
  wallGesturePointerUp,
  wallGestureCancel,
  wallGestureMarkCommitted,
  shouldBlockWallGeometryDrag,
  consumePostCommitClick,
  WALL_DRAW_MIN_LEN_MM,
} from "../src/planner/core/walls/wallDrawGestures.js";
import {
  commitDrawnWall,
  assertHostSplitPreservesSegment,
} from "../src/planner/core/walls/wallDrawTopology.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { syncRooms, ensureUniqueRoomLabels } from "../src/planner/core/rooms/syncRooms.js";
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";
import {
  FACE_REF_KINDS,
  buildWallFaceReferences,
  resolveRoomFacingReference,
  anchorsOnCenterline,
} from "../src/planner/core/walls/wallFaceReferences.js";
import { pointInPolygon } from "../src/planner/core/geometry/polygons.js";

function uidFactory(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function rectPlan() {
  return {
    nodes: {
      n1: { x: 0, y: 0 },
      n2: { x: 6000, y: 0 },
      n3: { x: 6000, y: 4000 },
      n4: { x: 0, y: 4000 },
    },
    walls: [
      { id: "top", a: "n1", b: "n2", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "c1" },
      { id: "right", a: "n2", b: "n3", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "c1" },
      { id: "bot", a: "n3", b: "n4", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "c1" },
      { id: "left", a: "n4", b: "n1", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "c1" },
    ],
    room: { w: 6000, h: 4000, wallThk: 100, height: 3000 },
    items: [],
    rooms: [],
    zones: [],
    dimensions: [],
  };
}

function distToSeg(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

describe("wall tool gesture ownership", () => {
  it("1. wall mode click on wall starts pending draft", () => {
    let s = createWallGestureState();
    const r = wallGesturePointerDown(s, {
      point: { x: 3000, y: 0 },
      screenX: 10,
      screenY: 10,
      hostWallId: "top",
    });
    expect(r.action).toBe("start-pending");
    expect(r.state.phase).toBe("pending");
    expect(r.state.hostWallId).toBe("top");
  });

  it("2-3. wall mode must not allow geometry drag / select", () => {
    expect(shouldBlockWallGeometryDrag("wall")).toBe(true);
    expect(shouldBlockWallGeometryDrag("select")).toBe(false);
  });

  it("4. pointermove updates preview without mutating host contract", () => {
    let s = createWallGestureState();
    s = wallGesturePointerDown(s, {
      point: { x: 3000, y: 0 },
      screenX: 0,
      screenY: 0,
      hostWallId: "top",
    }).state;
    const moved = wallGesturePointerMove(s, { x: 3000, y: 2000 });
    expect(moved.action).toBe("preview");
    expect(moved.state.end).toEqual({ x: 3000, y: 2000 });
    expect(moved.state.start).toEqual({ x: 3000, y: 0 });
  });

  it("5-6. commit action does not imply moveWall/moveNode (pure gesture)", () => {
    let s = createWallGestureState();
    s = wallGesturePointerDown(s, {
      point: { x: 3000, y: 0 },
      screenX: 0,
      screenY: 0,
      hostWallId: "top",
      now: 1000,
    }).state;
    s = wallGesturePointerMove(s, { x: 3000, y: 2000 }).state;
    const r = wallGesturePointerDown(s, {
      point: { x: 3000, y: 4000 },
      screenX: 0,
      screenY: 200,
      hostWallId: "bot",
      now: 1600,
    });
    expect(r.action).toBe("commit");
    expect(r.start).toEqual({ x: 3000, y: 0 });
    expect(r.end).toEqual({ x: 3000, y: 4000 });
  });

  it("7. post-commit synthetic click is suppressed (click-family only)", () => {
    const committed = wallGestureMarkCommitted(createWallGestureState());
    expect(committed.suppressNextClick).toBe(true);

    // The trailing click/dblclick after a commit is eaten exactly once.
    const first = consumePostCommitClick(committed);
    expect(first.consumed).toBe(true);
    expect(first.state.suppressNextClick).toBe(false);
    expect(consumePostCommitClick(first.state).consumed).toBe(false);
    expect(consumePostCommitClick(createWallGestureState()).consumed).toBe(false);
  });

  it("7b. post-commit suppression never swallows the next intentional press", () => {
    // Regression: pointerdown is always a fresh physical press, so consuming the
    // post-commit flag here silently dropped the first click of every wall drawn
    // after a commit — consecutive partitions did nothing.
    const s = wallGestureMarkCommitted(createWallGestureState());
    const r = wallGesturePointerDown(s, {
      point: { x: 1, y: 1 },
      screenX: 1,
      screenY: 1,
      hostWallId: "top",
    });
    expect(r.action).toBe("start-pending");
    expect(r.state.phase).toBe("pending");
    expect(r.state.start).toEqual({ x: 1, y: 1 });
    expect(r.state.hostWallId).toBe("top");
    expect(r.state.suppressNextClick).toBe(false);
  });

  it("8. Esc / cancel leaves gesture idle (host unchanged by gesture layer)", () => {
    let s = createWallGestureState();
    s = wallGesturePointerDown(s, {
      point: { x: 3000, y: 0 },
      screenX: 0,
      screenY: 0,
      hostWallId: "top",
    }).state;
    s = wallGestureCancel();
    expect(s.phase).toBe("idle");
    expect(s.start).toBeNull();
  });

  it("9-10. select mode is not blocked", () => {
    expect(shouldBlockWallGeometryDrag("select")).toBe(false);
  });

  it("12. wall-mode stationary double click opens properties", () => {
    let s = createWallGestureState();
    s = wallGesturePointerDown(s, {
      point: { x: 3000, y: 0 },
      screenX: 40,
      screenY: 40,
      hostWallId: "top",
      now: 1000,
    }).state;
    const r = wallGesturePointerDown(s, {
      point: { x: 3000, y: 0 },
      screenX: 41,
      screenY: 40,
      hostWallId: "top",
      now: 1200,
    });
    expect(r.action).toBe("open-properties");
    expect(r.wallId).toBe("top");
  });

  it("13. moving after first click remains normal drawing", () => {
    let s = createWallGestureState();
    s = wallGesturePointerDown(s, {
      point: { x: 3000, y: 0 },
      screenX: 0,
      screenY: 0,
      hostWallId: "top",
      now: 1000,
    }).state;
    s = wallGesturePointerMove(s, { x: 3000, y: 1800 }).state;
    const r = wallGesturePointerDown(s, {
      point: { x: 3000, y: 2000 },
      screenX: 0,
      screenY: 180,
      hostWallId: null,
      now: 1300,
    });
    expect(r.action).toBe("commit");
    expect(Math.hypot(r.end.x - r.start.x, r.end.y - r.start.y)).toBeGreaterThanOrEqual(WALL_DRAW_MIN_LEN_MM);
  });

  it("drag-release commit keeps suppress flag", () => {
    let s = createWallGestureState();
    s = wallGesturePointerDown(s, {
      point: { x: 0, y: 0 },
      screenX: 0,
      screenY: 0,
      now: 1,
    }).state;
    s = wallGesturePointerMove(s, { x: 2000, y: 0 }).state;
    const up = wallGesturePointerUp(s, { point: { x: 2000, y: 0 }, commitOnRelease: true });
    expect(up.action).toBe("commit");
    expect(up.state.suppressNextClick).toBe(true);
  });
});

describe("host split immutability", () => {
  it("14-19. split segments reconstruct original host", () => {
    const plan = rectPlan();
    const before = resolvePlanWalls(plan).find((w) => w.id === "top");
    const original = { a: before.pts[0], b: before.pts[before.pts.length - 1], thk: before.thk };
    const r = commitDrawnWall(
      plan,
      { x: 3000, y: 0 },
      { x: 3000, y: 4000 },
      { thk: 100, role: "partition", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      uidFactory("t"),
    );
    expect(r.changed).toBe(true);
    expect(r.meta?.startHostInvariant?.ok !== false).toBe(true);
    expect(r.meta?.endHostInvariant?.ok !== false).toBe(true);

    const after = resolvePlanWalls(r.plan);
    const splitIds = r.meta.startSplitWallIds || [];
    expect(splitIds.length).toBeGreaterThanOrEqual(2);
    const parts = after.filter((w) => splitIds.includes(w.id));
    expect(parts.length).toBeGreaterThanOrEqual(2);
    const inv = assertHostSplitPreservesSegment(
      original,
      { a: parts[0].pts[0], b: parts[0].pts[parts[0].pts.length - 1], thk: parts[0].thk },
      { a: parts[1].pts[0], b: parts[1].pts[parts[1].pts.length - 1], thk: parts[1].thk },
    );
    expect(inv.ok).toBe(true);
    expect(Math.abs(inv.meta.partsLengthSum - inv.meta.originalLength)).toBeLessThan(1);
  });

  it("20. first-hit target is split only (host endpoints preserved)", () => {
    const plan = rectPlan();
    const topBefore = resolvePlanWalls(plan).find((w) => w.id === "top");
    const a0 = { ...topBefore.pts[0] };
    const b0 = { ...topBefore.pts[topBefore.pts.length - 1] };
    const r = commitDrawnWall(
      plan,
      { x: 3000, y: 50 },
      { x: 3000, y: 3900 },
      { thk: 100, role: "partition", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      uidFactory("h"),
    );
    const after = resolvePlanWalls(r.plan);
    const ends = after.flatMap((w) => [w.pts[0], w.pts[w.pts.length - 1]]);
    expect(ends.some((p) => Math.hypot(p.x - a0.x, p.y - a0.y) < 1)).toBe(true);
    expect(ends.some((p) => Math.hypot(p.x - b0.x, p.y - b0.y) < 1)).toBe(true);
  });
});

describe("face references and dimensions", () => {
  it("21-22. internal/external dims carry face reference kinds", () => {
    const plan = rectPlan();
    const { dimensions } = generateWallDimensions(plan);
    // Phase 2F1: room_edge_clear is the canonical room-face clear span.
    const internal = dimensions.filter((d) => (
      d.kind === "room_edge_clear" || d.kind === "internal_clear"
    ));
    const external = dimensions.filter((d) => d.kind === "external_overall");
    expect(internal.length).toBeGreaterThan(0);
    expect(external.length).toBeGreaterThan(0);
    expect(internal.every((d) => d.referenceKind === FACE_REF_KINDS.JOINED_ROOM_FACE)).toBe(true);
    expect(external.every((d) => d.referenceKind === FACE_REF_KINDS.JOINED_OUTER_FACE)).toBe(true);
  });

  it("25-26. no centerline fallback for internal/external", () => {
    const plan = rectPlan();
    const { dimensions } = generateWallDimensions(plan);
    for (const d of dimensions.filter((x) => x.kind === "internal_clear" || x.kind === "external_overall")) {
      expect(d.referenceKind).not.toBe(FACE_REF_KINDS.CENTERLINE);
      expect(d.referenceKind).toBeTruthy();
    }
  });

  it("23-24. visual wall_length sits on a face; centerline length may differ", () => {
    const plan = rectPlan();
    const { dimensions } = generateWallDimensions(plan);
    const wallLens = dimensions.filter((d) => d.kind === "wall_length");
    // May be suppressed for full cell boundaries — if present, must be off-centerline.
    for (const d of wallLens) {
      const wall = resolvePlanWalls(plan).find((w) => d.id.includes(w.id));
      if (!wall) continue;
      const a = wall.pts[0];
      const b = wall.pts[wall.pts.length - 1];
      const d1 = distToSeg(d.p1, a, b);
      const d2 = distToSeg(d.p2, a, b);
      expect(d1).toBeGreaterThan(10);
      expect(d2).toBeGreaterThan(10);
      expect(d.referenceKind).not.toBe(FACE_REF_KINDS.CENTERLINE);
    }
    const refs = buildWallFaceReferences(resolvePlanWalls(plan)[0], plan.room);
    const clLen = Math.hypot(refs.centerline.end.x - refs.centerline.start.x, refs.centerline.end.y - refs.centerline.start.y);
    const faceLen = Math.hypot(refs.faceA.end.x - refs.faceA.start.x, refs.faceA.end.y - refs.faceA.start.y);
    expect(Math.abs(clLen - faceLen)).toBeLessThan(1e-6); // parallel equal length
  });

  it("27-28. partition room sides use roomId + point-in-polygon", () => {
    let plan = rectPlan();
    plan = commitDrawnWall(
      plan,
      { x: 3000, y: 0 },
      { x: 3000, y: 4000 },
      { thk: 100, role: "partition", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      uidFactory("p"),
    ).plan;
    const synced = syncRooms(plan);
    plan = { ...plan, rooms: synced.rooms, zones: synced.zones };
    expect(synced.rooms.length).toBe(2);
    const partition = resolvePlanWalls(plan).find((w) => w.role === "partition" || (!["top", "bot", "left", "right"].includes(w.id) && w.pts));
    // Find vertical partition near x=3000
    const part = resolvePlanWalls(plan).find((w) => {
      const a = w.pts[0];
      const b = w.pts[w.pts.length - 1];
      return Math.abs(a.x - b.x) < 2 && Math.abs(a.x - 3000) < 5;
    });
    expect(part).toBeTruthy();
    const roomA = synced.rooms[0];
    const roomB = synced.rooms[1];
    const refA = resolveRoomFacingReference(part, roomA.polygon, roomA.id, plan.room);
    const refB = resolveRoomFacingReference(part, roomB.polygon, roomB.id, plan.room);
    expect(refA.ok).toBe(true);
    expect(refB.ok).toBe(true);
    expect(refA.reference.roomId).toBe(roomA.id);
    expect(refB.reference.roomId).toBe(roomB.id);
    const midA = {
      x: (refA.reference.joinedStart.x + refA.reference.joinedEnd.x) / 2,
      y: (refA.reference.joinedStart.y + refA.reference.joinedEnd.y) / 2,
    };
    const midB = {
      x: (refB.reference.joinedStart.x + refB.reference.joinedEnd.x) / 2,
      y: (refB.reference.joinedStart.y + refB.reference.joinedEnd.y) / 2,
    };
    // Faces should be on opposite sides of the partition centerline.
    expect(Math.sign(midA.x - 3000)).not.toBe(Math.sign(midB.x - 3000));
  });

  it("29-30. face refs work for reversed a/b and are not centerline", () => {
    const wall = {
      id: "w",
      thk: 100,
      thicknessSide: "center",
      pts: [{ x: 0, y: 0 }, { x: 1000, y: 0 }],
    };
    const rev = {
      ...wall,
      pts: [{ x: 1000, y: 0 }, { x: 0, y: 0 }],
    };
    const a = buildWallFaceReferences(wall, { w: 1000, h: 1000 });
    const b = buildWallFaceReferences(rev, { w: 1000, h: 1000 });
    expect(anchorsOnCenterline(a.faceA.start, a.faceA.end, a.centerline, 5)).toBe(false);
    expect(Math.abs(
      Math.hypot(a.faceA.end.x - a.faceA.start.x, a.faceA.end.y - a.faceA.start.y)
      - Math.hypot(b.faceA.end.x - b.faceA.start.x, b.faceA.end.y - b.faceA.start.y),
    )).toBeLessThan(1e-6);
  });
});

describe("unique room labels", () => {
  function fourRoomPlan() {
    let plan = rectPlan();
    plan = commitDrawnWall(
      plan,
      { x: 3000, y: 0 },
      { x: 3000, y: 4000 },
      { thk: 100, role: "partition", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      uidFactory("v"),
    ).plan;
    plan = commitDrawnWall(
      plan,
      { x: 0, y: 2000 },
      { x: 3000, y: 2000 },
      { thk: 100, role: "partition", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      uidFactory("hl"),
    ).plan;
    plan = commitDrawnWall(
      plan,
      { x: 3000, y: 2000 },
      { x: 6000, y: 2000 },
      { thk: 100, role: "partition", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      uidFactory("hr"),
    ).plan;
    return plan;
  }

  it("31-32. four rooms → four unique IDs and names", () => {
    const plan = fourRoomPlan();
    const { rooms } = syncRooms(plan);
    expect(rooms.length).toBe(4);
    const ids = rooms.map((r) => r.id);
    const names = rooms.map((r) => r.name);
    expect(new Set(ids).size).toBe(4);
    expect(new Set(names).size).toBe(4);
  });

  it("33. reload/sync preserves labels when geometry unchanged", () => {
    const plan = fourRoomPlan();
    const first = syncRooms(plan);
    const second = syncRooms({ ...plan, rooms: first.rooms, zones: first.zones });
    expect(second.rooms.map((r) => r.id).sort()).toEqual(first.rooms.map((r) => r.id).sort());
    expect(second.rooms.map((r) => r.name).sort()).toEqual(first.rooms.map((r) => r.name).sort());
  });

  it("34. wall array shuffle is deterministic for labels", () => {
    const plan = fourRoomPlan();
    const a = syncRooms(plan);
    const shuffled = {
      ...plan,
      walls: [...plan.walls].reverse(),
    };
    const b = syncRooms({ ...shuffled, rooms: a.rooms, zones: a.zones });
    expect(new Set(b.rooms.map((r) => r.name)).size).toBe(b.rooms.length);
  });

  it("35. removing partition keeps unique surviving identities", () => {
    const plan = fourRoomPlan();
    const first = syncRooms(plan);
    const walls = plan.walls.filter((w) => {
      const resolved = resolvePlanWalls(plan).find((x) => x.id === w.id);
      if (!resolved) return true;
      const a = resolved.pts[0];
      const b = resolved.pts[resolved.pts.length - 1];
      const isHRight = Math.abs(a.y - 2000) < 2 && Math.abs(b.y - 2000) < 2
        && Math.min(a.x, b.x) >= 2990;
      return !isHRight;
    });
    const next = syncRooms({ ...plan, walls, rooms: first.rooms, zones: first.zones });
    expect(new Set(next.rooms.map((r) => r.name)).size).toBe(next.rooms.length);
    expect(new Set(next.rooms.map((r) => r.id)).size).toBe(next.rooms.length);
  });

  it("ensureUniqueRoomLabels fixes duplicates", () => {
    const fixed = ensureUniqueRoomLabels([
      { id: "a", name: "Помещение 6" },
      { id: "b", name: "Помещение 6" },
      { id: "c", name: "Помещение 6" },
    ]);
    expect(new Set(fixed.map((r) => r.name)).size).toBe(3);
  });
});
