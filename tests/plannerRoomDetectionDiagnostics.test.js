/**
 * Phase 2A2 — normalizePlanResult / syncRoomsSafe normalization contract.
 * No PlanPage render, no UI wiring. Covers load/normalize path only.
 */
import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";

let normalizePlan;
let normalizePlanResult;
let syncRooms;
let ROOM_DETECTION_FAILED;

beforeAll(async () => {
  await import("../src/planner/wallGeometry.js");
  const planNormalizeMod = await import("../src/planner/planNormalize.js");
  normalizePlan = planNormalizeMod.normalizePlan;
  normalizePlanResult = planNormalizeMod.normalizePlanResult;
  const roomsMod = await import("../src/planner/core/rooms/index.js");
  syncRooms = roomsMod.syncRooms;
  ROOM_DETECTION_FAILED = roomsMod.ROOM_DETECTION_FAILED;
});

function closedRectPlan() {
  return {
    room: { w: 4000, h: 3000, wallThk: 100, defaultRoomHeightMm: 3000, height: 3000 },
    nodes: {},
    walls: [
      { id: "w1", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] },
      { id: "w2", thk: 100, pts: [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }] },
      { id: "w3", thk: 100, pts: [{ x: 4000, y: 3000 }, { x: 0, y: 3000 }] },
      { id: "w4", thk: 100, pts: [{ x: 0, y: 3000 }, { x: 0, y: 0 }] },
    ],
    items: [],
    rooms: [],
    zones: [],
    links: [],
  };
}

function noWallsPlan() {
  return { room: { w: 4000, h: 3000 }, nodes: {}, walls: [], items: [], rooms: [], zones: [], links: [] };
}

const throwingSyncFn = () => {
  throw new Error("controlled room-engine failure");
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Phase 2A2 — successful normalize path", () => {
  it("rectangle room: rooms updated, diagnostics empty", () => {
    const { plan, diagnostics } = normalizePlanResult(closedRectPlan());
    expect(diagnostics).toEqual([]);
    expect(plan.rooms.length).toBeGreaterThan(0);
    expect(plan.zones.length).toBeGreaterThan(0);
  });

  it("matches prior syncRooms-based success semantics", () => {
    const raw = closedRectPlan();
    const { plan, diagnostics } = normalizePlanResult(raw);
    const plain = normalizePlan(raw);
    expect(diagnostics).toEqual([]);
    expect(plan.rooms).toEqual(plain.rooms);
    expect(plan.zones).toEqual(plain.zones);
  });

  it("empty network: success with rooms:[], not engine failure", () => {
    const { plan, diagnostics } = normalizePlanResult(noWallsPlan());
    expect(plan.rooms).toEqual([]);
    expect(plan.zones).toEqual([]);
    expect(diagnostics).toEqual([]);
  });
});

describe("Phase 2A2 — engine failure during normalize", () => {
  it("does not throw outward; returns ROOM_DETECTION_FAILED diagnostic", () => {
    const polygon = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }];
    const raw = {
      ...closedRectPlan(),
      rooms: [{ id: "r1", type: "room", name: "Существующее помещение", category: "storage_clean", heightMm: 3100, polygon }],
      zones: [{ id: "r1", auto: true, name: "Существующее помещение", polygon }],
    };
    expect(() => normalizePlanResult(raw, { roomSyncFn: throwingSyncFn })).not.toThrow();
    const { plan, diagnostics } = normalizePlanResult(raw, { roomSyncFn: throwingSyncFn });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: ROOM_DETECTION_FAILED, severity: "error" });
    expect(plan.rooms).toHaveLength(1);
    expect(plan.rooms[0].name).toBe("Существующее помещение");
    expect(plan.rooms[0].heightMm).toBe(3100);
    expect(plan.zones).toHaveLength(1);
    expect(plan.rooms[0]).not.toBeNull();
    expect(plan.zones[0]).not.toBeNull();
  });

  it("without previous rooms: failure does not fabricate misleading rooms:[] success", () => {
    const { plan, diagnostics } = normalizePlanResult(closedRectPlan(), { roomSyncFn: throwingSyncFn });
    expect(diagnostics).toHaveLength(1);
    expect(plan.rooms).toEqual([]);
    expect(plan.rooms).not.toBeNull();
  });

  it("preserves existing validationWarnings on failure", () => {
    const raw = {
      ...closedRectPlan(),
      validationWarnings: [{ source: "dimensions", level: "warning", message: "keep-me" }],
      rooms: [{ id: "r1", type: "room", name: "Room", polygon: [] }],
      zones: [{ id: "r1", auto: true }],
    };
    const { plan, diagnostics } = normalizePlanResult(raw, { roomSyncFn: throwingSyncFn });
    expect(diagnostics).toHaveLength(1);
    expect(plan.validationWarnings.some((w) => w.message === "keep-me")).toBe(true);
    expect(plan.validationWarnings).not.toBeNull();
  });

  it("preserves geometry fields (walls/items) on failure", () => {
    const raw = {
      ...closedRectPlan(),
      items: [{ id: "i1", kind: "rack", x: 100, y: 100, w: 600, h: 400, layer: "racks" }],
      rooms: [{ id: "r1", type: "room", name: "Room", polygon: [] }],
      zones: [{ id: "r1", auto: true }],
    };
    const { plan, diagnostics } = normalizePlanResult(raw, { roomSyncFn: throwingSyncFn });
    expect(diagnostics).toHaveLength(1);
    expect(plan.walls.length).toBeGreaterThan(0);
    expect(plan.items.some((i) => i.id === "i1")).toBe(true);
  });
});

describe("Phase 2A2 — session-only diagnostics", () => {
  it("diagnostics are not written into serialized plan", () => {
    const { plan } = normalizePlanResult(closedRectPlan(), { roomSyncFn: throwingSyncFn });
    const json = JSON.stringify(plan);
    expect(json).not.toContain("ROOM_DETECTION_FAILED");
    expect(plan).not.toHaveProperty("diagnostics");
    expect(plan).not.toHaveProperty("ok");
  });

  it("normalizePlan compatibility wrapper returns only plan object", () => {
    const plan = normalizePlan(closedRectPlan(), { roomSyncFn: throwingSyncFn });
    expect(plan).not.toHaveProperty("diagnostics");
    expect(typeof plan).toBe("object");
    expect(Array.isArray(plan.walls)).toBe(true);
  });
});

describe("Phase 2A2 — re-normalization and recovery", () => {
  it("session diagnostic survives until successful re-normalization clears it", () => {
    let sessionDiagnostic = null;
    const raw = closedRectPlan();

    const load = (syncFn) => {
      const { diagnostics } = normalizePlanResult(raw, syncFn ? { roomSyncFn: syncFn } : {});
      sessionDiagnostic = diagnostics[0] || null;
    };

    load(throwingSyncFn);
    expect(sessionDiagnostic).toMatchObject({ code: ROOM_DETECTION_FAILED });

    load();
    expect(sessionDiagnostic).toBeNull();
  });

  it("distinguishes empty success from internal safe failure result", () => {
    const empty = normalizePlanResult(noWallsPlan());
    const failure = normalizePlanResult(closedRectPlan(), { roomSyncFn: throwingSyncFn });
    expect(empty.diagnostics).toEqual([]);
    expect(empty.plan.rooms).toEqual([]);
    expect(failure.diagnostics).toHaveLength(1);
    expect(failure.plan.rooms).toEqual([]);
    expect(failure.plan.rooms).not.toBeNull();
  });
});

describe("Phase 2A2 — non-Error throws and logging", () => {
  it("string throw still yields structured diagnostic without outward exception", () => {
    const stringThrow = () => { throw "room boom"; };
    expect(() => normalizePlanResult(closedRectPlan(), { roomSyncFn: stringThrow })).not.toThrow();
    const { diagnostics } = normalizePlanResult(closedRectPlan(), { roomSyncFn: stringThrow });
    expect(diagnostics[0].code).toBe(ROOM_DETECTION_FAILED);
  });

  it("null throw still yields structured diagnostic", () => {
    const nullThrow = () => { throw null; };
    const { diagnostics } = normalizePlanResult(closedRectPlan(), { roomSyncFn: nullThrow });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe(ROOM_DETECTION_FAILED);
  });

  it("production NODE_ENV suppresses console.error on room failure", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { syncRoomsSafe } = await import("../src/planner/core/rooms/syncRooms.js");
    syncRoomsSafe(closedRectPlan(), throwingSyncFn);
    expect(spy).not.toHaveBeenCalled();
    process.env.NODE_ENV = prev;
  });
});

describe("Phase 2A2 — backward compatibility with syncRooms success baseline", () => {
  it("successful normalize still detects rooms like direct syncRooms on resolved walls", () => {
    const raw = closedRectPlan();
    const { plan } = normalizePlanResult(raw);
    expect(plan.rooms.length).toBeGreaterThan(0);
    expect(plan.rooms.length).toBeLessThanOrEqual(2);
  });
});
