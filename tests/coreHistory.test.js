import { describe, expect, it } from "vitest";
import { PlanHistoryStack } from "../src/planner/core/history/index.js";

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

  it("replace updates current without adding a checkpoint", () => {
    const stack = new PlanHistoryStack({ v: 1 });
    stack.replace({ v: 2 });
    expect(stack.canUndo).toBe(false);
    expect(stack.current.v).toBe(2);
  });

  it("current getter is always live through setPlan/undo/redo/reset", () => {
    const original = { v: 1 };
    const first = { v: 2 };
    const second = { v: 3 };
    const resetPlan = { v: 4 };
    const stack = new PlanHistoryStack(original);
    const getCurrentPlan = () => stack.current;

    expect(getCurrentPlan()).toBe(original);

    stack.setPlan(first);
    expect(getCurrentPlan()).toBe(first);

    stack.setPlan(second);
    expect(getCurrentPlan()).toBe(second);

    stack.undo();
    expect(getCurrentPlan()).toBe(first);

    stack.redo();
    expect(getCurrentPlan()).toBe(second);

    stack.reset(resetPlan);
    expect(getCurrentPlan()).toBe(resetPlan);
    expect(stack.canUndo).toBe(false);
  });
});
