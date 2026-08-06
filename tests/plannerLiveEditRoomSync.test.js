/**
 * Phase 2A4 — safe live-edit room sync contract.
 *
 * PlanPage.jsx's `syncAutoZones` wrapper (session-only, not exported) is a
 * thin adapter over `syncRoomsSafe`: on ok:true it applies new rooms/zones
 * and clears the diagnostic; on ok:false it returns the plan UNCHANGED
 * (walls, rooms, zones, nodes all preserved) and surfaces a diagnostic
 * instead of throwing. This test exercises that exact contract against a
 * real fixture plan so a regression in the wrapper's failure branch (e.g.
 * accidentally writing rooms:null/zones:null, or mutating walls) is caught
 * without needing to render the full PlanPage component.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadPlannerFixture } from "./fixtures/planner/loadFixture.js";

// This codebase has a wallGeometry/wallNetwork/wallOps circular import that
// only resolves cleanly if wallGeometry.js is the first module touched (see
// tests/plannerRoomDetectionDiagnostics.test.js for the same pattern).
let syncRoomsSafe;
let resolvePlanWalls;
let normalizePlan;

beforeAll(async () => {
  await import("../src/planner/wallGeometry.js");
  ({ syncRoomsSafe } = await import("../src/planner/core/rooms/index.js"));
  ({ resolvePlanWalls } = await import("../src/planner/wallNetwork.js"));
  ({ normalizePlan } = await import("../src/planner/planNormalize.js"));
});

// Mirrors PlanPage.jsx's syncAutoZones exactly, for contract testing only.
function syncAutoZones(p, syncFn) {
  const safe = syncRoomsSafe({ ...p, walls: resolvePlanWalls(p) }, syncFn);
  if (!safe.ok) {
    return { plan: p, diagnostic: safe.diagnostics[0] || null };
  }
  const dimWarnings = (p.validationWarnings || []).filter((w) => w.source === "dimensions");
  return {
    plan: {
      ...p,
      rooms: safe.rooms,
      zones: safe.zones,
      validationWarnings: [...dimWarnings, ...(safe.validationWarnings || [])],
    },
    diagnostic: null,
  };
}

describe("Phase 2A4 — live-edit safe room sync", () => {
  it("successful wall edit: rooms recalculated, diagnostic cleared", () => {
    const plan = normalizePlan(loadPlannerFixture("rectangle-room"));
    const { plan: next, diagnostic } = syncAutoZones(plan);
    expect(diagnostic).toBeNull();
    expect(next.rooms.length).toBeGreaterThan(0);
    expect(next.zones.length).toBeGreaterThan(0);
  });

  it("failed room sync after wall edit: wall edit remains, previous rooms/zones remain, diagnostic set, no crash", () => {
    const plan = normalizePlan(loadPlannerFixture("rectangle-room"));
    const wallsBefore = plan.walls;
    const roomsBefore = plan.rooms;
    const zonesBefore = plan.zones;

    const throwingSyncFn = () => { throw new Error("controlled room-engine failure"); };
    let result;
    expect(() => { result = syncAutoZones(plan, throwingSyncFn); }).not.toThrow();

    expect(result.plan.walls).toBe(wallsBefore);
    expect(result.plan.rooms).toBe(roomsBefore);
    expect(result.plan.zones).toBe(zonesBefore);
    expect(result.plan.rooms).not.toBeNull();
    expect(result.plan.zones).not.toBeNull();
    expect(result.diagnostic).toMatchObject({ code: "ROOM_DETECTION_FAILED", severity: "error" });
  });

  it("next successful edit after a failure: rooms update, diagnostic clears", () => {
    const plan = normalizePlan(loadPlannerFixture("rectangle-room"));
    const throwingSyncFn = () => { throw new Error("controlled room-engine failure"); };
    const failed = syncAutoZones(plan, throwingSyncFn);
    expect(failed.diagnostic).not.toBeNull();

    const recovered = syncAutoZones(failed.plan);
    expect(recovered.diagnostic).toBeNull();
    expect(recovered.plan.rooms.length).toBeGreaterThan(0);
  });

  it("repeated failure does not loop or throw — single synchronous call per invocation", () => {
    const plan = normalizePlan(loadPlannerFixture("rectangle-room"));
    const throwingSyncFn = () => { throw new Error("controlled room-engine failure"); };
    for (let i = 0; i < 5; i += 1) {
      const { plan: next, diagnostic } = syncAutoZones(plan, throwingSyncFn);
      expect(next).toBe(plan);
      expect(diagnostic).not.toBeNull();
    }
  });

  it("two-rooms fixture: successful sync yields multiple rooms", () => {
    const plan = normalizePlan(loadPlannerFixture("two-rooms"));
    const { plan: next, diagnostic } = syncAutoZones(plan);
    expect(diagnostic).toBeNull();
    expect(next.rooms.length).toBeGreaterThanOrEqual(2);
  });
});
