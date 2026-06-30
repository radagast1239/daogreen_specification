import { describe, expect, it } from "vitest";
import { calculateRoomAirExchange, calculateRoomVolume, collectClimateWarnings, normalizeDuct, syncClimatePlan } from "../src/planner/climate.js";

describe("climate planner task 10", () => {
  it("calculates room volume", () => {
    const volume = calculateRoomVolume({
      areaMm2: 30_000_000,
      heightMm: 3200,
    });
    expect(volume).toBe(96);
  });

  it("calculates required air exchange", () => {
    const result = calculateRoomAirExchange({
      areaMm2: 25_000_000,
      heightMm: 3000,
      targetAirChanges: 7,
    });
    expect(result.volumeM3).toBe(75);
    expect(result.requiredAirflowM3h).toBe(525);
    expect(result.recommendedFanM3h).toBe(1000);
  });

  it("normalizes duct and keeps direction and diameter", () => {
    const duct = normalizeDuct({
      id: "d1",
      layer: "vent",
      lineTag: "supply",
      points: [{ x: 0, y: 0 }, { x: 2000, y: 0 }],
      diameterMm: 315,
      flowDirection: "reverse",
    });
    expect(duct.type).toBe("duct");
    expect(duct.lineType).toBe("supply_duct");
    expect(duct.diameterMm).toBe(315);
    expect(duct.flowDirection).toBe("reverse");
  });

  it("autoconnects duct endpoints to climate objects", () => {
    const plan = syncClimatePlan({
      items: [
        { id: "f1", kind: "blade_fan", category: "fan", x: 0, y: 0, w: 600, h: 600, params: { airflowM3h: 2500 } },
        { id: "s1", kind: "supply", category: "supply", x: 2800, y: 0, w: 400, h: 140, params: { airflowM3h: 1200 } },
      ],
      lines: [
        {
          id: "d1",
          layer: "vent",
          lineTag: "supply",
          points: [{ x: 300, y: 300 }, { x: 3000, y: 70 }],
          diameterMm: 250,
        },
      ],
      rooms: [],
      zones: [],
    });
    const duct = plan.lines.find((ln) => ln.id === "d1");
    expect(duct.fromObjectId).toBe("f1");
    expect(duct.toObjectId).toBe("s1");
  });

  it("warns production room about missing sensors and ventilation", () => {
    const warnings = collectClimateWarnings({
      rooms: [
        {
          id: "r-prod",
          name: "Production",
          category: "production_main",
          x: 0,
          y: 0,
          w: 6000,
          h: 4000,
          areaMm2: 24_000_000,
          heightMm: 3000,
          targetAirChanges: 8,
        },
      ],
      zones: [],
      items: [],
      lines: [],
      climateSettings: { forbidIndoorOverPassage: true },
    });
    expect(warnings.some((w) => w.id.includes("climate-no-target-temp"))).toBe(true);
    expect(warnings.some((w) => w.id.includes("climate-no-temp-sensor"))).toBe(true);
    expect(warnings.some((w) => w.id.includes("climate-no-vent"))).toBe(true);
    expect(warnings.some((w) => w.id.includes("climate-airflow-deficit"))).toBe(true);
  });

  it("warns about duct without endpoints", () => {
    const warnings = collectClimateWarnings({
      rooms: [],
      zones: [],
      items: [],
      lines: [
        {
          id: "d-open",
          type: "duct",
          layer: "vent",
          lineType: "duct",
          points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }],
        },
      ],
    });
    expect(warnings.some((w) => w.id.includes("duct-no-connection"))).toBe(true);
  });

  it("warns indoor unit over staff passage route geometry", () => {
    const warnings = collectClimateWarnings({
      rooms: [],
      zones: [],
      items: [
        { id: "ac-1", kind: "indoor_unit", category: "indoor_unit", x: 1000, y: 900, w: 600, h: 260 },
      ],
      lines: [
        {
          id: "route-1",
          layer: "staff",
          lineTag: "staff",
          points: [{ x: 0, y: 1000 }, { x: 3000, y: 1000 }],
        },
      ],
      climateSettings: { forbidIndoorOverPassage: true, indoorPassageClearanceMm: 300 },
    });
    expect(warnings.some((w) => w.id === "indoor-over-passage-ac-1")).toBe(true);
  });
});
