import { describe, expect, it } from "vitest";
import { farmPowerFingerprint, farmPowerTotals, normalizeFarmPower } from "../shared/farmPower.js";

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
});
