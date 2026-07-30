import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(
  path.join(__dirname, "../src/pages/admin/SpecEditorPage.jsx"),
  "utf8"
);

/**
 * Functional parity map for Phase A — features must remain reachable in source.
 * Callback names must still be wired (not deleted).
 */
const PARITY = [
  ["qty / price / supplier / link", ["spec-qty-cell", "Поставщик", "Ссылка", "patchItem"]],
  ["visibility / inclusion", ["Скрыто", "В проекте", "buildClientVisibilityPatch"]],
  ["comments", ["commentExpandId", "spec-comment-cell"]],
  ["duplicate / move / delete", ["DuplicateProjectModal", "itemDelete", "delete"]],
  ["bulk / filters", ["SpecQuickFilters", "bulkPatchModule", "SpecSectionToolbar"]],
  ["update from material DB", ["refreshItemsFromMaterial", "applyAllCatalogUpdates"]],
  ["rack specs + BOM", ["StellageFrameDrawingsPanel"]],
  ["cooling", ["RoomCoolingEditor", "CoolingFarmTab", "ProjectCoolingSummary"]],
  ["electrical consumption", ["FarmPowerEditor", "Электропотребление"]],
  ["rooms / schemes / documents", ["RoomsEditor", "ClientSchemesEditor", "ProjectDocuments"]],
  ["readiness / preview / publish", ["ProjectClientReadinessPanel", "PublishVersionModal", "doPublishVersion"]],
  ["release comment / history / compare", ["ProjectReleaseHistory", "CompareProjectsModal", "PublishVersionModal"]],
  ["PDF / Excel", ["exportClientPdf", "exportClientExcel", "onExportPdf", "onExportExcel"]],
  ["client link / regenerate", ["ClientLinkModal", "regenerateLink", "requestClientLink"]],
];

describe("project workspace functional parity", () => {
  for (const [label, needles] of PARITY) {
    it(`keeps ${label}`, () => {
      for (const n of needles) {
        expect(page, `missing ${n} for ${label}`).toContain(n);
      }
    });
  }

  it("workspace modes cover design/spec/publish panes", () => {
    expect(page).toContain('data-workspace-pane="design"');
    expect(page).toContain('data-workspace-pane="publish"');
    expect(page).toContain('data-workspace-pane="spec-chrome"');
    expect(page).toContain('data-workspace-pane="spec-design"');
    expect(page).toContain('data-workspace-pane="spec-table"');
  });

  it("App.jsx / Layout / api.js unchanged by this phase (no imports of workspace in them)", () => {
    const app = fs.readFileSync(path.join(__dirname, "../src/App.jsx"), "utf8");
    const layout = fs.readFileSync(path.join(__dirname, "../src/components/Layout.jsx"), "utf8");
    const api = fs.readFileSync(path.join(__dirname, "../src/lib/api.js"), "utf8");
    expect(app).not.toContain("ProjectWorkspaceTabs");
    expect(layout).not.toContain("ProjectWorkspaceTabs");
    expect(api).not.toContain("projectWorkspaceView");
  });
});
