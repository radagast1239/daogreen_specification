import { describe, expect, it } from "vitest";
import {
  calcPipeLengthMm,
  calcRackUsefulAreaM2,
  calcTankFilledWeightKg,
  createFarmObject,
  createRackGroup,
  formatSocketHeightLabel,
  normalizePlannerObject,
  resolveArrowMoveStepMm,
  shouldRenderPlannerObject,
} from "../src/planner/farmObjects.js";

describe("farm objects", () => {
  it("rack preset creates correct object", () => {
    const rack = createFarmObject({
      id: "r1",
      kind: "rack",
      category: "rack",
      x: 0,
      y: 0,
      w: 2000,
      h: 740,
      params: { levels: 6 },
    }, { presetId: "nft_2000_740" });
    expect(rack.type).toBe("farm_object");
    expect(rack.category).toBe("rack");
    expect(rack.widthMm).toBe(2000);
    expect(rack.params.rackType).toBe("nft");
  });

  it("rack usefulAreaM2 calculated", () => {
    const area = calcRackUsefulAreaM2({ widthMm: 2000, depthMm: 1000, params: { levels: 6 } });
    expect(area).toBeCloseTo(12, 2);
  });

  it("rack group creates N objects", () => {
    const template = { id: "base", kind: "rack", x: 100, y: 200, w: 2000, h: 1000, params: { rackType: "nft" } };
    const { group, children } = createRackGroup(template, { count: 4, rows: 2, spacingMm: 800, aisleMm: 1000 });
    expect(children).toHaveLength(8);
    expect(group.type).toBe("farm_object_group");
    expect(group.childrenIds).toHaveLength(8);
  });

  it("arrow keys move by 10/1/100 mm", () => {
    expect(resolveArrowMoveStepMm({ shiftKey: false, ctrlKey: false, altKey: false }, {})).toBe(10);
    expect(resolveArrowMoveStepMm({ shiftKey: false, ctrlKey: true, altKey: false }, {})).toBe(1);
    expect(resolveArrowMoveStepMm({ shiftKey: true, ctrlKey: false, altKey: false }, {})).toBe(100);
  });

  it("tank filled weight calculated", () => {
    expect(calcTankFilledWeightKg({ volumeL: 750, tareWeightKg: 120 })).toBe(870);
  });

  it("pipe length calculated", () => {
    const pipe = {
      points: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 4000 }],
    };
    expect(calcPipeLengthMm(pipe)).toBe(7000);
  });

  it("socket height displayed as H=120", () => {
    expect(formatSocketHeightLabel(1200)).toBe("H=120");
  });

  it("legacy objects still render", () => {
    const legacy = normalizePlannerObject({ id: "old-1", kind: "table_sow", x: 0, y: 0, w: 1000, h: 700 });
    expect(legacy.type).toBe("legacy_object");
    expect(shouldRenderPlannerObject(legacy)).toBe(true);
  });

  it("dew point and pressure sensors are standalone kinds", () => {
    const dew = normalizePlannerObject({ type: "farm_object", id: "s1", kind: "dew_point_sensor", x: 0, y: 0 });
    const pressure = normalizePlannerObject({ type: "farm_object", id: "s2", kind: "pressure_sensor", x: 100, y: 0 });
    expect(dew.category).toBe("dew_point_sensor");
    expect(dew.params.sensorType).toBe("dew_point");
    expect(pressure.category).toBe("pressure_sensor");
    expect(pressure.params.sensorType).toBe("pressure");
  });
});
