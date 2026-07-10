import { readFileSync } from "fs";
import { describe, it, expect } from "vitest";

/**
 * Gate invariants after reconciling production 7593942 working tree with local d1be671.
 * Production artifacts were compared in tmp-prod-artifacts/ (not committed).
 */
describe("production reconcile gate (7593942 vs d1be671)", () => {
  it("keeps BEGIN IMMEDIATE transactions (excludes prod recovery BEGIN downgrade)", () => {
    const src = readFileSync("backend/src/db.js", "utf8");
    expect(src).toContain('d.exec("BEGIN IMMEDIATE")');
    expect(src).not.toMatch(/d\.exec\("BEGIN"\)/);
  });

  it("keeps first published release version numbering fix", () => {
    const src = readFileSync("backend/src/routes/projects.js", "utf8");
    expect(src).toMatch(/versionNumber = prev \? Number\(prev\.version_number\) \+ 1 : 1/);
  });

  it("keeps frame drawing client documents with drawing metadata", () => {
    const src = readFileSync("backend/src/routes/projects.js", "utf8");
    expect(src).toContain("LEFT JOIN frame_drawings fd ON fd.file_id = f.id");
    expect(src).toContain("drawingTitle");
    expect(src).toContain("is_client_visible=0");
  });

  it("keeps UPLOAD_ROOT override for frame drawing PDF storage", () => {
    const src = readFileSync("backend/src/routes/frameDrawings.js", "utf8");
    expect(src).toContain("process.env.UPLOAD_ROOT");
    expect(src).toContain("moduleRackKey");
    expect(src).toContain("computeNextVersion");
  });

  it("registers frame-drawings API behind adminAuth", () => {
    const src = readFileSync("backend/src/index.js", "utf8");
    expect(src).toContain('app.use("/api/frame-drawings", adminAuth, frameDrawingsApi)');
  });
});
