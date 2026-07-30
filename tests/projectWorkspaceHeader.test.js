import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const header = read("src/components/ProjectWorkspaceHeader.jsx");
const tabs = read("src/components/ProjectWorkspaceTabs.jsx");
const page = read("src/pages/admin/SpecEditorPage.jsx");
const css = read("src/styles/project-workspace.css");

describe("project workspace compact header", () => {
  it("renders the project identity and the existing three-tab navigation", () => {
    expect(header).toContain('project?.name || "Проект"');
    expect(header).toContain("ProjectWorkspaceTabs");
    expect(tabs).toContain("PROJECT_WORKSPACE_VIEWS.map");
  });

  it("has one sticky workspace layer and no sticky tabs", () => {
    expect(header).toContain('data-workspace-sticky="true"');
    expect(css.match(/position:\s*sticky/g)).toHaveLength(1);
    expect(css).toMatch(/\.pw-header\s*\{[\s\S]*position:\s*sticky/);
    expect(css).not.toMatch(/\.pw-tabs\s*\{[\s\S]{0,160}position:\s*sticky/);
  });

  it("uses hysteresis observers with cleanup and no scroll listener", () => {
    expect(header).toContain("IntersectionObserver");
    expect(header).toContain("collapseObserver");
    expect(header).toContain("expandObserver");
    expect(header).toContain("-96px 0px 0px 0px");
    expect(header).toContain("disconnect()");
    expect(header).not.toContain('addEventListener("scroll"');
  });

  it("keeps publish actions on their original callbacks without duplicate HQ buttons", () => {
    for (const callback of ["requestClientLink", "copyClientLink", "exportClientPdf", "exportClientExcel", "setPrePublishOpen(true)"]) {
      expect(page).toContain(callback);
    }
    expect(page).toContain("hidePrimaryActions");
    expect(header).toContain("publishActions.onOpenClientLink");
    expect(header).toContain("publishActions.onExportPdf");
    expect(header).toContain("publishActions.onExportExcel");
  });

  it("does not recalculate totals or readiness in the header", () => {
    expect(header).not.toContain("projectTotals");
    expect(header).not.toContain("buildProjectSendReadiness");
    expect(header).not.toContain("reduce(");
  });
});
