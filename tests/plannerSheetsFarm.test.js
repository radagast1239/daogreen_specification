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
import { createFarmObject, normalizePlannerObject } from "../src/planner/farmObjects.js";

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
