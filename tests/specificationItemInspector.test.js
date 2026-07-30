import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const inspector = fs.readFileSync(path.join(root, "src/components/SpecificationItemInspector.jsx"), "utf8");
const page = fs.readFileSync(path.join(root, "src/pages/admin/SpecEditorPage.jsx"), "utf8");

describe("specification item inspector contracts", () => {
  it("uses stable project item identity, including duplicate material rows", () => {
    expect(page).toContain("setInspectedItemId(it.id)");
    expect(page).toContain("project.items.find((item) => item.id === inspectedItemId)");
    expect(page).not.toContain("setInspectedItemId(it.materialId)");
  });

  it("uses the existing patch callback and unchanged payload keys", () => {
    expect(inspector).toContain("onPatch(item.id, value)");
    for (const payload of ["qty:", "price:", "supplier:", "visibleToClient:", "includedInProject:"])
      expect(inspector).toContain(payload);
    expect(inspector).not.toMatch(/api\.(patch|post|delete)|fetch\(|axios/);
  });

  it("closes with Escape and restores focus to the row trigger", () => {
    expect(inspector).toContain('event.key === "Escape"');
    expect(page).toContain("trigger?.focus()");
    expect(page).toContain("aria-expanded={inspectedItemId === it.id}");
  });

  it("closes predictably when its item is deleted", () => {
    expect(page).toContain("if (inspectedItemId && !inspectedItem) setInspectedItemId(null)");
  });
});
