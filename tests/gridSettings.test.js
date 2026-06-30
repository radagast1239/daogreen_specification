import { describe, it, expect } from "vitest";
import {
  resolveGrid,
  gridLineLevel,
  GRID_MINOR_STEP,
  GRID_MEDIUM_STEP,
  GRID_MAJOR_STEP,
  normalizeDisplay,
} from "../src/planner/gridSettings.js";

describe("resolveGrid", () => {
  it("shows only major grid at low zoom", () => {
    const cfg = resolveGrid({ zoom: 0.1 });
    expect(cfg.minor).toBeNull();
    expect(cfg.medium).toBeNull();
    expect(cfg.major).toBe(GRID_MAJOR_STEP);
    expect(cfg.iterStep).toBe(GRID_MAJOR_STEP);
  });

  it("shows medium and major at mid zoom", () => {
    const cfg = resolveGrid({ zoom: 0.5 });
    expect(cfg.minor).toBeNull();
    expect(cfg.medium).toBe(GRID_MEDIUM_STEP);
    expect(cfg.major).toBe(GRID_MAJOR_STEP);
    expect(cfg.iterStep).toBe(GRID_MEDIUM_STEP);
  });

  it("shows all three levels at close zoom", () => {
    const cfg = resolveGrid({ zoom: 1.0 });
    expect(cfg.minor).toBe(GRID_MINOR_STEP);
    expect(cfg.fine).toBe(50);
    expect(cfg.medium).toBe(GRID_MEDIUM_STEP);
    expect(cfg.major).toBe(GRID_MAJOR_STEP);
    expect(cfg.iterStep).toBe(50);
  });

  it("respects showGrid off", () => {
    expect(resolveGrid({ showGrid: false }).visible).toBe(false);
  });
});

describe("gridLineLevel", () => {
  const full = { minor: 50, medium: 100, major: 1000 };

  it("prefers major over medium and minor", () => {
    expect(gridLineLevel(1000, full)).toBe("major");
    expect(gridLineLevel(2000, full)).toBe("major");
  });

  it("returns medium on 100 mm lines", () => {
    expect(gridLineLevel(100, full)).toBe("medium");
  });

  it("returns minor on 50 mm lines", () => {
    expect(gridLineLevel(50, full)).toBe("minor");
  });
});

describe("normalizeDisplay", () => {
  it("defaults snap step to 50 mm independent of visual grid", () => {
    const d = normalizeDisplay({});
    expect(d.snapStep).toBe(50);
    expect(d.dimensionDisplayMode).toBe("remplanner_cm");
  });

  it("keeps pdf grid off by default", () => {
    const d = normalizeDisplay({});
    expect(d.pdfGridInstall).toBe(false);
    expect(d.pdfGridTechnical).toBe(false);
    expect(d.pdfGridMajorOnly).toBe(true);
  });
});
