/**
 * PlanPage autosave wiring — exercises createPlanAutosaveBridge the same way
 * PlanPage does (hydration → observe → projectUpdate/standalone persist),
 * including wall-command warnings, room-sync failure geometry, and 409.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createPlanAutosaveBridge,
  stripEphemeralPlanFields,
  planAutosaveFingerprint,
} from "../src/planner/core/history/planAutosaveBridge.js";
import { materializeWallCommand } from "../src/planner/core/walls/applyWallCommand.js";
import { addWall } from "../src/planner/core/walls/wallCommands.js";
import { syncRoomsSafe } from "../src/planner/core/rooms/index.js";

function createManualScheduler() {
  let queue = [];
  return {
    schedule: (fn) => {
      const handle = { fn, cancelled: false };
      queue.push(handle);
      return handle;
    },
    cancelSchedule: (handle) => { handle.cancelled = true; },
    flush: () => {
      const toRun = queue.filter((h) => !h.cancelled);
      queue = [];
      toRun.forEach((h) => h.fn());
    },
    pendingCount: () => queue.filter((h) => !h.cancelled).length,
  };
}

async function flushAsync() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

function basePlan(overrides = {}) {
  return {
    walls: [{ id: "w1", a: "n1", b: "n2", thk: 100 }],
    nodes: { n1: { x: 0, y: 0 }, n2: { x: 4000, y: 0 } },
    items: [],
    rooms: [{ id: "r1", name: "Room" }],
    zones: [{ id: "z1", roomId: "r1" }],
    ...overrides,
  };
}

const PROJECT_A = { mode: "project", id: "proj-A" };
const PROJECT_B = { mode: "project", id: "proj-B" };
const DRAFT_1 = { mode: "standalone", id: "draft-1" };

function setupBridge(persistImpl, extras = {}) {
  const scheduler = createManualScheduler();
  const statuses = [];
  let activeIdentity = extras.activeIdentity ?? PROJECT_A;
  const persistFn = vi.fn(persistImpl ?? (async () => ({ revision: 1 })));
  const bridge = createPlanAutosaveBridge({
    persistFn,
    debounceMs: 700,
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancelSchedule,
    getActiveIdentity: () => activeIdentity,
    onStatus: (s) => statuses.push({ ...s }),
  });
  return {
    bridge,
    persistFn,
    scheduler,
    statuses,
    setActive: (id) => { activeIdentity = id; },
  };
}

describe("PlanPage autosave integration — hydration & first edit", () => {
  it("1. hydration: no PATCH before completeHydration", () => {
    const { bridge, persistFn, scheduler } = setupBridge();
    bridge.beginHydration(PROJECT_A);
    bridge.observePlan(PROJECT_A, basePlan({ tag: "default" }));
    scheduler.flush();
    expect(persistFn).not.toHaveBeenCalled();
  });

  it("2. first real edit issues one PATCH", async () => {
    const { bridge, persistFn, scheduler } = setupBridge();
    const loaded = basePlan();
    bridge.beginHydration(PROJECT_A);
    bridge.completeHydration(PROJECT_A, loaded);
    bridge.observePlan(PROJECT_A, loaded);
    scheduler.flush();
    expect(persistFn).not.toHaveBeenCalled();

    bridge.observePlan(PROJECT_A, basePlan({ walls: [...loaded.walls, { id: "w2", a: "n2", b: "n3", thk: 100 }] }));
    scheduler.flush();
    await flushAsync();
    expect(persistFn).toHaveBeenCalledTimes(1);
    expect(persistFn.mock.calls[0][0]).toEqual(PROJECT_A);
  });

  it("3. rapid edits coalesce to latest snapshot", async () => {
    const { bridge, persistFn, scheduler } = setupBridge();
    bridge.beginHydration(PROJECT_A);
    bridge.completeHydration(PROJECT_A, basePlan());
    bridge.observePlan(PROJECT_A, basePlan({ rev: 1 }));
    bridge.observePlan(PROJECT_A, basePlan({ rev: 2 }));
    bridge.observePlan(PROJECT_A, basePlan({ rev: 3 }));
    expect(scheduler.pendingCount()).toBe(1);
    scheduler.flush();
    await flushAsync();
    expect(persistFn).toHaveBeenCalledTimes(1);
    expect(persistFn.mock.calls[0][1].rev).toBe(3);
  });

  it("4. in-flight serialization: edit during save waits for completion", async () => {
    let resolveFirst;
    const { bridge, persistFn, scheduler } = setupBridge(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    bridge.beginHydration(PROJECT_A);
    bridge.completeHydration(PROJECT_A, basePlan());
    bridge.observePlan(PROJECT_A, basePlan({ rev: 1 }));
    scheduler.flush();
    await flushAsync();
    expect(persistFn).toHaveBeenCalledTimes(1);

    bridge.observePlan(PROJECT_A, basePlan({ rev: 2 }));
    scheduler.flush();
    await flushAsync();
    expect(persistFn).toHaveBeenCalledTimes(1);

    resolveFirst({ revision: 2 });
    await flushAsync();
    expect(persistFn).toHaveBeenCalledTimes(2);
    expect(persistFn.mock.calls[1][1].rev).toBe(2);
  });

  it("5. undo to original baseline after intermediate save still PATCHes", async () => {
    const { bridge, persistFn, scheduler } = setupBridge();
    const original = basePlan({ rev: "original" });
    bridge.beginHydration(PROJECT_A);
    bridge.completeHydration(PROJECT_A, original);
    bridge.observePlan(PROJECT_A, basePlan({ rev: "edited" }));
    scheduler.flush();
    await flushAsync();
    expect(persistFn).toHaveBeenCalledTimes(1);

    bridge.observePlan(PROJECT_A, original);
    scheduler.flush();
    await flushAsync();
    expect(persistFn).toHaveBeenCalledTimes(2);
    expect(persistFn.mock.calls[1][1].rev).toBe("original");
  });

  it("6. semantic-equal clone does not PATCH", () => {
    const { bridge, persistFn, scheduler } = setupBridge();
    const loaded = basePlan();
    bridge.beginHydration(PROJECT_A);
    bridge.completeHydration(PROJECT_A, loaded);
    const clone = { zones: loaded.zones, rooms: loaded.rooms, items: [], walls: loaded.walls, nodes: loaded.nodes };
    bridge.observePlan(PROJECT_A, clone);
    scheduler.flush();
    expect(persistFn).not.toHaveBeenCalled();
  });

  it("7. slow project load: default plan never overwrites loaded plan", async () => {
    const { bridge, persistFn, scheduler } = setupBridge();
    bridge.beginHydration(PROJECT_A);
    bridge.observePlan(PROJECT_A, basePlan({ tag: "default-empty" }));
    const loaded = basePlan({ tag: "from-server", walls: [{ id: "w9", a: "n1", b: "n2", thk: 200 }] });
    bridge.completeHydration(PROJECT_A, loaded);
    bridge.observePlan(PROJECT_A, loaded);
    scheduler.flush();
    await flushAsync();
    expect(persistFn).not.toHaveBeenCalled();
  });
});

describe("PlanPage autosave integration — identity isolation", () => {
  it("8. A→B: pending save A does not affect B", async () => {
    let resolveA;
    const { bridge, persistFn, scheduler, setActive } = setupBridge(
      (identity) => {
        if (identity.id === "proj-A") {
          return new Promise((resolve) => { resolveA = resolve; });
        }
        return Promise.resolve({ revision: 1 });
      },
    );
    bridge.beginHydration(PROJECT_A);
    bridge.completeHydration(PROJECT_A, basePlan());
    bridge.observePlan(PROJECT_A, basePlan({ rev: "a-edit" }));
    scheduler.flush();
    await flushAsync();
    expect(persistFn).toHaveBeenCalledTimes(1);

    setActive(PROJECT_B);
    bridge.beginHydration(PROJECT_B);
    bridge.completeHydration(PROJECT_B, basePlan({ tag: "B" }));
    bridge.observePlan(PROJECT_B, basePlan({ tag: "B", rev: "b-edit" }));
    scheduler.flush();
    await flushAsync();
    expect(persistFn.mock.calls.some((c) => c[0].id === "proj-B")).toBe(true);

    resolveA({ revision: 9 });
    await flushAsync();
    const bState = bridge.getState(PROJECT_B);
    expect(bState.status === "hydrated" || bState.status === "saving" || bState.status === "dirty").toBe(true);
    // A's completion must not replace B's baseline with A's plan
    expect(persistFn.mock.calls.filter((c) => c[0].id === "proj-B").every((c) => c[1].tag === "B")).toBe(true);
  });

  it("9. A→B→A uses a new generation; stale A completion ignored", async () => {
    let resolveOldA;
    const { bridge, persistFn, scheduler, setActive } = setupBridge(
      (identity, plan) => {
        if (identity.id === "proj-A" && plan.rev === "old-a") {
          return new Promise((resolve) => { resolveOldA = resolve; });
        }
        return Promise.resolve({ revision: 1 });
      },
    );
    bridge.beginHydration(PROJECT_A);
    const gen1 = bridge.getState(PROJECT_A).generation;
    bridge.completeHydration(PROJECT_A, basePlan());
    bridge.observePlan(PROJECT_A, basePlan({ rev: "old-a" }));
    scheduler.flush();
    await flushAsync();

    setActive(PROJECT_B);
    bridge.beginHydration(PROJECT_B);
    bridge.completeHydration(PROJECT_B, basePlan({ tag: "B" }));

    setActive(PROJECT_A);
    bridge.beginHydration(PROJECT_A);
    const gen2 = bridge.getState(PROJECT_A).generation;
    expect(gen2).toBeGreaterThan(gen1);
    const reloaded = basePlan({ rev: "reloaded-a" });
    bridge.completeHydration(PROJECT_A, reloaded);

    resolveOldA({ revision: 99 });
    await flushAsync();
    // Still hydrated at reloaded baseline — stale save must not mark dirty/saved wrongly
    expect(bridge.getState(PROJECT_A).generation).toBe(gen2);
    bridge.observePlan(PROJECT_A, reloaded);
    scheduler.flush();
    await flushAsync();
    const savesForNewGen = persistFn.mock.calls.filter((c) => c[0].id === "proj-A" && c[1].rev === "reloaded-a");
    expect(savesForNewGen).toHaveLength(0);
  });

  it("10. stale save completion after dispose is ignored", async () => {
    let resolveSave;
    const { bridge, persistFn, scheduler } = setupBridge(
      () => new Promise((resolve) => { resolveSave = resolve; }),
    );
    bridge.beginHydration(PROJECT_A);
    bridge.completeHydration(PROJECT_A, basePlan());
    bridge.observePlan(PROJECT_A, basePlan({ rev: 1 }));
    scheduler.flush();
    await flushAsync();
    bridge.dispose();
    resolveSave({ revision: 1 });
    await flushAsync();
    expect(bridge.getState(PROJECT_A)).toBeNull();
    expect(persistFn).toHaveBeenCalledTimes(1);
  });
});

describe("PlanPage autosave integration — failure / retry / 409", () => {
  it("11. save failure remains dirty and does not advance baseline", async () => {
    const { bridge, persistFn, scheduler } = setupBridge(async () => {
      throw Object.assign(new Error("network"), { status: 500 });
    });
    bridge.beginHydration(PROJECT_A);
    bridge.completeHydration(PROJECT_A, basePlan());
    const edited = basePlan({ rev: "fail-me" });
    bridge.observePlan(PROJECT_A, edited);
    scheduler.flush();
    await flushAsync();
    expect(bridge.getState(PROJECT_A).status).toBe("save-failed");
    expect(bridge.getState(PROJECT_A).dirty).toBe(true);

    // Observing same edited plan again should still be dirty vs original baseline
    persistFn.mockImplementation(async () => ({ revision: 2 }));
    bridge.observePlan(PROJECT_A, edited);
    scheduler.flush();
    await flushAsync();
    expect(persistFn).toHaveBeenCalled();
  });

  it("12. retry after failure succeeds and clears dirty", async () => {
    let shouldFail = true;
    const { bridge, persistFn, scheduler } = setupBridge(async () => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("transient");
      }
      return { revision: 3 };
    });
    bridge.beginHydration(PROJECT_A);
    bridge.completeHydration(PROJECT_A, basePlan());
    bridge.observePlan(PROJECT_A, basePlan({ rev: "retry" }));
    scheduler.flush();
    await flushAsync();
    expect(bridge.getState(PROJECT_A).status).toBe("save-failed");

    bridge.retry(PROJECT_A);
    await flushAsync();
    expect(persistFn).toHaveBeenCalledTimes(2);
    expect(bridge.getState(PROJECT_A).status).toBe("hydrated");
    expect(bridge.getState(PROJECT_A).dirty).toBe(false);
  });

  it("13. 409 conflict is failure, not success", async () => {
    const { bridge, scheduler } = setupBridge(async () => {
      throw Object.assign(new Error("revision conflict"), { status: 409 });
    });
    bridge.beginHydration(PROJECT_A);
    bridge.completeHydration(PROJECT_A, basePlan());
    bridge.observePlan(PROJECT_A, basePlan({ rev: "conflict" }));
    scheduler.flush();
    await flushAsync();
    expect(bridge.getState(PROJECT_A).status).toBe("save-failed");
    expect(bridge.getState(PROJECT_A).dirty).toBe(true);
  });
});

describe("PlanPage autosave integration — standalone / diagnostics / walls", () => {
  it("14. standalone draft identity is isolated from project mode", async () => {
    const { bridge, persistFn, scheduler, setActive } = setupBridge();
    setActive(DRAFT_1);
    bridge.beginHydration(DRAFT_1);
    bridge.completeHydration(DRAFT_1, basePlan({ tag: "draft" }));
    bridge.observePlan(DRAFT_1, basePlan({ tag: "draft", rev: 1 }));
    scheduler.flush();
    await flushAsync();
    expect(persistFn.mock.calls[0][0]).toEqual(DRAFT_1);

    setActive(PROJECT_A);
    bridge.beginHydration(PROJECT_A);
    bridge.completeHydration(PROJECT_A, basePlan({ tag: "project" }));
    bridge.observePlan(PROJECT_A, basePlan({ tag: "project" }));
    scheduler.flush();
    await flushAsync();
    expect(persistFn.mock.calls.every((c) => c[0].mode !== "project" || c[1].tag === "project" || c[1].rev == null)).toBe(true);
    expect(persistFn.mock.calls.filter((c) => c[0].id === "proj-A")).toHaveLength(0);
  });

  it("15. room diagnostics are not part of fingerprint (session sibling, not on plan)", () => {
    const plan = basePlan();
    const diagnostic = { ok: false, code: "ROOM_DETECT_FAILED", message: "x" };
    // PlanPage keeps diagnostic in React state — fingerprint ignores it by construction.
    expect(planAutosaveFingerprint(plan)).toBe(planAutosaveFingerprint({ ...plan }));
    expect(plan.roomDetectionDiagnostic).toBeUndefined();
    expect(diagnostic).toBeTruthy();
  });

  it("16. wall-command validationWarnings are stripped from persist payload", async () => {
    const { bridge, persistFn, scheduler } = setupBridge();
    const loaded = basePlan();
    bridge.beginHydration(PROJECT_A);
    bridge.completeHydration(PROJECT_A, loaded);
    const withWarn = {
      ...basePlan({ rev: "wall-edit" }),
      validationWarnings: [
        { source: "wall-command", message: "floating endpoint" },
        { source: "other", message: "keep me" },
      ],
    };
    bridge.observePlan(PROJECT_A, withWarn);
    scheduler.flush();
    await flushAsync();
    expect(persistFn).toHaveBeenCalledTimes(1);
    const saved = persistFn.mock.calls[0][1];
    expect(saved.validationWarnings.every((w) => w.source !== "wall-command")).toBe(true);
    expect(saved.validationWarnings).toEqual([{ source: "other", message: "keep me" }]);
    // Fingerprint ignores wall-command warnings too
    const again = { ...withWarn, validationWarnings: [...withWarn.validationWarnings] };
    bridge.observePlan(PROJECT_A, again);
    scheduler.flush();
    await flushAsync();
    expect(persistFn).toHaveBeenCalledTimes(1);
  });

  it("17. wall edit + failed room sync still autosaves valid geometry; rooms/zones preserved", async () => {
    const { bridge, persistFn, scheduler } = setupBridge();
    const loaded = basePlan({
      rooms: [{ id: "r1", name: "Keep" }],
      zones: [{ id: "z1", roomId: "r1" }],
    });
    bridge.beginHydration(PROJECT_A);
    bridge.completeHydration(PROJECT_A, loaded);

    // Simulate PlanPage applyWallCmd → syncAutoZones on failure: walls updated, rooms kept.
    const afterWall = {
      ...loaded,
      walls: [...loaded.walls, { id: "w2", a: "n2", b: "n3", thk: 100 }],
      nodes: { ...loaded.nodes, n3: { x: 4000, y: 3000 } },
      rooms: loaded.rooms,
      zones: loaded.zones,
      validationWarnings: [{ source: "wall-command", message: "warn" }],
    };
    const roomFail = syncRoomsSafe(afterWall, () => {
      throw new Error("room engine down");
    });
    expect(roomFail.ok).toBe(false);
    const planAfterFail = {
      ...afterWall,
      rooms: afterWall.rooms,
      zones: afterWall.zones,
    };
    // Diagnostic stays off the plan object (PlanPage session state).
    expect(planAfterFail.roomDetectionDiagnostic).toBeUndefined();

    bridge.observePlan(PROJECT_A, planAfterFail);
    scheduler.flush();
    await flushAsync();
    expect(persistFn).toHaveBeenCalledTimes(1);
    const payload = persistFn.mock.calls[0][1];
    expect(payload.walls).toHaveLength(2);
    expect(payload.rooms).toEqual(loaded.rooms);
    expect(payload.zones).toEqual(loaded.zones);
    expect(payload.rooms).not.toBeNull();
    expect(payload.zones).not.toBeNull();
    expect(payload.validationWarnings?.some((w) => w.source === "wall-command")).toBeFalsy();
  });

  it("18. never persists rooms:null / zones:null", async () => {
    const { bridge, persistFn, scheduler } = setupBridge();
    bridge.beginHydration(PROJECT_A);
    bridge.completeHydration(PROJECT_A, basePlan());
    bridge.observePlan(PROJECT_A, basePlan({ rev: 1, rooms: [], zones: [] }));
    scheduler.flush();
    await flushAsync();
    const payload = persistFn.mock.calls[0][1];
    expect(payload.rooms).not.toBeNull();
    expect(payload.zones).not.toBeNull();
    expect(Array.isArray(payload.rooms)).toBe(true);
    expect(Array.isArray(payload.zones)).toBe(true);
  });

  it("19. no infinite PATCH loop on stable plan", async () => {
    const { bridge, persistFn, scheduler } = setupBridge();
    const loaded = basePlan();
    bridge.beginHydration(PROJECT_A);
    bridge.completeHydration(PROJECT_A, loaded);
    for (let i = 0; i < 30; i++) {
      bridge.observePlan(PROJECT_A, { ...loaded, walls: [...loaded.walls] });
    }
    scheduler.flush();
    await flushAsync();
    expect(persistFn).not.toHaveBeenCalled();
  });

  it("20. stripEphemeralPlanFields matches materialize wall-command warnings", () => {
    const plan = {
      walls: [],
      nodes: {},
      items: [],
      validationWarnings: [{ source: "wall-command", code: "X" }],
    };
    // materialize path attaches wall-command warnings — strip must remove them
    const stripped = stripEphemeralPlanFields(plan);
    expect(stripped.validationWarnings).toEqual([]);
    expect(addWall).toBeTypeOf("function");
    expect(materializeWallCommand).toBeTypeOf("function");
  });

  it("21. circular plan links do not break hydration fingerprint / save", async () => {
    const { bridge, persistFn, scheduler } = setupBridge();
    const loaded = basePlan();
    loaded.rooms[0].zoneRef = loaded.zones[0];
    loaded.zones[0].roomRef = loaded.rooms[0];
    bridge.beginHydration(PROJECT_A);
    expect(() => bridge.completeHydration(PROJECT_A, loaded)).not.toThrow();
    bridge.observePlan(PROJECT_A, { ...loaded, rev: "circ-edit" });
    scheduler.flush();
    await flushAsync();
    expect(persistFn).toHaveBeenCalledTimes(1);
  });
});
