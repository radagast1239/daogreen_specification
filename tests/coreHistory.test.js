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
});
