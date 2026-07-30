import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const page = read("src/pages/admin/SpecEditorPage.jsx");
const css = read("src/styles/specification-table.css");

describe("project workspace Phase C1", () => {
  it("switches presets locally without writes or navigation", () => {
    const start = page.indexOf('className="spec-columns"');
    const block = page.slice(start, start + 1400);
    expect(block).toContain("setColumnPreset(id)");
    expect(block).not.toMatch(/api\.|actions\.|fetch\(|nav\(/);
  });

  it("keeps filter, selection and workspace state independent from preset state", () => {
    expect(page).toContain("const [moduleFilters, setModuleFilters]");
    expect(page).toContain("const [moduleSelected, setModuleSelected]");
    expect(page).toContain("const [columnPreset, setColumnPreset]");
    expect(page).not.toContain("setModuleFilters({});\n    setColumnPreset");
  });

  it("keeps inline daily fields in the compact table", () => {
    for (const column of ["qty", "price", "supplier", "purchaseStatus", "clientVisibility"])
      expect(page).toContain(`data-spec-column="${column}"`);
  });

  it("keeps Phase A/B panes and sticky header behavior", () => {
    expect(page).toContain('data-workspace-pane="spec-table"');
    expect(page).toContain('data-workspace-pane="spec-sections"');
    expect(page).toContain("ProjectWorkspaceHeader");
  });

  it("provides desktop and mobile inspector boundaries", () => {
    expect(css).toContain("position:fixed");
    expect(css).toContain("top:62px");
    expect(css).toContain("@media (max-width: 900px)");
    expect(css).toContain("100dvh");
  });
});
