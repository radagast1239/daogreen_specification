import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || "",
  setItem: (key, value) => storage.set(key, String(value)),
};

describe("frontend project revision API", () => {
  beforeEach(() => {
    storage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends loaded expectedRevision and accepts the new revision", async () => {
    const requests = [];
    const responses = [
      { id: "p1", name: "Before", revision: 10 },
      { id: "p1", name: "After", revision: 11 },
      { id: "p1", name: "Again", revision: 12 },
    ];
    vi.stubGlobal("fetch", vi.fn(async (_url, init = {}) => {
      requests.push(init);
      return { ok: true, status: 200, json: async () => responses.shift() };
    }));
    const { api } = await import("../src/lib/api.js");
    await api.getProject("p1");
    await api.updateProject("p1", { name: "After" });
    await api.updateProject("p1", { name: "Again" });
    expect(JSON.parse(requests[1].body)).toMatchObject({ name: "After", expectedRevision: 10 });
    expect(JSON.parse(requests[2].body)).toMatchObject({ name: "Again", expectedRevision: 11 });
  });

  it("surfaces 409 details and never retries automatically", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: {
        code: "PROJECT_REVISION_CONFLICT",
        projectId: "p1",
        expectedRevision: 10,
        currentRevision: 11,
        message: "Проект был изменён в другой вкладке или другим пользователем.",
      } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { api } = await import("../src/lib/api.js");
    await expect(api.updateProject("p1", { name: "Stale", expectedRevision: 10 })).rejects.toMatchObject({
      status: 409,
      code: "PROJECT_REVISION_CONFLICT",
      expectedRevision: 10,
      currentRevision: 11,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("injects client expectedRevision and remembers the returned revision", async () => {
    const requests = [];
    const responses = [
      { project: { id: "p1", name: "Client" }, revision: 4, projectId: "p1" },
      { id: "old", status: "bought", revision: 5, projectId: "p1" },
      { updated: [], skipped: [], revision: 6, projectId: "p1" },
    ];
    vi.stubGlobal("fetch", vi.fn(async (_url, init = {}) => {
      requests.push(init);
      return { ok: true, status: 200, json: async () => responses.shift() };
    }));
    const { api } = await import("../src/lib/api.js");
    await api.getClientProject("tok");
    await api.patchClientItem("tok", "old", { status: "bought" });
    await api.bulkPatchClientItems("tok", { itemIds: ["old"], patch: { status: "ordered" } });
    expect(JSON.parse(requests[1].body)).toMatchObject({ status: "bought", expectedRevision: 4 });
    expect(JSON.parse(requests[2].body)).toMatchObject({ expectedRevision: 5, itemIds: ["old"] });
  });
});
