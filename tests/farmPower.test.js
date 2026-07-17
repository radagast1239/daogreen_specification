import { describe, expect, it } from "vitest";
import { farmPowerFingerprint, farmPowerTotals, normalizeFarmPower } from "../shared/farmPower.js";
import { automaticFarmPowerDevices, buildFarmPowerSnapshot } from "../shared/farmPower.js";

describe("farm power manual summary", () => {
  it("normalizes devices and calculates normal and peak totals", () => {
    const power = normalizeFarmPower({ devices: [
      { id: "pump", name: " Насос ", normalKw: 2.5, peakKw: 4 },
      { id: "ac", name: "Кондиционер", normalKw: "12", peakKw: "18.5" },
    ] });
    expect(power.devices[0].name).toBe("Насос");
    expect(farmPowerTotals(power)).toEqual({ normalKw: 14.5, peakKw: 22.5 });
  });

  it("clamps invalid and negative values to zero", () => {
    expect(normalizeFarmPower({ devices: [{ name: "Вентилятор", normalKw: -3, peakKw: "bad" }] }).devices[0])
      .toMatchObject({ normalKw: 0, peakKw: 0 });
  });

  it("fingerprint changes when a manual power value changes", () => {
    const base = { devices: [{ id: "fan", name: "Вентилятор", normalKw: 1, peakKw: 2 }] };
    expect(farmPowerFingerprint(base)).not.toBe(farmPowerFingerprint({ devices: [{ ...base.devices[0], peakKw: 3 }] }));
  });

  it("adds lighting from every room and uses lamp electrical watts", () => {
    const rooms = [
      { id: "r1", name: "Ферма", cooling: { params: { shelves: 12, tiers: 5, lampW: 40, lightHours: 16 } } },
      { id: "r2", name: "Рассада", cooling: { params: { shelves: 4, tiers: 3, lampW: 30, lightHours: 12 } } },
    ];
    const rows = automaticFarmPowerDevices({}, rooms);
    expect(rows.map((row) => row.normalKw)).toEqual([2.4, 0.36]);
    expect(rows.map((row) => row.dailyKwh)).toEqual([38.4, 4.32]);
  });

  it("uses manual day/night AC electrical power and never cooling kW", () => {
    const rooms = [{
      id: "r1", name: "Ферма",
      cooling: { recommendedKw: 63.52, params: { shelves: 0, tiers: 0, lampW: 0 } },
      acUnits: [{ qty: 2, coolingKw: 40 }],
    }];
    const raw = { acSchedules: [{ roomId: "r1", dayKw: 5, dayHours: 16, nightKw: 1.2, nightHours: 8 }] };
    const row = automaticFarmPowerDevices(raw, rooms)[0];
    expect(row).toMatchObject({ normalKw: 3.733, peakKw: 5, dailyKwh: 89.6 });
    expect(row.normalKw).not.toBe(63.52);
    expect(row.normalKw).not.toBe(80);
    expect(buildFarmPowerSnapshot(raw, rooms).devices[0].source).toBe("ac_schedule");
  });
});
