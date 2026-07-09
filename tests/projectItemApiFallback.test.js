import { describe, expect, it, vi } from "vitest";
import {
  bulkPatchItemsWithFallback,
  refreshItemsFromMaterialWithFallback,
} from "../src/lib/projectItemApiFallback.js";
import { lineVisibleToClient } from "../shared/itemTypes.js";

describe("projectItemApiFallback", () => {
  it("bulkPatch falls back to sequential patchItem on 404", async () => {
    const calls = [];
    const request = vi.fn(async (path, opts) => {
      calls.push({ path, opts });
      if (path.endsWith("/bulk-patch")) {
        const err = new Error("HTTP 404");
        err.status = 404;
        throw err;
      }
      return { id: "it1", ...opts.body };
    });

    const res = await bulkPatchItemsWithFallback(request, "p1", {
      itemIds: ["it:colon", "it2"],
      patch: { visibleToClient: true },
    });

    expect(res.fallback).toBe(true);
    expect(res.updated).toHaveLength(2);
    expect(calls.some((c) => c.path.includes(encodeURIComponent("it:colon")))).toBe(true);
  });

  it("hide selected payload syncs visibleToClient/visible/approved to false", async () => {
    const bodies = [];
    const request = vi.fn(async (path, opts) => {
      if (path.endsWith("/bulk-patch")) {
        const err = new Error("HTTP 404");
        err.status = 404;
        throw err;
      }
      bodies.push(opts.body);
      return { id: "it1", visible: true, approved: true, ...opts.body };
    });

    const res = await bulkPatchItemsWithFallback(request, "p1", {
      itemIds: ["it1"],
      patch: { visibleToClient: false },
    });

    expect(bodies[0]).toMatchObject({
      visibleToClient: false,
      visible: false,
      approved: false,
      showToClient: false,
      clientVisible: false,
    });
    expect(res.updated[0].visibleToClient).toBe(false);
    expect(res.updated[0].visible).toBe(false);
    expect(res.updated[0].approved).toBe(false);
    expect(lineVisibleToClient(res.updated[0])).toBe(false);
  });

  it("refresh falls back to per-item patch on 404", async () => {
    const request = vi.fn(async (path) => {
      if (path.endsWith("/refresh-from-material")) {
        const err = new Error("HTTP 404");
        err.status = 404;
        throw err;
      }
      return { id: "it1", price: 120 };
    });

    const res = await refreshItemsFromMaterialWithFallback(
      request,
      "p1",
      { itemIds: ["it1"], fields: ["price"] },
      {
        items: [{ id: "it1", materialId: "m1" }],
        materials: [{ id: "m1", basePrice: 120 }],
      }
    );

    expect(res.fallback).toBe(true);
    expect(res.updated).toHaveLength(1);
    expect(request).toHaveBeenCalledWith(
      `/api/projects/p1/items/${encodeURIComponent("it1")}`,
      expect.objectContaining({ method: "PATCH" })
    );
  });
});
