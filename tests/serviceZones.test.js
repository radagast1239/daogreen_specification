import { describe, expect, it } from "vitest";
import {
  defaultServiceZoneForKind,
  isServiceZoneEnabled,
  resolveServiceZone,
  serviceZoneElements,
} from "../src/planner/serviceZones.js";

const tank = {
  id: "t1",
  kind: "tank",
  x: 0,
  y: 0,
  w: 1000,
  h: 800,
  angle: 0,
};

describe("serviceZoneElements", () => {
  it("uses profile defaults when serviceZone is missing", () => {
    expect(defaultServiceZoneForKind("tank").enabled).toBe(true);
    expect(isServiceZoneEnabled(tank)).toBe(true);
    const zones = serviceZoneElements(tank);
    expect(zones.length).toBeGreaterThan(0);
  });

  it("returns no zones when explicitly disabled", () => {
    const off = { ...tank, serviceZone: { enabled: false } };
    expect(isServiceZoneEnabled(off)).toBe(false);
    expect(serviceZoneElements(off)).toEqual([]);
  });

  it("respects toggle back on with saved dimensions", () => {
    const on = {
      ...tank,
      serviceZone: { enabled: true, front: 500, back: 400, left: 300, right: 300, access: 600 },
    };
    expect(serviceZoneElements(on).length).toBeGreaterThan(0);
    expect(resolveServiceZone(on).front).toBe(500);
  });

  it("rack profile is off by default until enabled", () => {
    const rack = { ...tank, kind: "rack" };
    expect(isServiceZoneEnabled(rack)).toBe(false);
    expect(serviceZoneElements(rack)).toEqual([]);
    const enabled = { ...rack, serviceZone: { enabled: true, front: 900, back: 700, left: 250, right: 250, access: 900 } };
    expect(serviceZoneElements(enabled).length).toBeGreaterThan(0);
  });
});
