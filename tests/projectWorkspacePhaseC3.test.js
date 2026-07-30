import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const css = read("src/styles/specification-table.css");
const page = read("src/pages/admin/SpecEditorPage.jsx");
const filters = read("src/components/SpecQuickFilters.jsx");
const menu = read("src/components/SpecificationRowMenu.jsx");

describe("project workspace Phase C3 visual polish", () => {
  it("keeps compact table, menu and overflow polish classes", () => {
    expect(css).toContain(".spec-table-controls");
    expect(css).toContain(".spec-name-input");
    expect(css).toContain("-webkit-line-clamp: 2");
    expect(css).toContain(".spec-supplier--catalog");
    expect(css).toContain("font-variant-numeric: tabular-nums");
    expect(css).toContain(".spec-row-menu__delete");
    expect(css).toContain("overflow-x:hidden");
    expect(css).toContain("max-width:100%");
    expect(css).toContain("position:fixed");
    expect(css).toContain("@media (max-width: 900px)");
  });

  it("separates filters and column presets visually", () => {
    expect(page).toContain('className="spec-table-controls"');
    expect(page).toContain('className="spec-columns"');
    expect(filters).toContain("Фильтры");
    expect(page).toContain(">Колонки<");
  });

  it("keeps compact override badge and stable row actions", () => {
    expect(page).toContain("Изменено в проекте");
    expect(page).toContain("spec-name-override");
    expect(page).toContain('title={it.name || ""}');
    expect(menu).toContain("spec-row-menu__delete");
    for (const label of ["Подробнее", "Обновить из базы", "Дублировать", "Переместить", "Удалить"])
      expect(menu).toContain(label);
  });
});
