import { describe, expect, it } from "vitest";
import { PlanHistoryStack, MUTATION_ORIGIN } from "../src/planner/core/history/index.js";

describe("core/history", () => {
  it("undo/redo restores plan states", () => {
    const stack = new PlanHistoryStack({ walls: [] });
    stack.setPlan({ walls: [{ id: "a" }] });
    stack.setPlan({ walls: [{ id: "b" }] });
    expect(stack.current.walls[0].id).toBe("b");
    stack.undo();
    expect(stack.current.walls[0].id).toBe("a");
    stack.redo();
    expect(stack.current.walls[0].id).toBe("b");
  });

  it("reset clears history", () => {
    const stack = new PlanHistoryStack({ v: 1 });
    stack.setPlan({ v: 2 });
    stack.reset({ v: 3 });
    expect(stack.canUndo).toBe(false);
    expect(stack.current.v).toBe(3);
  });

  // PHASE 2E.1 (A) — REVERSED, deliberately.
  //
  // Until 2E.1, reset() and commitFrom() armed a `skipNext` boolean so that "the
  // derived-state sync which follows" would not become its own undo step — and
  // this test asserted the consequence: the first plain mutation after a load
  // was NOT checkpointed. But every derived sync in PlanPage runs through
  // replace(), which never consumed the flag, so the arming was always dangling
  // and the mutation it actually swallowed was the user's first real edit
  // ("load a plan, press an arrow once, Ctrl+Z does nothing").
  //
  // skipNext is gone; origin is declared per call. The first user mutation after
  // a load is now a normal, undoable edit, and an explicit commit() still is.
  it("the first plain mutation after reset IS checkpointed, and so is an explicit commit", () => {
    const afterReset = new PlanHistoryStack({ v: 0 });
    afterReset.reset({ v: 1 });
    afterReset.setPlan({ v: 2 });
    expect(afterReset.canUndo).toBe(true);
    afterReset.undo();
    expect(afterReset.current.v).toBe(1);

    const committed = new PlanHistoryStack({ v: 0 });
    committed.reset({ v: 1 });
    committed.commit({ v: 2 });
    expect(committed.canUndo).toBe(true);
    committed.undo();
    expect(committed.current.v).toBe(1);
  });

  it("a derived-sync mutation never becomes an undo step", () => {
    const stack = new PlanHistoryStack({ v: 1, rooms: [] });
    stack.reset({ v: 1, rooms: [] });
    stack.mutate((p) => ({ ...p, rooms: ["r1"] }), { origin: MUTATION_ORIGIN.DERIVED_SYNC });
    expect(stack.canUndo).toBe(false);
    expect(stack.current.rooms).toEqual(["r1"]);
    // ...and it does not steal the checkpoint of the user edit after it
    stack.setPlan((p) => ({ ...p, v: 2 }));
    expect(stack.canUndo).toBe(true);
    stack.undo();
    expect(stack.current.v).toBe(1);
  });

  it("an explicit commit after commitFrom keeps both steps undoable", () => {
    const stack = new PlanHistoryStack({ v: 0 });
    stack.commitFrom({ v: 0 }, { v: 1 });   // wall-draw transaction
    stack.commit({ v: 2 });                 // wall delete + host heal
    expect(stack.current.v).toBe(2);
    stack.undo();
    expect(stack.current.v).toBe(1);
    stack.undo();
    expect(stack.current.v).toBe(0);
  });

  it("identity commitPlan((p)=>p) does not create a phantom undo entry", () => {
    const stack = new PlanHistoryStack({ v: 1 });
    stack.commit((p) => p);
    expect(stack.canUndo).toBe(false);
    stack.setPlan({ v: 2 });
    expect(stack.canUndo).toBe(true);
    // A phantom identity commit AFTER the edit would make the first Ctrl+Z a no-op.
    stack.commit((p) => p);
    expect(stack.current.v).toBe(2);
    stack.undo();
    expect(stack.current.v).toBe(1);
  });
});
