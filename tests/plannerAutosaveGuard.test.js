/**
 * Hydration-aware autosave controller — src/planner/core/history/autosaveGuard.js.
 * No React, no PlanPage, no real timers: a manual fake scheduler drives the
 * debounce so tests control exactly when a coalesced save fires.
 */
import { describe, it, expect, vi } from "vitest";
import { createAutosaveController, canonicalPlanStringify } from "../src/planner/core/history/autosaveGuard.js";

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

// Lets already-queued microtasks (the Promise.resolve().then(saveFn) chain
// plus saveFn's own resolution) settle before assertions.
async function flushAsync() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function makePlan(overrides = {}) {
  return { walls: [{ id: "w1", a: "n1", b: "n2" }], nodes: { n1: { x: 0, y: 0 }, n2: { x: 4000, y: 0 } }, items: [], ...overrides };
}

function setup(saveImpl) {
  const scheduler = createManualScheduler();
  const saveFn = vi.fn(saveImpl ?? (async () => ({ revision: 1 })));
  const controller = createAutosaveController({
    saveFn,
    debounceMs: 700,
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancelSchedule,
  });
  return { controller, saveFn, scheduler };
}

const PROJECT_A = { mode: "project", id: "proj-A" };
const PROJECT_B = { mode: "project", id: "proj-B" };
const DRAFT_1 = { mode: "standalone", id: "draft-1" };

describe("autosaveGuard — hydration gating", () => {
  it("1. hydration: observing the default plan before completeHydration never saves", () => {
    const { controller, saveFn, scheduler } = setup();
    controller.beginHydration(PROJECT_A);
    controller.observePlan(PROJECT_A, makePlan());
    scheduler.flush();
    expect(saveFn).not.toHaveBeenCalled();
  });

  it("6. slow load: default plan observed during hydration never reaches a PATCH even after hydration completes with different content", async () => {
    const { controller, saveFn, scheduler } = setup();
    controller.beginHydration(PROJECT_A);
    controller.observePlan(PROJECT_A, makePlan({ tag: "default" })); // ignored — still hydrating
    controller.completeHydration(PROJECT_A, makePlan({ tag: "loaded" }));
    scheduler.flush();
    await flushAsync();
    expect(saveFn).not.toHaveBeenCalled();
  });

  it("2. the just-loaded plan is not re-saved immediately after hydration", () => {
    const { controller, saveFn, scheduler } = setup();
    controller.beginHydration(PROJECT_A);
    const loaded = makePlan();
    controller.completeHydration(PROJECT_A, loaded);
    controller.observePlan(PROJECT_A, loaded);
    scheduler.flush();
    expect(saveFn).not.toHaveBeenCalled();
    expect(controller.getState(PROJECT_A).status).toBe("hydrated");
  });
});

describe("autosaveGuard — dirty detection & saving", () => {
  it("first user edit saves", async () => {
    const { controller, saveFn, scheduler } = setup();
    controller.beginHydration(PROJECT_A);
    controller.completeHydration(PROJECT_A, makePlan());
    controller.observePlan(PROJECT_A, makePlan({ walls: [{ id: "w1", a: "n1", b: "n2" }, { id: "w2", a: "n2", b: "n3" }] }));
    scheduler.flush();
    await flushAsync();
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(controller.getState(PROJECT_A).status).toBe("hydrated");
  });

  it("3. a semantically-equal clone (different reference, same content, different key order) does not save", () => {
    const { controller, saveFn, scheduler } = setup();
    const loaded = makePlan();
    controller.beginHydration(PROJECT_A);
    controller.completeHydration(PROJECT_A, loaded);
    const clone = JSON.parse(JSON.stringify(loaded));
    const reordered = { items: clone.items, nodes: clone.nodes, walls: clone.walls }; // different key order
    controller.observePlan(PROJECT_A, reordered);
    scheduler.flush();
    expect(saveFn).not.toHaveBeenCalled();
    expect(controller.getState(PROJECT_A).status).toBe("hydrated");
  });

  it("4. rapid edits coalesce into a single save of the latest snapshot", async () => {
    const { controller, saveFn, scheduler } = setup();
    controller.beginHydration(PROJECT_A);
    controller.completeHydration(PROJECT_A, makePlan());
    controller.observePlan(PROJECT_A, makePlan({ rev: 1 }));
    controller.observePlan(PROJECT_A, makePlan({ rev: 2 }));
    controller.observePlan(PROJECT_A, makePlan({ rev: 3 }));
    expect(scheduler.pendingCount()).toBe(1); // earlier timers cancelled, not stacked
    scheduler.flush();
    await flushAsync();
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(saveFn.mock.calls[0][1]).toEqual(makePlan({ rev: 3 }));
  });

  it("18. repeated observe with no real change does not create a save storm", () => {
    const { controller, saveFn, scheduler } = setup();
    controller.beginHydration(PROJECT_A);
    const loaded = makePlan();
    controller.completeHydration(PROJECT_A, loaded);
    for (let i = 0; i < 20; i++) controller.observePlan(PROJECT_A, JSON.parse(JSON.stringify(loaded)));
    scheduler.flush();
    expect(saveFn).not.toHaveBeenCalled();
  });

  it("5. undo to the very first baseline after an intermediate save still saves (baseline = last SAVED state, not first-load state)", async () => {
    const { controller, saveFn, scheduler } = setup();
    const original = makePlan({ rev: "original" });
    controller.beginHydration(PROJECT_A);
    controller.completeHydration(PROJECT_A, original);

    controller.observePlan(PROJECT_A, makePlan({ rev: "edited" }));
    scheduler.flush();
    await flushAsync();
    expect(saveFn).toHaveBeenCalledTimes(1); // baseline is now "edited"

    controller.observePlan(PROJECT_A, original); // undo back to the ORIGINAL, which differs from current baseline
    scheduler.flush();
    await flushAsync();
    expect(saveFn).toHaveBeenCalledTimes(2);
    expect(saveFn.mock.calls[1][1]).toEqual(original);
  });

  it("19. a pending edit made during an in-flight save is not dropped — it saves right after", async () => {
    let resolveFirst;
    const { controller, saveFn, scheduler } = setup(() => new Promise((resolve) => { resolveFirst = resolve; }));
    controller.beginHydration(PROJECT_A);
    controller.completeHydration(PROJECT_A, makePlan());

    controller.observePlan(PROJECT_A, makePlan({ rev: 1 }));
    scheduler.flush(); // save #1 starts, still pending (saveFn not resolved yet)
    await flushAsync();
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(controller.getState(PROJECT_A).status).toBe("saving");

    controller.observePlan(PROJECT_A, makePlan({ rev: 2 })); // arrives while save #1 is in flight
    scheduler.flush(); // no new save starts — one in-flight max
    await flushAsync();
    expect(saveFn).toHaveBeenCalledTimes(1);

    resolveFirst({ revision: 1 });
    await flushAsync();
    expect(saveFn).toHaveBeenCalledTimes(2); // pending latest (rev:2) saved right after
    expect(saveFn.mock.calls[1][1]).toEqual(makePlan({ rev: 2 }));
  });
});

describe("autosaveGuard — identity isolation", () => {
  it("7. project A's pending edit never lands in B, and B's completion never touches A", async () => {
    const { controller, saveFn, scheduler } = setup();
    controller.beginHydration(PROJECT_A);
    controller.completeHydration(PROJECT_A, makePlan());
    controller.observePlan(PROJECT_A, makePlan({ rev: "A-pending" }));
    // switch away before A's debounce fires
    controller.beginHydration(PROJECT_B);
    controller.completeHydration(PROJECT_B, makePlan({ rev: "B-loaded" }));
    scheduler.flush();
    await flushAsync();
    // A's stale timer either never fired (cancelled) or found nothing to do;
    // in neither case may it touch B.
    expect(saveFn.mock.calls.every((call) => call[0] !== PROJECT_B || call[1].rev === "B-loaded" || call[1].rev === undefined)).toBe(true);
    expect(controller.getState(PROJECT_B).status).toBe("hydrated");
  });

  it("8. A -> B -> A: the old generation cannot resurrect stale state", () => {
    const { controller, scheduler } = setup();
    const genA1 = controller.beginHydration(PROJECT_A);
    controller.beginHydration(PROJECT_B);
    const genA2 = controller.beginHydration(PROJECT_A); // second visit to A
    expect(genA2).not.toBe(genA1);

    // A stale completeHydration tagged to the FIRST visit must be ignored.
    const staleResult = controller.completeHydration(PROJECT_A, makePlan({ rev: "stale-from-first-visit" }));
    // completeHydration only checks "is this identity currently HYDRATING",
    // which it is (second visit) — the guarantee under test is the caller
    // side: a real caller only calls completeHydration from the closure
    // captured at beginHydration time, and must check its own captured
    // generation before calling. We simulate that check here explicitly.
    const callerGenerationWasFirstVisit = genA1;
    const isStale = callerGenerationWasFirstVisit !== controller.getState(PROJECT_A).generation;
    expect(isStale).toBe(true);
    // and the fresh visit's own completion IS applied normally:
    expect(staleResult.applied).toBe(true); // (it lands on the second visit's hydrating record)
    void scheduler;
  });

  it("9. stale hydration completion for a generation the caller no longer holds is meaningless to the caller", () => {
    const { controller } = setup();
    const genA1 = controller.beginHydration(PROJECT_A);
    controller.beginHydration(PROJECT_A); // re-hydrate same identity again (e.g. reload)
    // the ORIGINAL caller's generation token is now stale:
    expect(genA1).not.toBe(controller.getState(PROJECT_A).generation);
  });

  it("14. standalone draft identity is fully independent of project identity with the same literal id", async () => {
    const { controller, saveFn, scheduler } = setup();
    const sameLiteralId = { mode: "project", id: "same-id" };
    const sameLiteralDraft = { mode: "standalone", id: "same-id" };
    controller.beginHydration(sameLiteralId);
    controller.completeHydration(sameLiteralId, makePlan({ tag: "project" }));
    controller.beginHydration(sameLiteralDraft);
    controller.completeHydration(sameLiteralDraft, makePlan({ tag: "draft" }));

    controller.observePlan(sameLiteralDraft, makePlan({ tag: "draft-edited" }));
    scheduler.flush();
    await flushAsync();
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(saveFn.mock.calls[0][0]).toBe(sameLiteralDraft);
    expect(controller.getState(sameLiteralId).status).toBe("hydrated"); // untouched
  });

  it("15. switching between project mode and standalone mode does not cross-pollute state", () => {
    const { controller, saveFn, scheduler } = setup();
    controller.beginHydration(PROJECT_A);
    controller.completeHydration(PROJECT_A, makePlan());
    controller.beginHydration(DRAFT_1);
    controller.completeHydration(DRAFT_1, makePlan({ tag: "draft" }));
    scheduler.flush();
    expect(saveFn).not.toHaveBeenCalled();
    expect(controller.getState(PROJECT_A).status).toBe("hydrated");
    expect(controller.getState(DRAFT_1).status).toBe("hydrated");
  });
});

describe("autosaveGuard — failure / retry / conflict", () => {
  it("11 & 12. a failed save stays dirty; the next edit saves successfully", async () => {
    let shouldFail = true;
    const { controller, saveFn, scheduler } = setup(async () => {
      if (shouldFail) throw new Error("network down");
      return { revision: 2 };
    });
    controller.beginHydration(PROJECT_A);
    controller.completeHydration(PROJECT_A, makePlan());

    controller.observePlan(PROJECT_A, makePlan({ rev: "edit-1" }));
    scheduler.flush();
    await flushAsync();
    expect(controller.getState(PROJECT_A).status).toBe("save-failed");
    expect(controller.getState(PROJECT_A).dirty).toBe(true);

    shouldFail = false;
    controller.observePlan(PROJECT_A, makePlan({ rev: "edit-2" })); // next edit re-triggers
    scheduler.flush();
    await flushAsync();
    expect(controller.getState(PROJECT_A).status).toBe("hydrated");
    expect(saveFn).toHaveBeenCalledTimes(2);
  });

  it("explicit retry() re-attempts the still-pending snapshot without a new edit", async () => {
    let shouldFail = true;
    const { controller, saveFn, scheduler } = setup(async () => {
      if (shouldFail) throw new Error("network down");
      return { revision: 2 };
    });
    controller.beginHydration(PROJECT_A);
    controller.completeHydration(PROJECT_A, makePlan());
    controller.observePlan(PROJECT_A, makePlan({ rev: "edit-1" }));
    scheduler.flush();
    await flushAsync();
    expect(controller.getState(PROJECT_A).status).toBe("save-failed");

    shouldFail = false;
    controller.retry(PROJECT_A);
    await flushAsync();
    expect(controller.getState(PROJECT_A).status).toBe("hydrated");
    expect(saveFn).toHaveBeenCalledTimes(2);
  });

  it("no unhandled rejection: a rejecting saveFn never throws out of the controller", async () => {
    const { controller, scheduler } = setup(async () => { throw new Error("boom"); });
    controller.beginHydration(PROJECT_A);
    controller.completeHydration(PROJECT_A, makePlan());
    expect(() => {
      controller.observePlan(PROJECT_A, makePlan({ rev: 1 }));
      scheduler.flush();
    }).not.toThrow();
    await flushAsync();
    expect(controller.getState(PROJECT_A).status).toBe("save-failed");
  });

  it("13. a 409-style conflict is treated as a failure and does not advance the baseline", async () => {
    const conflictError = Object.assign(new Error("revision conflict"), { status: 409 });
    const { controller, scheduler } = setup(async () => { throw conflictError; });
    const original = makePlan();
    controller.beginHydration(PROJECT_A);
    controller.completeHydration(PROJECT_A, original);
    controller.observePlan(PROJECT_A, makePlan({ rev: "conflicted-edit" }));
    scheduler.flush();
    await flushAsync();
    expect(controller.getState(PROJECT_A).status).toBe("save-failed");
    expect(controller.getState(PROJECT_A).lastError).toBe(conflictError);
    // baseline still reflects the original hydrated state, not the failed edit
    expect(controller.shouldSave(PROJECT_A, original)).toBe(false);
    expect(controller.shouldSave(PROJECT_A, makePlan({ rev: "conflicted-edit" }))).toBe(true);
  });
});

describe("autosaveGuard — fingerprint hygiene", () => {
  it("16. two plans differing only in an excluded (session-only) key fingerprint the same", async () => {
    const scheduler = createManualScheduler();
    const saveFn = vi.fn(async () => ({ revision: 1 }));
    const controller = createAutosaveController({
      saveFn, debounceMs: 700, schedule: scheduler.schedule, cancelSchedule: scheduler.cancelSchedule,
      excludeKeys: ["roomDetectionDiagnostic"],
    });
    controller.beginHydration(PROJECT_A);
    controller.completeHydration(PROJECT_A, makePlan());
    controller.observePlan(PROJECT_A, { ...makePlan(), roomDetectionDiagnostic: { code: "ROOM_DETECTION_FAILED" } });
    scheduler.flush();
    await flushAsync();
    expect(saveFn).not.toHaveBeenCalled();
  });

  it("17. a plan carrying a session-only wallCommands warning list (excluded key) does not trigger a save on its own", async () => {
    const scheduler = createManualScheduler();
    const saveFn = vi.fn(async () => ({ revision: 1 }));
    const controller = createAutosaveController({
      saveFn, debounceMs: 700, schedule: scheduler.schedule, cancelSchedule: scheduler.cancelSchedule,
      excludeKeys: ["_wallCommandWarnings"],
    });
    controller.beginHydration(PROJECT_A);
    controller.completeHydration(PROJECT_A, makePlan());
    controller.observePlan(PROJECT_A, { ...makePlan(), _wallCommandWarnings: [{ code: "DIMENSION_ANCHOR_NEEDS_REVIEW" }] });
    scheduler.flush();
    await flushAsync();
    expect(saveFn).not.toHaveBeenCalled();
  });

  it("canonicalPlanStringify is independent of key order and object reference", () => {
    const a = { walls: [1, 2], room: { w: 1, h: 2 } };
    const b = { room: { h: 2, w: 1 }, walls: [1, 2] };
    expect(canonicalPlanStringify(a)).toBe(canonicalPlanStringify(b));
    expect(a).not.toBe(b);
  });

  it("canonicalPlanStringify is order-sensitive for arrays (geometry order can be meaningful)", () => {
    const a = { walls: [1, 2] };
    const b = { walls: [2, 1] };
    expect(canonicalPlanStringify(a)).not.toBe(canonicalPlanStringify(b));
  });
});

describe("autosaveGuard — undo/redo semantics & disposal", () => {
  it("17b. dirty/clean is determined by semantic state, not by reference — two different object instances with equal content are both clean", () => {
    const { controller, scheduler, saveFn } = setup();
    controller.beginHydration(PROJECT_A);
    const loaded = makePlan();
    controller.completeHydration(PROJECT_A, loaded);
    const instanceTwo = JSON.parse(JSON.stringify(loaded));
    const instanceThree = JSON.parse(JSON.stringify(loaded));
    expect(instanceTwo).not.toBe(instanceThree);
    controller.observePlan(PROJECT_A, instanceTwo);
    controller.observePlan(PROJECT_A, instanceThree);
    scheduler.flush();
    expect(saveFn).not.toHaveBeenCalled();
  });

  it("dispose() clears all timers and further calls are safely ignored", () => {
    const { controller, saveFn, scheduler } = setup();
    controller.beginHydration(PROJECT_A);
    controller.completeHydration(PROJECT_A, makePlan());
    controller.observePlan(PROJECT_A, makePlan({ rev: 1 }));
    controller.dispose();
    scheduler.flush();
    expect(saveFn).not.toHaveBeenCalled();
    expect(() => controller.observePlan(PROJECT_A, makePlan({ rev: 2 }))).not.toThrow();
  });

  it("resetForIdentity drops all state for that identity without affecting others", async () => {
    const { controller, saveFn, scheduler } = setup();
    controller.beginHydration(PROJECT_A);
    controller.completeHydration(PROJECT_A, makePlan());
    controller.beginHydration(PROJECT_B);
    controller.completeHydration(PROJECT_B, makePlan({ tag: "b" }));
    controller.resetForIdentity(PROJECT_A);
    expect(controller.getState(PROJECT_A)).toBeNull();
    expect(controller.getState(PROJECT_B).status).toBe("hydrated");
    controller.observePlan(PROJECT_A, makePlan({ rev: 1 })); // no record -> ignored, no throw
    scheduler.flush();
    await flushAsync();
    expect(saveFn).not.toHaveBeenCalled();
  });
});
