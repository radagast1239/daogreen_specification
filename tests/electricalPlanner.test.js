import { describe, expect, it } from "vitest";
import { formatSocketHeightLabel, getFarmObjectSpecPreview } from "../src/planner/farmObjects.js";
import {
  calculateElectricalLoads,
  calculatePowerLineLength,
  collectElectricalWarnings,
  syncRackLinkedLights,
} from "../src/planner/electrical.js";

describe("electrical planner task 9", () => {
  it("socket height formats H=120", () => {
    expect(formatSocketHeightLabel(1200)).toBe("H=120");
  });

  it("socket without group creates warning", () => {
    const warnings = collectElectricalWarnings({
      items: [
        { id: "s1", kind: "socket", category: "socket", x: 0, y: 0, w: 120, h: 80, params: { heightMm: 1200, groupName: "" } },
      ],
      lines: [],
      zones: [],
      electricalGroups: [],
    });
    expect(warnings.some((w) => w.id.includes("socket-no-group"))).toBe(true);
  });

  it("wet room socket without waterproof creates warning", () => {
    const warnings = collectElectricalWarnings({
      items: [
        { id: "s1", kind: "socket", category: "socket", x: 100, y: 100, w: 120, h: 80, params: { groupName: "A", waterproof: false, protectionIp: "IP20" } },
      ],
      lines: [],
      zones: [
        { id: "z1", x: 0, y: 0, w: 1000, h: 1000, category: "shower", name: "Влажная зона" },
      ],
      electricalGroups: [],
    });
    expect(warnings.some((w) => w.id.includes("socket-wet"))).toBe(true);
  });

  it("calculate total power", () => {
    const loads = calculateElectricalLoads({
      items: [
        { id: "rack1", kind: "rack", category: "rack", params: { powerW: 800, groupName: "A" } },
        { id: "pump1", kind: "pump", category: "pump", params: { powerW: 450, groupName: "B" } },
        { id: "light1", kind: "light_panel", category: "light", params: { powerW: 100, count: 4, groupName: "D" } },
      ],
      lines: [],
      electricalGroups: [],
    });
    expect(loads.totals.totalPowerW).toBe(1650);
    expect(loads.totals.lightingPowerW).toBe(400);
    expect(loads.totals.pumpPowerW).toBe(450);
  });

  it("group overload creates warning", () => {
    const warnings = collectElectricalWarnings({
      items: [
        { id: "rack1", kind: "rack", category: "rack", params: { powerW: 2000, groupName: "A" } },
      ],
      lines: [{ id: "pl-1", layer: "power", points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }], fromObjectId: "rack1", toObjectId: "panel1" }],
      zones: [],
      electricalGroups: [{ id: "eg-A", name: "A", maxPowerW: 1000, voltage: 220, phases: 1, objectIds: [] }],
    });
    expect(warnings.some((w) => w.id.includes("group-overload"))).toBe(true);
  });

  it("power line length calculated", () => {
    const len = calculatePowerLineLength({
      id: "pl-1",
      layer: "power",
      type: "power_line",
      points: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 4000 }],
    });
    expect(len).toBe(7000);
  });

  it("380V object in 220V group creates warning", () => {
    const warnings = collectElectricalWarnings({
      items: [
        { id: "s380", kind: "socket", category: "socket", params: { socketType: "industrial_380", voltage: 380, phases: 3, groupName: "A", powerW: 1000 } },
      ],
      lines: [{ id: "pl-2", layer: "power", points: [{ x: 0, y: 0 }, { x: 900, y: 0 }], fromObjectId: "s380", toObjectId: "panel1" }],
      zones: [],
      electricalGroups: [{ id: "eg-A", name: "A", maxPowerW: 5000, voltage: 220, phases: 1, objectIds: [] }],
    });
    expect(warnings.some((w) => w.id.includes("voltage-mismatch"))).toBe(true);
  });

  it("rack lighting count by levels", () => {
    const items = [
      { id: "r1", kind: "rack", category: "rack", x: 1000, y: 1000, w: 2000, h: 700, params: { levels: 6 } },
      { id: "l1", kind: "light_panel", category: "light", x: 1200, y: 1200, w: 1000, h: 120, params: { linkedRackId: "r1", perLevel: 2, lengthMm: 1000, powerW: 40 } },
    ];
    const synced = syncRackLinkedLights(items);
    const light = synced.find((it) => it.id === "l1");
    expect(light.params.count).toBe(12);
    expect(light.label.includes("6 ярусов")).toBe(true);
  });

  it("linked light moves with rack", () => {
    const base = syncRackLinkedLights([
      { id: "r1", kind: "rack", category: "rack", x: 1000, y: 1000, w: 2000, h: 700, params: { levels: 4 } },
      { id: "l1", kind: "light_panel", category: "light", x: 1300, y: 1150, w: 1000, h: 120, params: { linkedRackId: "r1", perLevel: 1, lengthMm: 1000, powerW: 30 } },
    ]);
    const moved = base.map((it) => (it.id === "r1" ? { ...it, x: 1500, y: 1300 } : it));
    const synced = syncRackLinkedLights(moved);
    const light = synced.find((it) => it.id === "l1");
    expect(light.x).toBe(1800);
    expect(light.y).toBe(1450);
  });

  it("spec preview includes lights and sockets", () => {
    const lightRows = getFarmObjectSpecPreview({
      id: "l1",
      type: "farm_object",
      category: "light",
      kind: "light_panel",
      x: 0,
      y: 0,
      w: 1000,
      h: 120,
      widthMm: 1000,
      depthMm: 120,
      params: { lightType: "linear_100", count: 6, lengthMm: 1000, powerW: 40 },
    });
    const socketRows = getFarmObjectSpecPreview({
      id: "s1",
      type: "farm_object",
      category: "socket",
      kind: "socket",
      x: 0,
      y: 0,
      w: 120,
      h: 80,
      widthMm: 120,
      depthMm: 80,
      params: { socketType: "standard_220", groupName: "A" },
    });
    expect(lightRows.some((r) => String(r.item).includes("Светильник"))).toBe(true);
    expect(socketRows.some((r) => String(r.item).includes("Розетка"))).toBe(true);
  });
});
