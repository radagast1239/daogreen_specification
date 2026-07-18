import { describe, expect, it } from "vitest";
import {
  normalizeProjectWorkspaceView,
  parseProjectWorkspaceView,
  buildProjectWorkspaceSearch,
  DEFAULT_PROJECT_WORKSPACE_VIEW,
  PROJECT_WORKSPACE_VIEWS,
  PROJECT_WORKSPACE_VIEW_LABELS,
} from "../src/lib/projectWorkspaceView.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

describe("project workspace view routing", () => {
  it("defaults absent/empty/unknown to spec", () => {
    expect(normalizeProjectWorkspaceView(undefined)).toBe("spec");
    expect(normalizeProjectWorkspaceView(null)).toBe("spec");
    expect(normalizeProjectWorkspaceView("")).toBe("spec");
    expect(normalizeProjectWorkspaceView("   ")).toBe("spec");
    expect(normalizeProjectWorkspaceView("nope")).toBe("spec");
    expect(DEFAULT_PROJECT_WORKSPACE_VIEW).toBe("spec");
  });

  it("accepts design/spec/publish", () => {
    expect(normalizeProjectWorkspaceView("design")).toBe("design");
    expect(normalizeProjectWorkspaceView("SPEC")).toBe("spec");
    expect(normalizeProjectWorkspaceView("Publish")).toBe("publish");
    expect(PROJECT_WORKSPACE_VIEWS).toEqual(["design", "spec", "publish"]);
    expect(PROJECT_WORKSPACE_VIEW_LABELS.design).toContain("Проектирование");
  });

  it("parses from URLSearchParams and query strings", () => {
    expect(parseProjectWorkspaceView(new URLSearchParams(""))).toBe("spec");
    expect(parseProjectWorkspaceView(new URLSearchParams("view="))).toBe("spec");
    expect(parseProjectWorkspaceView(new URLSearchParams("view=design"))).toBe("design");
    expect(parseProjectWorkspaceView("view=publish&item=x")).toBe("publish");
    expect(parseProjectWorkspaceView("?view=design&section=stellages")).toBe("design");
    expect(parseProjectWorkspaceView({ view: "publish", item: "a" })).toBe("publish");
  });

  it("buildProjectWorkspaceSearch preserves other params", () => {
    const next = buildProjectWorkspaceSearch("item=i1&section=stellages&focus=general", "publish");
    const p = new URLSearchParams(next);
    expect(p.get("view")).toBe("publish");
    expect(p.get("item")).toBe("i1");
    expect(p.get("section")).toBe("stellages");
    expect(p.get("focus")).toBe("general");
  });

  it("switching view only changes view key", () => {
    const a = buildProjectWorkspaceSearch("view=design&item=abc", "spec");
    const b = buildProjectWorkspaceSearch("view=spec&item=abc", "design");
    expect(new URLSearchParams(a).get("item")).toBe("abc");
    expect(new URLSearchParams(b).get("view")).toBe("design");
  });
});

describe("project workspace Phase A source contracts", () => {
  const page = fs.readFileSync(path.join(root, "src/pages/admin/SpecEditorPage.jsx"), "utf8");
  const tabs = fs.readFileSync(path.join(root, "src/components/ProjectWorkspaceTabs.jsx"), "utf8");
  const css = fs.readFileSync(path.join(root, "src/styles/project-workspace.css"), "utf8");

  it("wires tabs + keep-mounted panes", () => {
    expect(page).toContain("ProjectWorkspaceTabs");
    expect(page).toContain("parseProjectWorkspaceView");
    expect(page).toContain("buildProjectWorkspaceSearch");
    expect(page).toContain("pw-pane--inactive");
    expect(page).toContain('data-workspace-pane="publish"');
    expect(page).toContain('data-workspace-pane="design"');
    expect(page).toContain("workspaceView={workspaceView}");
    expect(tabs).toContain("PROJECT_WORKSPACE_VIEW_LABELS");
    expect(css).toContain("pw-pane--inactive");
    const labels = fs.readFileSync(path.join(root, "src/lib/projectWorkspaceView.js"), "utf8");
    expect(labels).toContain("Проектирование");
    expect(labels).toContain("Спецификация");
    expect(labels).toContain("Клиентская выдача");
  });

  it("does not use replace for user tab clicks (push via navigate default)", () => {
    expect(page).toMatch(/setWorkspaceView\(v\)/);
    expect(page).toMatch(/nav\(\{ pathname: location\.pathname[\s\S]*replace \}/);
  });

  it("keeps design + publish capabilities in page", () => {
    for (const needle of [
      "StellageFrameDrawingsPanel",
      "ProjectDocuments",
      "FarmPowerEditor",
      "RoomCoolingEditor",
      "ClientSchemesEditor",
      "RoomsEditor",
      "ProjectReleaseHistory",
      "ProjectClientReadinessPanel",
      "ProjectHqBar",
      "onExportPdf",
      "onExportExcel",
      "CoolingFarmTab",
      "SpecQuickFilters",
    ]) {
      expect(page).toContain(needle);
    }
  });

  it("does not remove write callbacks", () => {
    for (const needle of [
      "patchItem",
      "projectUpdate",
      "itemAdd",
      "createVersion",
      "regenerateLink",
      "exportClientPdf",
      "exportClientExcel",
    ]) {
      expect(page).toContain(needle);
    }
  });
});
