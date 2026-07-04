import { describe, expect, it } from "vitest";
import {
  computeCoolingFarm,
  COOLING_FARM_DEFAULTS,
  reserveCoefToPct,
  pctToReserveCoef,
} from "../src/lib/coolingFarmCalc.js";

function closeTo(actual, expected, precision = 5) {
  expect(actual).toBeCloseTo(expected, precision);
}

describe("computeCoolingFarm", () => {
  it("matches Excel v2 summer peak calculation", () => {
    const calc = computeCoolingFarm({
      length: 2,
      width: 3,
      height: 1.9,
      tOut: 35,
      tIn: 22,
      shelves: 4,
      tiers: 6,
      lampW: 80,
      lmPerWIdeal: 683,
      lmPerWLamp: 180,
      lightHours: 16,

      waterDaily: 0,
      drainPct: 0,
      transpirationPct: 0,
      vaporizationJ: 0,
      heaterW: 0,
      heaterEff: 0,

      uWall: 0.2,
      uRoof: 0.2,
      uFloor: 0.2,
      glassArea: 0,
      uGlass: 0,

      insolGlassArea: 0,
      insolIntensity: 0,
      insolShade: 0,
      insolOrient: 0,
      insolRoofShare: 0,

      staff: 1,
      staffW: 120,
      equipW: 0,
      equipEff: 0.85,

      airExchange: 12,
      airDensity: 1.2,
      airCp: 1005,
      recuperation: 0,
      infiltrationPct: 10,

      nightVentPct: 50,
      dehumidPct: 40,
      dehumidCop: 2.5,

      safetyFactor: 1.1,
      cop: 3.2,
      tariff: 10,
      dayHours: 16,
    });

    closeTo(calc.floorArea, 6);
    closeTo(calc.volume, 11.4);
    closeTo(calc.deltaT, 13);

    closeTo(calc.lampBtu, 4824.755968, 4);
    closeTo(calc.envelopeBtu, 275.018484, 4);
    closeTo(calc.peopleBtu, 409.4568, 4);
    closeTo(calc.ventBtu, 2236.113192, 4);

    closeTo(calc.totalBtu, 7745.344445, 4);
    closeTo(calc.totalKw, 2.269937472, 5);
    closeTo(calc.totalKwSafety, 2.496931219, 5);
    closeTo(calc.modelBtu, 8519.878889, 4);

    expect(calc.standardBtu).toBe(9000);
  });

  it("keeps a typical room in a sane range (no hundreds of kW)", () => {
    const calc = computeCoolingFarm({
      length: 5,
      width: 3.5,
      height: 2.48,
      tOut: 35,
      tIn: 20,
      shelves: 10,
      tiers: 5,
      lampW: 40,
      lmPerWIdeal: 683,
      lmPerWLamp: 165,
      lightHours: 16,

      waterDaily: 0,
      drainPct: 0,
      transpirationPct: 0,
      vaporizationJ: 0,
      heaterW: 0,
      heaterEff: 0,

      uWall: 0.2,
      uRoof: 0.2,
      uFloor: 0.2,
      glassArea: 0,
      uGlass: 0,

      insolGlassArea: 0,
      insolIntensity: 0,
      insolShade: 0,
      insolOrient: 0,
      insolRoofShare: 0,

      staff: 1,
      staffW: 120,
      equipW: 0,
      equipEff: 0.85,

      airExchange: 12,
      airDensity: 1.2,
      airCp: 1005,
      recuperation: 0,
      infiltrationPct: 10,

      safetyFactor: 1.1,
      cop: 3.2,
    });

    expect(calc.totalKwSafety).toBeGreaterThan(1);
    expect(calc.totalKwSafety).toBeLessThan(20);
    expect(calc.modelBtu).toBeGreaterThan(3000);
    expect(calc.modelBtu).toBeLessThan(70000);
    expect(calc.standardBtu).toBeGreaterThanOrEqual(calc.modelBtu);
  });

  it("uses a 30% safety reserve by default", () => {
    expect(COOLING_FARM_DEFAULTS.safetyFactor).toBe(1.3);
    const calc = computeCoolingFarm({ length: 5, width: 4, height: 3 });
    expect(calc.safetyFactor).toBe(1.3);
    expect(calc.totalKwSafety).toBeCloseTo(calc.totalKw * 1.3, 5);
  });

  it("reserve is editable as a percent (coefficient <-> percent)", () => {
    expect(reserveCoefToPct(1.3)).toBe(30);
    expect(reserveCoefToPct(1.1)).toBe(10);
    expect(pctToReserveCoef(30)).toBe(1.3);
    expect(pctToReserveCoef(0)).toBe(1);
    // round-trip default
    expect(pctToReserveCoef(reserveCoefToPct(COOLING_FARM_DEFAULTS.safetyFactor))).toBe(1.3);
    // empty stays empty
    expect(reserveCoefToPct("")).toBe("");
    expect(pctToReserveCoef("")).toBe("");
  });
});
