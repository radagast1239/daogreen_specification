import { describe, expect, it, vi } from "vitest";
import { createItemPatchQueue } from "../src/store/itemPatchQueue.js";
import { api } from "../src/lib/api.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("item PATCH persistence", () => {
  it("sends qty in the PATCH payload", async () => {
    const originalFetch = globalThis.fetch;
    const originalStorage = globalThis.localStorage;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "line-1", qty: 7 }),
    }));
    globalThis.fetch = fetchMock;
    globalThis.localStorage = { getItem: () => "" };

    try {
      await api.patchItem("project-1", "line-1", { qty: 7 });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/projects/project-1/items/line-1"),
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ qty: 7 }) }),
      );
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.localStorage = originalStorage;
    }
  });

  it("serializes same-line writes and ignores an older response", async () => {
    const first = deferred();
    const second = deferred();
    const send = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const settled = vi.fn();
    const optimistic = vi.fn();
    const queue = createItemPatchQueue({ send, onOptimistic: optimistic, onSettled: settled });

    const oldSave = queue("project-1:line-1", { qty: 1 });
    const newSave = queue("project-1:line-1", { qty: 12 });
    await nextTurn();
    expect(send).toHaveBeenCalledTimes(1);
    expect(optimistic.mock.calls.map(([patch]) => patch)).toEqual([{ qty: 1 }, { qty: 12 }]);

    first.resolve({ id: "line-1", qty: 1 });
    await oldSave;
    await nextTurn();
    expect(send).toHaveBeenLastCalledWith({ qty: 12 });
    expect(settled).not.toHaveBeenCalled();

    second.resolve({ id: "line-1", qty: 12 });
    await newSave;
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith({ id: "line-1", qty: 12 }, { qty: 12 }, 2);
  });

  it("restores only the latest confirmed item after a temporary latest PATCH failure", async () => {
    const first = deferred();
    const send = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockRejectedValueOnce(Object.assign(new Error("Too many requests"), { status: 429 }));
    const latestError = vi.fn();
    const queue = createItemPatchQueue({ send, onLatestError: latestError });

    const confirmed = queue("project-1:line-1", { qty: 4 });
    const rejected = queue("project-1:line-1", { qty: 9 });
    first.resolve({ id: "line-1", qty: 4 });
    await confirmed;
    await expect(rejected).rejects.toMatchObject({ status: 429 });

    expect(latestError).toHaveBeenCalledWith(
      expect.objectContaining({ status: 429 }),
      { qty: 9 },
      2,
      { id: "line-1", qty: 4 },
    );
  });
});
