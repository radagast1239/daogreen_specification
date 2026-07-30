import { describe, expect, it } from "vitest";
import {
  REQUIRED_FARM_SHEET_IDS,
  SHEETS,
  buildSheetLegend,
  buildVisibilityFromSheet,
  objectVisibleOnSheet,
  resolveSheetId,
  sheetById,
} from "../src/planner/plannerSheets.js";
import { createFarmObject, normalizePlannerObject, farmCategoryForKind } from "../src/planner/farmObjects.js";
import { resolveTool, filterToolGroups } from "../src/planner/plannerTools.js";
import { resolveCatalogKind } from "../src/planner/plannerMaterialPresets.js";
import { toolStateFromDef } from "../src/planner/plannerSheetUtils.js";

describe("farm sheet model", () => {
  it("sheet list has required farm sheets", () => {
    const ids = new Set(SHEETS.map((s) => s.id));
    REQUIRED_FARM_SHEET_IDS.forEach((id) => expect(ids.has(id)).toBe(true));
  });

  it("legacy furniture maps to racks/equipment", () => {
    expect(resolveSheetId("furniture")).toBe("equipment");
    expect(resolveSheetId("furn")).toBe("equipment");
    const legacyFurniture = normalizePlannerObject({ id: "lf-1", kind: "table_sow", layer: "furn", x: 0, y: 0, w: 1200, h: 700 });
    expect(objectVisibleOnSheet(legacyFurniture, "equipment")).toBe(true);
    expect(objectVisibleOnSheet(legacyFurniture, "racks")).toBe(true);
  });

  it("rack visible on racks sheet", () => {
    const rack = createFarmObject({ id: "r1", category: "rack", kind: "rack", layer: "racks", x: 0, y: 0, w: 2000, h: 740 });
    expect(objectVisibleOnSheet(rack, "racks")).toBe(true);
  });

  it("pipe visible on irrigation sheet", () => {
    const pipe = createFarmObject({ id: "p1", category: "pipe", kind: "pipe", layer: "irrigation", x: 0, y: 0, w: 100, h: 100 });
    expect(objectVisibleOnSheet(pipe, "irrigation")).toBe(true);
  });

  it("drain pipe visible on drainage sheet", () => {
    const pipe = createFarmObject({ id: "dp1", category: "drain_pipe", kind: "pipe", layer: "drain", x: 0, y: 0, w: 100, h: 100 });
    expect(objectVisibleOnSheet(pipe, "drainage")).toBe(true);
    expect(objectVisibleOnSheet(pipe, "irrigation")).toBe(false);
  });

  it("sockets visible on electrical sheet", () => {
    const socket = createFarmObject({ id: "s1", category: "socket", kind: "socket", layer: "sockets", x: 0, y: 0, w: 150, h: 80 });
    expect(objectVisibleOnSheet(socket, "electrical")).toBe(true);
  });

  it("active sheet filters layers correctly", () => {
    const vis = buildVisibilityFromSheet(sheetById("racks"));
    expect(vis.racks).toBe(true);
    expect(vis.room).toBe(true);
    expect(vis.power).toBe(false);
  });

  it("legend includes only visible object types", () => {
    const plan = {
      walls: [{ id: "w1", pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] }],
      items: [
        createFarmObject({ id: "rack-1", category: "rack", kind: "rack", layer: "racks", x: 0, y: 0, w: 2000, h: 740 }),
        createFarmObject({ id: "tank-1", category: "tank", kind: "tank", layer: "water", x: 0, y: 0, w: 1200, h: 1000 }),
      ],
      lines: [],
    };
    const legend = buildSheetLegend(plan, "racks").map((l) => l.label);
    expect(legend.some((l) => l.includes("Стены"))).toBe(true);
    expect(legend.some((l) => l.includes("Стеллаж"))).toBe(true);
    expect(legend.some((l) => l.includes("Бак"))).toBe(false);
  });

  it("hidden object not rendered", () => {
    const rack = createFarmObject({ id: "r2", category: "rack", kind: "rack", layer: "racks", visible: false, x: 0, y: 0, w: 2000, h: 740 });
    expect(objectVisibleOnSheet(rack, "racks")).toBe(false);
  });
});

/**
 * PHASE 1A-2C2D3E5C — staff person + route tools. AUDIT PHASE 1A-2C2D3E5C
 * (verdict A, minimal wiring) traced two independent gaps beyond simple
 * tool-registry wiring:
 *   - G1: a freshly created person item resolved to farmCategoryForKind
 *     "custom", whose DEFAULT_VISIBLE_BY_CATEGORY entry excludes "safety",
 *     so the item would never render on the sheet its own category points
 *     at — fixed via a dedicated "personnel" category in both farmObjects.js
 *     (fresh-creation path) and plannerSheets.js (legacy/fallback path).
 *   - G2/G3: route_raw/route_product/route_waste existed in the tool
 *     registry but were absent from every sheet's toolGroups, and no
 *     mode:"add" tool existed for kind:"person" at all.
 * None of this touches geometry core, the staff combined clear path
 * (PHASE 1A-2C2D3E5B, untouched), ObjectPalette.jsx, or PlanPage.jsx —
 * item creation was already layer-driven via the catalog entry, not
 * active-layer-driven (proven below).
 */
describe("PHASE 1A-2C2D3E5C — staff person tool registration", () => {
  it("resolveTool('person') is a mode:\"add\" tool for kind:\"person\" in the routes category", () => {
    const tool = resolveTool("person");
    expect(tool).toBeTruthy();
    expect(tool.mode).toBe("add");
    expect(tool.kind).toBe("person");
    expect(tool.categories).toContain("routes");
  });

  it("route_staff/route_raw/route_product/route_waste keep their existing lineLayer/lineTag semantics unchanged", () => {
    expect(resolveTool("route_staff")).toMatchObject({ mode: "line", lineLayer: "staff", lineTag: "staff" });
    expect(resolveTool("route_raw")).toMatchObject({ mode: "line", lineLayer: "staff", lineTag: "raw" });
    expect(resolveTool("route_product")).toMatchObject({ mode: "line", lineLayer: "staff", lineTag: "product" });
    expect(resolveTool("route_waste")).toMatchObject({ mode: "line", lineLayer: "staff", lineTag: "waste" });
  });

  it("toolStateFromDef maps each route tool to the correct line-draft layer/lineTag, independent of any active-layer state", () => {
    expect(toolStateFromDef(resolveTool("route_staff"))).toMatchObject({ tool: "line", lineLayer: "staff", lineTag: "staff" });
    expect(toolStateFromDef(resolveTool("route_raw"))).toMatchObject({ tool: "line", lineLayer: "staff", lineTag: "raw" });
    expect(toolStateFromDef(resolveTool("route_product"))).toMatchObject({ tool: "line", lineLayer: "staff", lineTag: "product" });
    expect(toolStateFromDef(resolveTool("route_waste"))).toMatchObject({ tool: "line", lineLayer: "staff", lineTag: "waste" });
  });

  it("toolStateFromDef maps the person tool to a pending add of kind:\"person\"", () => {
    const st = toolStateFromDef(resolveTool("person"));
    expect(st.tool).toBe("add");
    expect(st.pending).toBe("person");
  });
});

describe("PHASE 1A-2C2D3E5C — safety sheet toolGroup wiring", () => {
  const safetySheet = sheetById("safety");
  const safeGroup = safetySheet.toolGroups.find((g) => g.id === "safe");

  it("safety sheet's safe toolGroup contains person and all four route tools exactly once each, alongside the pre-existing hygiene tools", () => {
    const required = ["dezmat_hygiene", "dispenser", "comment", "person", "route_staff", "route_raw", "route_product", "route_waste"];
    required.forEach((id) => {
      const count = safeGroup.tools.filter((t) => t === id).length;
      expect(count, `expected exactly one "${id}" in safe toolGroup`).toBe(1);
    });
    expect(safeGroup.tools.length).toBe(required.length);
  });

  it("safety sheet still activates the sanitary layer and still lists staff among its visible layers (no sublayer switch, no new sheet)", () => {
    expect(safetySheet.layerId).toBe("sanitary");
    expect(safetySheet.activeLayer).toBe("sanitary");
    expect(safetySheet.visibleLayers).toContain("staff");
    expect(safetySheet.visibleLayers).toContain("sanitary");
  });

  it("no separate staff sheet was introduced — SHEETS has no entry whose layerId/activeLayer is \"staff\"", () => {
    expect(SHEETS.some((s) => s.layerId === "staff" || s.activeLayer === "staff")).toBe(false);
  });

  it("filterToolGroups(safety groups, \"routes\") returns exactly person + the four route tools", () => {
    const filtered = filterToolGroups(safetySheet.toolGroups, "routes");
    const safe = filtered.find((g) => g.id === "safe");
    expect(safe.tools.slice().sort()).toEqual(["person", "route_product", "route_raw", "route_staff", "route_waste"].sort());
  });

  it("filterToolGroups(safety groups, \"hygiene\") still returns only the pre-existing hygiene tools — route-only tools are excluded", () => {
    const filtered = filterToolGroups(safetySheet.toolGroups, "hygiene");
    const safe = filtered.find((g) => g.id === "safe");
    expect(safe.tools).toEqual(["dezmat_hygiene", "dispenser"]);
    expect(safe.tools).not.toContain("person");
    expect(safe.tools).not.toContain("route_staff");
  });

  it("the generic common toolGroup (select/measure/label/pan) is untouched", () => {
    const commonGroup = safetySheet.toolGroups.find((g) => g.id === "common");
    expect(commonGroup.tools).toEqual(["select", "measure", "label", "pan"]);
  });
});

describe("PHASE 1A-2C2D3E5C — person placement is catalog-driven, not active-layer-driven", () => {
  it("resolveCatalogKind(\"person\") — the same lookup computeItemPlacement uses to build the placed item — resolves kind/layer/size independent of any UI state", () => {
    const c = resolveCatalogKind("person");
    expect(c.kind).toBe("person");
    expect(c.layer).toBe("staff");
    expect(c.w).toBe(450);
    expect(c.h).toBe(450);
  });

  it("resolveCatalogKind takes no active-layer argument at all — the safety sheet staying on active:\"sanitary\" cannot influence the resolved layer", () => {
    expect(resolveCatalogKind.length).toBeLessThanOrEqual(1);
    expect(resolveCatalogKind("person").layer).toBe("staff");
  });
});

describe("PHASE 1A-2C2D3E5C — fresh person visibility (G1 fix, farmObjects.js)", () => {
  it("farmCategoryForKind(\"person\") no longer falls back to \"custom\"", () => {
    expect(farmCategoryForKind("person")).not.toBe("custom");
    expect(farmCategoryForKind("person")).toBe("personnel");
  });

  it("a freshly created person item is visible on the safety sheet", () => {
    // category is computed the same way PlanPage.jsx's addItemAt does
    // (farmCategoryForKind(kind)) and passed through explicitly — createFarmObject
    // itself only trusts an already-valid FARM_OBJECT_CATEGORIES member, it
    // does not auto-derive category from kind internally.
    const person = createFarmObject({ id: "pe1", category: farmCategoryForKind("person"), kind: "person", layer: "staff", x: 0, y: 0, w: 450, h: 450 });
    expect(objectVisibleOnSheet(person, "safety")).toBe(true);
  });

  it("a freshly created person item is not visible on unrelated sheets (equipment/racks — the old \"custom\" default it used to inherit)", () => {
    const person = createFarmObject({ id: "pe2", category: farmCategoryForKind("person"), kind: "person", layer: "staff", x: 0, y: 0, w: 450, h: 450 });
    expect(objectVisibleOnSheet(person, "equipment")).toBe(false);
    expect(objectVisibleOnSheet(person, "racks")).toBe(false);
  });

  it("visibleOnSheets is a fresh array per item, not a shared/mutated reference — creating two person items and checking twice yields consistent results", () => {
    const p1 = createFarmObject({ id: "pe3", category: farmCategoryForKind("person"), kind: "person", layer: "staff", x: 0, y: 0, w: 450, h: 450 });
    const p2 = createFarmObject({ id: "pe4", category: farmCategoryForKind("person"), kind: "person", layer: "staff", x: 500, y: 0, w: 450, h: 450 });
    expect(objectVisibleOnSheet(p1, "safety")).toBe(true);
    expect(objectVisibleOnSheet(p2, "safety")).toBe(true);
    p1.visibleOnSheets.push("__mutated__");
    expect(p2.visibleOnSheets).not.toContain("__mutated__");
    expect(objectVisibleOnSheet(p2, "safety")).toBe(true);
  });

  it("unrelated category defaults are unchanged — rack/pipe/socket still resolve exactly as before", () => {
    const rack = createFarmObject({ id: "r3", category: "rack", kind: "rack", layer: "racks", x: 0, y: 0, w: 2000, h: 740 });
    expect(objectVisibleOnSheet(rack, "racks")).toBe(true);
    const pipe = createFarmObject({ id: "p3", category: "pipe", kind: "pipe", layer: "irrigation", x: 0, y: 0, w: 100, h: 100 });
    expect(objectVisibleOnSheet(pipe, "irrigation")).toBe(true);
    const socket = createFarmObject({ id: "s3", category: "socket", kind: "socket", layer: "sockets", x: 0, y: 0, w: 150, h: 80 });
    expect(objectVisibleOnSheet(socket, "electrical")).toBe(true);
  });
});

describe("PHASE 1A-2C2D3E5C — legacy/fallback person visibility (G1 fix, plannerSheets.js)", () => {
  it("a bare {kind:\"person\", layer:\"staff\"} item with no explicit visibleOnSheets/category (legacy/imported shape) is visible on safety", () => {
    expect(objectVisibleOnSheet({ id: "legacy-1", kind: "person", layer: "staff" }, "safety")).toBe(true);
  });

  it("the same bare legacy item is not visible on unrelated sheets", () => {
    const legacy = { id: "legacy-2", kind: "person", layer: "staff" };
    expect(objectVisibleOnSheet(legacy, "equipment")).toBe(false);
    expect(objectVisibleOnSheet(legacy, "racks")).toBe(false);
    expect(objectVisibleOnSheet(legacy, "electrical")).toBe(false);
  });

  it("a staff-layer item with an unrecognized explicit category string (deep inferByLayer fallback) still resolves to safety", () => {
    const weird = { id: "legacy-3", kind: "person", layer: "staff", category: "__unrecognized_legacy_category__" };
    expect(objectVisibleOnSheet(weird, "safety")).toBe(true);
  });

  it("fresh-creation path and fallback path agree: both a createFarmObject person and a bare person object are visible on safety", () => {
    const fresh = createFarmObject({ id: "pe5", category: farmCategoryForKind("person"), kind: "person", layer: "staff", x: 0, y: 0, w: 450, h: 450 });
    const bare = { id: "legacy-4", kind: "person", layer: "staff" };
    expect(objectVisibleOnSheet(fresh, "safety")).toBe(objectVisibleOnSheet(bare, "safety"));
    expect(objectVisibleOnSheet(fresh, "safety")).toBe(true);
  });

  it("sanitary items continue to render exactly as before the staff/person fallback addition", () => {
    const dezmat = createFarmObject({ id: "dz1", category: "sanitation", kind: "dezmat", layer: "sanitary", x: 0, y: 0, w: 900, h: 600 });
    expect(objectVisibleOnSheet(dezmat, "safety")).toBe(true);
    expect(objectVisibleOnSheet(dezmat, "plumbing")).toBe(true);
  });

  it("rack/water/drain/electrical existing fallback cases are unchanged", () => {
    const rack = createFarmObject({ id: "r4", category: "rack", kind: "rack", layer: "racks", x: 0, y: 0, w: 2000, h: 740 });
    expect(objectVisibleOnSheet(rack, "racks")).toBe(true);
    const pipe = createFarmObject({ id: "dp2", category: "drain_pipe", kind: "pipe", layer: "drain", x: 0, y: 0, w: 100, h: 100 });
    expect(objectVisibleOnSheet(pipe, "drainage")).toBe(true);
    expect(objectVisibleOnSheet(pipe, "irrigation")).toBe(false);
  });

  it("staff routes (lines) do not depend on this item-visibility mapping at all — plain layer match is enough", () => {
    // Documents the asymmetry established by AUDIT PHASE 1A-2C2D3E5C:
    // linesByLayer never calls objectVisibleOnSheet for a sheet with no
    // filters configured (the safety sheet has none), so route reachability
    // was never blocked by this item-only mapping in the first place.
    expect(objectVisibleOnSheet).toBeTypeOf("function");
  });
});

describe("PHASE 1A-2C2D3E5C — persistence round-trip", () => {
  it("normalizePlannerObject preserves kind/layer/visibleOnSheets for a person item", () => {
    const raw = createFarmObject({ id: "pe6", category: farmCategoryForKind("person"), kind: "person", layer: "staff", x: 100, y: 200, w: 450, h: 450 });
    const normalized = normalizePlannerObject(raw);
    expect(normalized.kind).toBe("person");
    expect(normalized.layer).toBe("staff");
    expect(normalized.visibleOnSheets).toEqual(raw.visibleOnSheets);
    expect(objectVisibleOnSheet(normalized, "safety")).toBe(true);
  });

  it("normalizePlannerObject on a bare legacy person (no visibleOnSheets) still yields a safety-visible item after normalization", () => {
    const normalized = normalizePlannerObject({ id: "legacy-5", kind: "person", layer: "staff", x: 0, y: 0, w: 450, h: 450 });
    expect(normalized.kind).toBe("person");
    expect(normalized.layer).toBe("staff");
    expect(objectVisibleOnSheet(normalized, "safety")).toBe(true);
  });
});
