/**
 * PHASE 0A — performance baseline (диагностика, не оптимизация).
 *
 * Измеряет длительность нормализации / детекции комнат / поиска snap-кандидатов
 * на ДЕТЕРМИНИРОВАННЫХ данных (без random, без таймстемпов). Бюджеты намеренно
 * широкие: цель — ловить катастрофические регрессии, а не микросекунды,
 * т.к. абсолютные ms зависят от машины.
 *
 * Для печати измерений:  PLANNER_PERF_LOG=1 npx vitest run tests/plannerPerformanceBaseline.test.js
 */
import { describe, it, expect } from "vitest";
import { normalizePlan } from "../src/planner/planNormalize.js";
import { syncRooms } from "../src/planner/core/rooms/index.js";
import { runSnapEngine } from "../src/planner/core/snap/snapEngine.js";
import { loadPlannerFixture } from "./fixtures/planner/loadFixture.js";

const LOG = !!process.env.PLANNER_PERF_LOG;
function measure(label, fn, runs = 5) {
  fn(); // прогрев
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) fn();
  const dt = (performance.now() - t0) / runs;
  if (LOG) console.log(`[perf] ${label}: ${dt.toFixed(2)}ms (avg of ${runs})`);
  return dt;
}

function denseGridPlan(n) {
  const nodes = {};
  const walls = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) nodes[`n_${i}_${j}`] = { x: i * 500, y: j * 500 };
  }
  let k = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i + 1 < n) walls.push({ id: `h_${k++}`, a: `n_${i}_${j}`, b: `n_${i + 1}_${j}`, thk: 100 });
      if (j + 1 < n) walls.push({ id: `v_${k++}`, a: `n_${i}_${j}`, b: `n_${i}_${j + 1}`, thk: 100 });
    }
  }
  return { room: { w: 12000, h: 8000, height: 3000 }, nodes, walls, items: [], lines: [] };
}

function manyItemsPlan(count) {
  const items = [];
  const cols = 25;
  for (let i = 0; i < count; i++) {
    const gx = (i % cols) * 400;
    const gy = Math.floor(i / cols) * 400;
    items.push({ id: `it_${i}`, kind: "rack", type: "farm_object", category: "rack", x: gx, y: gy, w: 300, h: 200 });
  }
  return normalizePlan({
    room: { w: 20000, h: 20000, height: 3000 },
    nodes: { n1: { x: 0, y: 0 }, n2: { x: 20000, y: 0 } },
    walls: [{ id: "w1", a: "n1", b: "n2", thk: 100 }],
    items,
  });
}

describe("PHASE 0A — performance baseline", () => {
  it("normalize маленький прямоугольник — в бюджете", () => {
    const raw = loadPlannerFixture("rectangle-room");
    const dt = measure("normalize rectangle", () => normalizePlan(raw));
    expect(dt).toBeLessThan(500);
  });

  it("normalize T-junction — в бюджете", () => {
    const raw = loadPlannerFixture("t-junction");
    const dt = measure("normalize t-junction", () => normalizePlan(raw));
    expect(dt).toBeLessThan(500);
  });

  it("normalize плотной сети стен (12x12) — в широком бюджете", () => {
    const raw = denseGridPlan(12); // 144 узла, ~264 ребра
    const dt = measure("normalize dense 12x12", () => normalizePlan(raw), 3);
    expect(dt).toBeLessThan(6000);
  });

  it("room detection на нескольких комнатах — в бюджете", () => {
    const plan = normalizePlan(loadPlannerFixture("two-rooms"));
    const dt = measure("syncRooms two-rooms", () => syncRooms(plan));
    expect(dt).toBeLessThan(1000);
  });

  it("snap candidate search на плане ~400 объектов — в бюджете", () => {
    const plan = manyItemsPlan(400);
    const dt = measure("snap search 400 items", () => runSnapEngine({
      point: { x: 1234, y: 567 },
      mode: "object",
      plan,
      view: { zoom: 0.2 },
      options: { snapOn: true, snapObjects: true, snapWalls: true, snapDistancePx: 10 },
    }));
    expect(dt).toBeLessThan(1000);
  });
});
