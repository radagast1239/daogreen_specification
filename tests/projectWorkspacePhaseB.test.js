import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildProjectWorkspaceSearch, parseProjectWorkspaceView } from "../src/lib/projectWorkspaceView.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const page = read("src/pages/admin/SpecEditorPage.jsx");
const tabs = read("src/components/ProjectWorkspaceTabs.jsx");
const css = read("src/styles/project-workspace.css");

describe("project workspace Phase B contracts", () => {
  it("keeps legacy route default and preserves query params", () => {
    expect(parseProjectWorkspaceView(new URLSearchParams(""))).toBe("spec");
    for (const view of ["design", "spec", "publish"]) {
      const params = new URLSearchParams(buildProjectWorkspaceSearch("item=i1&filter=no_price", view));
      expect(params.get("view")).toBe(view);
      expect(params.get("item")).toBe("i1");
      expect(params.get("filter")).toBe("no_price");
    }
  });

  it("switching view remains navigation-only", () => {
    const setter = page.slice(page.indexOf("const setWorkspaceView"), page.indexOf("const { state, actions }"));
    expect(setter).toContain("nav(");
    expect(setter).not.toMatch(/api\.|actions\.|fetch\(/);
  });

  it("removes visual jump-row", () => {
    expect(page).not.toContain("pw-jump-row");
    expect(page).not.toContain("К проектированию");
    expect(page).not.toContain("К клиентской выдаче");
  });

  it("keeps panes mounted while excluding inactive panes from layout and accessibility", () => {
    expect(page).toContain('data-workspace-pane="design"');
    expect(page).toContain('data-workspace-pane="publish"');
    expect(page).toContain('data-workspace-pane="spec-table"');
    expect(page.match(/aria-hidden=/g).length).toBeGreaterThanOrEqual(10);
    expect(page.match(/hidden=/g).length).toBeGreaterThanOrEqual(10);
    expect(css).toContain("display: none !important");
  });

  it("shows FloorPlanPin only in design", () => {
    expect(page).toContain('workspaceView === "design"');
    expect(page).toContain("showFloorPlanPin && <FloorPlanPin");
    expect(page).not.toContain('uploadedSchemes.length > 0 && (tab === "spec" || tab === "calc")');
  });

  it("guards workspace navigation while a SpecTab modal is open", () => {
    expect(page).toContain("specModalOpen && next !== workspaceView");
    expect(page).toContain("Сначала завершите или закройте открытое окно");
    expect(page).toContain("Boolean(saveTplModule || addMaterialModule)");
  });

  it("supports keyboard navigation and keeps the active mobile tab visible", () => {
    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) expect(tabs).toContain(key);
    expect(tabs).toContain("scrollIntoView");
    expect(tabs).toContain("tabIndex={selected ? 0 : -1}");
    expect(css).toContain("overflow-x: auto");
    expect(css).toContain("linear-gradient");
  });

  it("keeps stable React keys for workspace tabs", () => {
    expect(tabs).toContain("key={id}");
    expect(tabs).not.toMatch(/<[^>]+\{\.\.\.\w+\}[^>]+key=/);
  });
});
