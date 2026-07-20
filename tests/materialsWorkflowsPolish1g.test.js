import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

describe("materials workflows polish 1g", () => {
  const editor = read("src/pages/admin/MaterialsPage.jsx");
  const importPanel = read("src/components/ExcelImportPanel.jsx");
  const quality = read("src/pages/admin/MaterialsQualityPage.jsx");
  const photos = read("src/pages/admin/PhotosPage.jsx");
  const css = read("src/styles/theme.css");

  it("keeps all material editor fields accessible in sections", () => {
    for (const key of [
      "name",
      "basePrice",
      "unit",
      "category",
      "supplier",
      "responsible",
      "clientSection",
      "clientSubsection",
      "farmSections",
      "link",
      "vatRate",
      "minOrderQty",
      "orderStep",
      "alternativeMaterialId",
      "clientNote",
      "imageUrl",
      "photoUrl",
      "MaterialModulesEditor",
      "PriceHistoryBlock",
      "PhotoUploadField",
    ]) {
      expect(editor).toContain(key);
    }
    expect(editor).toMatch(/Основное/);
    expect(editor).toMatch(/Клиент и проект/);
    expect(editor).toMatch(/Закупка/);
    expect(editor).toMatch(/Дополнительно/);
    expect(editor).toMatch(/material-edit-modal/);
    expect(editor).toMatch(/Техническая информация/);
  });

  it("opens main sections and collapses purchase/extra by default", () => {
    expect(editor).toMatch(/<details className="material-edit-section" open>[\s\S]*Основное/);
    expect(editor).toMatch(/<details className="material-edit-section" open>[\s\S]*Клиент и проект/);
    expect(editor).toMatch(/<details className="material-edit-section">\s*<summary>Закупка<\/summary>/);
    expect(editor).toMatch(/<details className="material-edit-section">\s*<summary>Дополнительно<\/summary>/);
  });

  it("keeps sticky footer actions and save handler", () => {
    expect(editor).toMatch(/footer=\{/);
    expect(editor).toMatch(/Отмена/);
    expect(editor).toMatch(/Сохранить/);
    expect(editor).toMatch(/onClick=\{save\}/);
    expect(css).toMatch(/\.modal\.material-edit-modal/);
  });

  it("keeps import modes and handlers with collapsed help", () => {
    expect(importPanel).toMatch(/id: "full"/);
    expect(importPanel).toMatch(/id: "photos"/);
    expect(importPanel).toMatch(/actions\.importExcel/);
    expect(importPanel).toMatch(/api\.importExcelPhotos/);
    expect(importPanel).toMatch(/import-help-details/);
    expect(importPanel).toMatch(/excel-import--compact/);
    expect(importPanel).not.toMatch(/import-hint panel/);
  });

  it("compacts quality rows and shows bulk only when selected", () => {
    expect(quality).toMatch(/quality-row/);
    expect(quality).toMatch(/Показать все/);
    expect(quality).toMatch(/Свернуть проблемы/);
    expect(quality).toMatch(/expanded \? "Свернуть проблемы" : "Показать все"/);
    expect(quality).toMatch(/onPatchMaterial\(entry\.row\.id, \{ active: false, status: "archived" \}\)/);
    expect(quality).toMatch(/>\s*Скрыть\s*</);
    expect(quality).toMatch(/selectedIds\.size > 0/);
    expect(quality).toMatch(/buildBulkPatchPayload/);
    expect(quality).toMatch(/QUALITY_QUICK_FILTERS/);
  });

  it("keeps photo upload handlers and collapses technical folder import", () => {
    expect(photos).toMatch(/api\.bulkPhotos/);
    expect(photos).toMatch(/api\.importPhotosFolder/);
    expect(photos).toMatch(/Загрузить и привязать/);
    expect(photos).toMatch(/photos-tech-block/);
    expect(photos).toMatch(/Технический импорт из папки/);
    expect(photos).toMatch(/photos-naming-details/);
  });
});
