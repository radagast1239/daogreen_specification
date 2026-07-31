import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulesPage = fs.readFileSync(path.join(__dirname, "../src/pages/admin/ModulesPage.jsx"), "utf8");
const directories = fs.readFileSync(path.join(__dirname, "../src/pages/admin/DirectoriesTab.jsx"), "utf8");
const layout = fs.readFileSync(path.join(__dirname, "../src/components/Layout.jsx"), "utf8");
const modulesUi = fs.readFileSync(path.join(__dirname, "../src/components/modulesUi.jsx"), "utf8");

describe("templates directories cleanup 1c", () => {
  it("renames page title and keeps /modules route wiring", () => {
    expect(modulesPage).toContain('title="Шаблоны и справочники"');
    expect(modulesPage).not.toContain("Модули и шаблоны фермы");
    expect(modulesPage).toContain("Стеллажи, структура фермы, справочники и клиентская выдача");
    expect(layout).toContain('to: "/modules"');
    expect(layout).toContain("Шаблоны и справочники");
  });

  it("keeps all tab ids and groups them visually", () => {
    for (const id of ["stellage", "stellage_composition", "farm", "directories", "brand", "publish"]) {
      expect(modulesPage).toContain(`id: "${id}"`);
    }
    expect(modulesPage).toContain("TAB_GROUPS");
    expect(modulesPage).toContain('label: "Стеллажи"');
    expect(modulesPage).toContain('label: "Ферма"');
    expect(modulesPage).toContain('label: "Клиент"');
  });

  it("uses row action menu, local search, tech details, sticky save", () => {
    expect(modulesUi).toContain("RowActionsMenu");
    expect(modulesUi).toContain("StickySaveBar");
    expect(modulesUi).toContain("TechDetails");
    expect(modulesPage).toContain("ModulesSearch");
    expect(modulesPage).toContain("RowActionsMenu");
    expect(modulesPage).toContain("TechDetails");
    expect(directories).toContain("StickySaveBar");
    expect(modulesUi).toContain("Техническая информация");
    expect(directories).toContain("TechDetails");
    expect(directories).toContain("emptySearchMessage");
    expect(fs.readFileSync(path.join(__dirname, "../src/lib/modulesListView.js"), "utf8")).toContain(
      "Ничего не найдено"
    );
    expect(directories).toContain("Редактировать");
    expect(directories).toContain("+ Новый статус");
    expect(directories).toContain("+ Новая роль");
  });

  it("does not change save API entry points", () => {
    expect(directories).toContain("api.saveSettings(referenceToSettings(ref))");
    expect(modulesPage).toContain("saveStellageGroups");
    expect(modulesPage).toContain("saveSectionName");
    expect(modulesPage).toContain("saveSectionMeta");
  });
});
