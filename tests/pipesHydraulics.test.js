import { describe, expect, it } from "vitest";
import {
  attachPipeConnections,
  calculatePipeLength,
  collectPipeWarnings,
  estimatePipeFittings,
  normalizePipe,
  snapPipeDraftPoint,
} from "../src/planner/pipes.js";

function obj(id, kind, x, y, w, h, connectionPorts = []) {
  return { id, kind, x, y, w, h, connectionPorts, connections: [] };
}

describe("pipes hydraulic model", () => {
  it("pipe length polyline", () => {
    const pipe = normalizePipe({
      id: "p1",
      layer: "irrigation",
      points: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 4000 }],
    });
    expect(calculatePipeLength(pipe).planMm).toBe(7000);
  });

  it("pipe snap to object port", () => {
    const tank = obj("t1", "tank", 1000, 1000, 1200, 1200, [
      { id: "t1-out", type: "outlet", side: "left", offset: 0.5, system: "irrigation", diameterMm: 32 },
    ]);
    const snap = snapPipeDraftPoint(
      { x: 980, y: 1600 },
      {
        items: [tank],
        pipes: [],
        walls: [],
        snapOn: true,
        snapGrid: false,
        snapWalls: false,
        snapObjects: true,
      },
    );
    expect(snap.kind).toBe("port");
    expect(snap.itemId).toBe("t1");
  });

  it("pipe connectedObjectIds updated", () => {
    const tank = obj("t1", "tank", 1000, 1000, 1200, 1200, [
      { id: "t1-out", type: "outlet", side: "right", offset: 0.5, system: "irrigation", diameterMm: 32 },
    ]);
    const pump = obj("pmp1", "pump", 2800, 1300, 800, 500, [
      { id: "pmp1-in", type: "inlet", side: "left", offset: 0.5, system: "irrigation", diameterMm: 32 },
    ]);
    const pipe = normalizePipe({
      id: "pipe-1",
      layer: "irrigation",
      points: [{ x: 2200, y: 1600 }, { x: 2800, y: 1550 }],
    });
    const connected = attachPipeConnections(pipe, [tank, pump], [pipe]);
    expect(connected.connectedObjectIds).toContain("t1");
    expect(connected.connectedObjectIds).toContain("pmp1");
  });

  it("90° corner counted as fitting", () => {
    const pipe = normalizePipe({
      id: "p-corner",
      layer: "irrigation",
      points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 900 }],
    });
    const fittings = estimatePipeFittings(pipe, [pipe]);
    expect(fittings.corners90).toBe(1);
  });

  it("T-joint counted as tee", () => {
    const main = normalizePipe({
      id: "main",
      layer: "irrigation",
      points: [{ x: 0, y: 0 }, { x: 2000, y: 0 }],
    });
    const branch = normalizePipe({
      id: "branch",
      layer: "irrigation",
      points: [{ x: 1000, y: 0 }, { x: 1000, y: 800 }],
    });
    const fittings = estimatePipeFittings(branch, [main, branch]);
    expect(fittings.tees).toBeGreaterThanOrEqual(1);
  });

  it("unconnected pipe end creates warning", () => {
    const plan = {
      items: [],
      lines: [normalizePipe({ id: "p2", layer: "irrigation", points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] })],
    };
    const warnings = collectPipeWarnings(plan);
    expect(warnings.some((w) => w.text.includes("Конец трубы не подключен"))).toBe(true);
  });

  it("drainage pipe without slope creates warning", () => {
    const plan = {
      items: [],
      lines: [normalizePipe({ id: "d1", layer: "drain", pipeSystem: "drainage", slopePercent: 0, points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] })],
    };
    const warnings = collectPipeWarnings(plan);
    expect(warnings.some((w) => w.id.includes("drain-slope-missing"))).toBe(true);
  });

  it("drainage slope <1% creates warning", () => {
    const plan = {
      items: [],
      lines: [normalizePipe({ id: "d2", layer: "drain", pipeSystem: "drainage", slopePercent: 0.5, points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] })],
    };
    const warnings = collectPipeWarnings(plan);
    expect(warnings.some((w) => w.id.includes("drain-slope-low"))).toBe(true);
  });

  it("valve not on pipe creates warning", () => {
    const valve = { id: "v1", kind: "water_valve", category: "valve", x: 100, y: 100, w: 200, h: 120 };
    const plan = {
      items: [valve],
      lines: [normalizePipe({ id: "p3", layer: "irrigation", points: [{ x: 1500, y: 1000 }, { x: 2500, y: 1000 }] })],
    };
    const warnings = collectPipeWarnings(plan);
    expect(warnings.some((w) => w.id.includes("valve-not-on-pipe"))).toBe(true);
  });

  it("pipe spec length rounded with запасом", () => {
    const pipe = normalizePipe({
      id: "p4",
      layer: "irrigation",
      reservePct: 10,
      points: [{ x: 0, y: 0 }, { x: 2700, y: 0 }],
    });
    const len = calculatePipeLength(pipe);
    expect(len.planM).toBeCloseTo(2.7, 3);
    expect(len.withReserveRoundedM).toBe(3);
  });
});
