import { describe, expect, it, beforeEach } from "vitest";
import { updateMaterial, createMaterial, getMaterial } from "../backend/src/routes/materials.js";
import { db, initDb } from "../backend/src/db.js";

beforeEach(() => {
  initDb(":memory:");
  db.prepare("DELETE FROM materials").run();
});

describe("updateMaterial", () => {
  it("preserves responsible when not in patch (clientVisibleDefault)", () => {
    const m = createMaterial({ name: "Test", defaultQty: 1, responsible: "climate" });
    const updated = updateMaterial(m.id, { clientVisibleDefault: false });
    expect(updated.responsible).toBe("climate");
  });

  it("preserves responsible when not in patch (needsApproval)", () => {
    const m = createMaterial({ name: "Test", defaultQty: 1, responsible: "climate" });
    const updated = updateMaterial(m.id, { needsApproval: true });
    expect(updated.responsible).toBe("climate");
  });

  it("preserves responsible on partial patch from MaterialsQualityPage", () => {
    const m = createMaterial({ name: "Test", defaultQty: 1, responsible: "climate" });
    const updated = updateMaterial(m.id, { category: "Требует разбора", clientSection: "requires_review" });
    expect(updated.responsible).toBe("climate");
  });

  it("updates responsible when explicitly provided", () => {
    const m = createMaterial({ name: "Test", defaultQty: 1, responsible: "climate" });
    const updated = updateMaterial(m.id, { responsible: "plumber" });
    expect(updated.responsible).toBe("plumber");
  });

  it("sets to general when explicitly empty", () => {
    const m = createMaterial({ name: "Test", defaultQty: 1, responsible: "climate" });
    const updated = updateMaterial(m.id, { responsible: "" });
    expect(updated.responsible).toBe("general");
  });
});
