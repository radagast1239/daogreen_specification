import { afterEach, describe, expect, it, vi } from "vitest";
import { createDebouncedTask } from "../src/lib/debouncedTask.js";

afterEach(() => vi.useRealTimers());

describe("item auxiliary refresh debounce", () => {
  it("coalesces rapid qty saves into one activity/publish refresh", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const task = createDebouncedTask(refresh, 300);

    task.schedule();
    task.schedule();
    task.schedule();
    vi.advanceTimersByTime(299);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
