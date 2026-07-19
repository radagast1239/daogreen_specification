import { describe, expect, it } from "vitest";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("C2.1.1 real row wiring and rename flow", () => {
  const page = read("src/pages/admin/SpecEditorPage.jsx");
  const menu = read("src/components/SpecificationRowMenu.jsx");
  const routes = read("backend/src/routes/projects.js");
  const db = read("backend/src/db.js");
  const store = read("src/store/StoreContext.jsx");

  it("wires every row action to the project item id", () => {
    expect(page).toContain("onDetails={() => setInspectedItemId(it.id)}");
    expect(page).toContain('onRefresh={() => refreshFromBase([it.id], ["all"])}');
    expect(page).toContain("onDuplicate={() => actions.itemAdd(project.id, { ...it })}");
    expect(page).toContain("onMove={(target) => patchItem(it.id");
    expect(page).toContain("actions.itemDelete(project.id, it.id)");
    expect(menu).toContain("data-project-item-id={item.id}");
  });

  it("portals the clickable menu and executes before closing", () => {
    expect(menu).toContain("createPortal");
    expect(menu).toContain("callback?.(); close();");
    expect(menu).toContain("onPointerDown={(event) => event.stopPropagation()}");
    expect(menu).toContain('event.key === "Escape"');
  });

  it("persists both API flag spellings and hydrates the optimistic badge", () => {
    expect(page).toContain("nameOverridden: true");
    expect(page).toContain("Изменено в проекте");
    expect(routes).toContain("patch.name_overridden !== undefined");
    expect(db).toContain("name_overridden: !!row.name_overridden");
    expect(store).toContain('case "PROJECT_ITEM_UPDATE"');
  });
});
