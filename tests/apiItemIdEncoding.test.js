import { describe, expect, it } from "vitest";

/** Повторяет сборку admin item URL из src/lib/api.js */
function adminItemPath(projectId, itemId, suffix = "") {
  return `/api/projects/${projectId}/items/${encodeURIComponent(itemId)}${suffix}`;
}

describe("admin item API paths — encodeURIComponent(itemId)", () => {
  const projectId = "p_gFcPbbZN4k";

  it("plain item id stays unchanged in decoded form", () => {
    const itemId = "it_manual_abc123";
    const path = adminItemPath(projectId, itemId);
    expect(path).toBe(`/api/projects/${projectId}/items/${itemId}`);
    expect(decodeURIComponent(path.split("/items/")[1])).toBe(itemId);
  });

  it("encodes colons in frame_bom item ids", () => {
    const itemId = "it_fbom_erCDu-yPLsT6_mod_protochka:st_mrcml9dyg23mg_bolt_m6x20";
    const path = adminItemPath(projectId, itemId);
    expect(path).toContain("%3A");
    expect(path).not.toMatch(/mod_protochka:st_/);
    expect(decodeURIComponent(path.split("/items/")[1])).toBe(itemId);
  });

  it("encodes frame_bom sourceKey style id with multiple colons", () => {
    const itemId = "frame_bom:drawing123:mod1:st1:profile_tube_20x20";
    const path = adminItemPath(projectId, itemId);
    expect(path).not.toContain(":");
    expect(decodeURIComponent(path.split("/items/")[1])).toBe(itemId);
  });

  it("encodes slash, space and unicode in item id", () => {
    const itemId = "it/weird id/тест";
    const path = adminItemPath(projectId, itemId);
    expect(path).not.toContain(" ");
    expect(path).not.toContain("/items/it/weird");
    expect(decodeURIComponent(path.split("/items/")[1])).toBe(itemId);
  });

  it("does not double-encode already-encoded segments", () => {
    const itemId = "it_fbom_x:rack1:tube";
    const once = encodeURIComponent(itemId);
    const twice = encodeURIComponent(once);
    expect(once).not.toBe(twice);
    expect(adminItemPath(projectId, itemId)).toBe(
      `/api/projects/${projectId}/items/${once}`,
    );
    expect(adminItemPath(projectId, itemId)).not.toContain("%253A");
  });

  it("patch status URL for BOM item is encoded", () => {
    const itemId = "it_fbom_d1:rack1:profile_tube_20x20";
    const path = adminItemPath(projectId, itemId);
    expect(path).toMatch(/\/items\/it_fbom_d1%3Arack1%3Aprofile_tube_20x20$/);
  });

  it("delete and replacement-review paths use same encoding", () => {
    const itemId = "it_fbom_a:b:c";
    expect(adminItemPath(projectId, itemId, "/replacement-review")).toBe(
      `/api/projects/${projectId}/items/${encodeURIComponent(itemId)}/replacement-review`,
    );
    expect(adminItemPath(projectId, itemId)).toContain("%3A");
  });

  it("purchase status patch uses encoded path for problematic statuses", () => {
    for (const status of ["bought", "have", "need_help", "not_fit", "replacement_check"]) {
      const itemId = `it_fbom_scope:rack:${status}`;
      const path = adminItemPath(projectId, itemId);
      expect(path).not.toMatch(/:need_help|:not_fit/);
      expect(decodeURIComponent(path.split("/items/")[1].split("/")[0])).toBe(itemId);
    }
  });
});
