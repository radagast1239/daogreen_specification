import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const filters = read("src/components/SpecQuickFilters.jsx");
const rowMenu = read("src/components/SpecificationRowMenu.jsx");
const page = read("src/pages/admin/SpecEditorPage.jsx");
const css = read("src/styles/specification-table.css");

describe("project workspace Phase C2 contracts", () => {
  it("supports additive filters, removable chips and reset all", () => {
    expect(filters).toContain("activeFilters.map");
    expect(filters).toContain("activeFilters.filter");
    expect(filters).toContain("Сбросить всё");
    expect(filters).toContain("Ещё фильтры");
    expect(page).toContain("quickFilters.every");
  });

  it("keeps row actions on existing page callbacks", () => {
    for (const label of ["Подробнее", "Обновить из базы", "Дублировать", "Переместить", "Удалить"])
      expect(rowMenu).toContain(label);
    expect(rowMenu).not.toMatch(/api\.|fetch\(|axios/);
    expect(page).toContain('refreshFromBase([it.id], ["all"])');
    expect(page).toContain("actions.itemDelete(project.id, it.id)");
  });

  it("contains narrow viewport overflow guards", () => {
    expect(css).toContain("overflow-x:hidden");
    expect(css).toContain("max-width:100%");
    expect(css).toContain("position:fixed");
  });
});
