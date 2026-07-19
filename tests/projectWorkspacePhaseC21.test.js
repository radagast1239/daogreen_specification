import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { resolveEffectiveSupplier } from "../shared/itemTypes.js";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("Project Workspace C2.1", () => {
  it("resolves catalog supplier from material and preserves safe fallbacks", () => {
    expect(resolveEffectiveSupplier({ materialId: "m1", supplier: "legacy" }, { supplier: "live" })).toBe("live");
    expect(resolveEffectiveSupplier({ materialId: "missing", supplier: "snapshot" }, null)).toBe("snapshot");
    expect(resolveEffectiveSupplier({ supplier: "manual" }, null)).toBe("manual");
  });

  it("locks catalog supplier while keeping manual supplier editable", () => {
    const page = read("src/pages/admin/SpecEditorPage.jsx");
    const inspector = read("src/components/SpecificationItemInspector.jsx");
    expect(page).toContain("readOnly || it.materialId");
    expect(inspector).toContain("readOnly={!!item.materialId}");
    expect(inspector).toContain("Поставщик закреплён в базе материалов");
  });

  it("persists and explicitly resets project name override", () => {
    const db = read("backend/src/db.js");
    const routes = read("backend/src/routes/projects.js");
    const inspector = read("src/components/SpecificationItemInspector.jsx");
    expect(db).toContain("name_overridden");
    expect(routes).toContain("effectivePatch.nameOverridden = true");
    expect(inspector).toContain("Название изменено в проекте");
    expect(inspector).toContain("nameOverridden: false");
  });

  it("keeps refresh name-safe and row menus exclusive/dismissible", () => {
    const types = read("shared/itemTypes.js");
    const menu = read("src/components/SpecificationRowMenu.jsx");
    expect(types.match(/REFRESH_FROM_MATERIAL_FIELDS[\s\S]*?\];/)[0]).not.toContain('"name"');
    expect(menu).toContain("spec-row-menu-open");
    expect(menu).toContain('event.key === "Escape"');
    expect(menu).toContain('document.addEventListener("pointerdown"');
  });
});
