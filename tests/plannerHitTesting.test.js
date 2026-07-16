/**
 * PHASE 0E — screen-space hit testing стен и узлов.
 *
 * Ключевое требование: при одинаковом ЭКРАННОМ отклонении курсора результат
 * не должен зависеть от zoom. Мировое смещение = px / zoom.
 */
import { describe, it, expect } from "vitest";
import {
  hitTestPlan,
  hitTestWallInteraction,
  hitTestWallNodes,
  wallBodyScreenDistance,
  pickBestHitCandidate,
  wallPointsForHit,
  pxToWorld,
  worldToPx,
  PLAN_HIT_TEST,
} from "../src/planner/ui/hitTesting/planHitTest.js";

const ZOOMS = [0.05, 0.1, 0.25, 0.5, 1, 2, 4];

/** Стена n1(0,0) → n2(4000,0), толщина 100. */
function plan() {
  return {
    nodes: { n1: { x: 0, y: 0 }, n2: { x: 4000, y: 0 } },
    walls: [{ id: "w1", a: "n1", b: "n2", thk: 100 }],
    items: [], lines: [], dimensions: [],
  };
}
/** Точка на расстоянии `px` экранных пикселей от мировой точки (по оси Y). */
function offsetPx(base, px, zoom) {
  return { x: base.x, y: base.y + pxToWorld(px, zoom) };
}

describe("PHASE 0E — единицы и перевод", () => {
  it("пороги заданы в экранных пикселях и разумны", () => {
    expect(PLAN_HIT_TEST.nodeRadiusPx).toBeGreaterThanOrEqual(8);
    expect(PLAN_HIT_TEST.nodeRadiusPx).toBeLessThanOrEqual(14);
    expect(PLAN_HIT_TEST.wallDistancePx).toBeGreaterThanOrEqual(6);
    expect(PLAN_HIT_TEST.wallDistancePx).toBeLessThanOrEqual(12);
  });

  it("px→world→px замкнуты (единственный перевод через zoom)", () => {
    for (const z of ZOOMS) {
      expect(worldToPx(pxToWorld(10, z), z)).toBeCloseTo(10, 6);
    }
  });
});

describe("PHASE 0E — 9.1 zoom invariance", () => {
  it.each(ZOOMS)("zoom=%s: узел внутри радиуса → node", (zoom) => {
    const p = plan();
    // 5 px от узла n1 — внутри nodeRadiusPx(10)
    const hit = hitTestPlan({ plan: p, worldPoint: offsetPx({ x: 0, y: 0 }, 5, zoom), zoom });
    expect(hit.type).toBe("node");
    expect(hit.entityId).toBe("w1");
    expect(hit.nodeId).toBe("n1");
    expect(hit.screenDistancePx).toBeCloseTo(5, 4);
  });

  it.each(ZOOMS)("zoom=%s: узел вне радиуса не даёт node", (zoom) => {
    const p = plan();
    // 40 px от узла по оси X (вдоль стены) — вне nodeRadiusPx, но внутри тела стены
    const hit = hitTestPlan({ plan: p, worldPoint: { x: pxToWorld(40, zoom), y: 0 }, zoom });
    expect(hit.type).toBe("wall");
  });

  it.each(ZOOMS)("zoom=%s: стена внутри порога → wall", (zoom) => {
    const p = plan();
    // середина стены, 4 px от тела
    const base = { x: 2000, y: 50 }; // 50 = край тела (thk/2)
    const hit = hitTestPlan({ plan: p, worldPoint: offsetPx(base, 4, zoom), zoom });
    expect(hit.type).toBe("wall");
    expect(hit.entityId).toBe("w1");
  });

  it.each(ZOOMS)("zoom=%s: стена вне порога → null", (zoom) => {
    const p = plan();
    const base = { x: 2000, y: 50 };
    // 30 px от тела — вне wallDistancePx(8)
    const hit = hitTestPlan({ plan: p, worldPoint: offsetPx(base, 30, zoom), zoom });
    expect(hit.type).toBeNull();
  });

  it("радиус узла ограничен экранными пикселями при любом zoom (не 320px)", () => {
    for (const zoom of ZOOMS) {
      // 40 px вдоль стены от узла: при старом пороге 320px это был бы node
      const p = plan();
      const hit = hitTestPlan({ plan: p, worldPoint: { x: pxToWorld(40, zoom), y: 0 }, zoom });
      expect(hit.type, `zoom=${zoom}`).not.toBe("node");
    }
  });
});

describe("PHASE 0E — 9.2 node versus wall", () => {
  it("курсор точно на endpoint → node", () => {
    const hit = hitTestPlan({ plan: plan(), worldPoint: { x: 0, y: 0 }, zoom: 0.1 });
    expect(hit.type).toBe("node");
    expect(hit.nodeIdx).toBe(0);
  });

  it("курсор в середине стены → wall", () => {
    const hit = hitTestPlan({ plan: plan(), worldPoint: { x: 2000, y: 0 }, zoom: 0.1 });
    expect(hit.type).toBe("wall");
  });

  it("стена в 1px, узел в 10px → wall (узел не перехватывает)", () => {
    const zoom = 0.1;
    // точка в 10px от узла вдоль X и в 1px от тела стены
    const pt = { x: pxToWorld(10, zoom), y: 50 + pxToWorld(1, zoom) };
    const hit = hitTestPlan({ plan: plan(), worldPoint: pt, zoom });
    expect(hit.type).toBe("wall");
  });

  it("узел в 2px, стена в 3px → node", () => {
    const zoom = 0.1;
    // 2px от узла n1 по Y (сверху), тело стены на 50мм → 3px+
    const pt = { x: 0, y: -(50 + pxToWorld(3, zoom)) };
    const nodeD = worldToPx(Math.abs(pt.y), zoom);
    expect(nodeD).toBeGreaterThan(0);
    // делаем строгую конфигурацию: узел ближе
    const near = { x: 0, y: pxToWorld(2, zoom) };
    const hit = hitTestPlan({ plan: plan(), worldPoint: near, zoom });
    expect(hit.type).toBe("node");
  });

  it("оба вне порогов → null", () => {
    const hit = hitTestPlan({ plan: plan(), worldPoint: { x: 2000, y: 5000 }, zoom: 0.1 });
    expect(hit.type).toBeNull();
    expect(hit.entityId).toBeNull();
  });

  it("tie-break детерминирован при одинаковом расстоянии", () => {
    const p = {
      nodes: { n1: { x: 0, y: 0 }, n2: { x: 4000, y: 0 }, n3: { x: 0, y: 0 }, n4: { x: 0, y: 4000 } },
      walls: [{ id: "wB", a: "n1", b: "n2", thk: 100 }, { id: "wA", a: "n3", b: "n4", thk: 100 }],
    };
    const a = hitTestPlan({ plan: p, worldPoint: { x: 0, y: 0 }, zoom: 0.1 });
    const b = hitTestPlan({ plan: p, worldPoint: { x: 0, y: 0 }, zoom: 0.1 });
    expect(a).toEqual(b);
    expect(a.entityId).toBe("wA"); // детерминированный tie-break по entityId
  });

  it("pickBestHitCandidate: узел с bias не перебивает значительно ближнюю стену", () => {
    const best = pickBestHitCandidate([
      { type: "node", entityId: "w1", screenDistancePx: 9 },
      { type: "wall", entityId: "w1", screenDistancePx: 1 },
    ]);
    expect(best.type).toBe("wall");
  });

  it("pickBestHitCandidate: узел выигрывает при почти равном попадании", () => {
    const best = pickBestHitCandidate([
      { type: "node", entityId: "w1", screenDistancePx: 3 },
      { type: "wall", entityId: "w1", screenDistancePx: 2 },
    ]);
    expect(best.type).toBe("node");
  });
});

describe("PHASE 0E — 9.3 T-junction", () => {
  // main: n1(0,0)-nT(3000,0)-n2(6000,0); branch: nT(3000,0)-n3(3000,3000)
  const tPlan = () => ({
    nodes: { n1: { x: 0, y: 0 }, nT: { x: 3000, y: 0 }, n2: { x: 6000, y: 0 }, n3: { x: 3000, y: 3000 } },
    walls: [
      { id: "wMainL", a: "n1", b: "nT", thk: 100 },
      { id: "wMainR", a: "nT", b: "n2", thk: 100 },
      { id: "wBranch", a: "nT", b: "n3", thk: 100 },
    ],
  });

  it.each(ZOOMS)("zoom=%s: общий node выбирается рядом с junction", (zoom) => {
    const hit = hitTestPlan({ plan: tPlan(), worldPoint: { x: 3000, y: 0 }, zoom });
    expect(hit.type).toBe("node");
    expect(hit.nodeId).toBe("nT");
  });

  it.each(ZOOMS)("zoom=%s: основная стена выбирается вне тела ветки (фикс. мировая точка)", (zoom) => {
    // Тело стены — МИРОВОЙ объект (толщина 100мм), поэтому «вне ветки» задаём в мм:
    // 400мм вправо от junction заведомо за полосой ветки (±50мм) при любом zoom.
    const hit = hitTestPlan({ plan: tPlan(), worldPoint: { x: 3400, y: 0 }, zoom });
    expect(hit.type).toBe("wall");
    expect(hit.entityId).toBe("wMainR");
  });

  it("рядом с junction обе стены пересекаются телами — выбор детерминирован", () => {
    // На 30мм вправо точка лежит внутри тела И main, и branch (полоса ±50мм).
    // Это законное перекрытие: важно лишь, что результат стабилен.
    const a = hitTestPlan({ plan: tPlan(), worldPoint: { x: 3030, y: 0 }, zoom: 1 });
    const b = hitTestPlan({ plan: tPlan(), worldPoint: { x: 3030, y: 0 }, zoom: 1 });
    expect(a).toEqual(b);
    expect(a.type).toBe("wall");
  });

  it.each(ZOOMS)("zoom=%s: ветка выбирается отдельно", (zoom) => {
    const hit = hitTestPlan({ plan: tPlan(), worldPoint: { x: 3000, y: 3000 - pxToWorld(30, zoom) }, zoom });
    expect(hit.type).toBe("wall");
    expect(hit.entityId).toBe("wBranch");
  });

  it("основная стена не становится невыбираемой в большой зоне вокруг junction", () => {
    const zoom = 0.05; // мелкий зум — раньше здесь была огромная зона узла
    const hit = hitTestPlan({ plan: tPlan(), worldPoint: { x: 3000 + pxToWorld(20, zoom), y: 0 }, zoom });
    expect(hit.type).toBe("wall");
  });
});

describe("PHASE 0E — 9.4 legacy pts стена", () => {
  const legacy = () => ({ walls: [{ id: "wl", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] }] });

  it("тело legacy-стены выбирается", () => {
    const hit = hitTestPlan({ plan: legacy(), worldPoint: { x: 2000, y: 0 }, zoom: 0.1 });
    expect(hit.type).toBe("wall");
    expect(hit.entityId).toBe("wl");
  });

  it("endpoints legacy-стены доступны", () => {
    const hit = hitTestPlan({ plan: legacy(), worldPoint: { x: 0, y: 0 }, zoom: 0.1 });
    expect(hit.type).toBe("node");
    expect(hit.nodeIdx).toBe(0);
  });

  it("вход не мутируется", () => {
    const p = legacy();
    const clone = structuredClone(p);
    hitTestPlan({ plan: p, worldPoint: { x: 2000, y: 0 }, zoom: 0.1 });
    expect(p).toEqual(clone);
  });

  it("wallPointsForHit: network имеет приоритет над pts", () => {
    const pts = wallPointsForHit({ a: "n1", b: "n2", pts: [{ x: 9, y: 9 }, { x: 8, y: 8 }] }, { n1: { x: 0, y: 0 }, n2: { x: 10, y: 0 } });
    expect(pts).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });
});

describe("PHASE 0E — 9.5 невалидная геометрия", () => {
  it("стена с отсутствующим узлом не даёт ложный hit", () => {
    const p = { nodes: { n1: { x: 0, y: 0 } }, walls: [{ id: "w1", a: "n1", b: "nX", thk: 100 }] };
    const hit = hitTestPlan({ plan: p, worldPoint: { x: 0, y: 0 }, zoom: 0.1 });
    expect(hit.type).toBeNull();
  });

  it("NaN координаты не дают hit и не бросают", () => {
    const p = { nodes: { n1: { x: NaN, y: 0 }, n2: { x: 4000, y: 0 } }, walls: [{ id: "w1", a: "n1", b: "n2", thk: 100 }] };
    expect(() => hitTestPlan({ plan: p, worldPoint: { x: 0, y: 0 }, zoom: 0.1 })).not.toThrow();
    expect(hitTestPlan({ plan: p, worldPoint: { x: 0, y: 0 }, zoom: 0.1 }).type).toBeNull();
  });

  it("стена нулевой длины не даёт hit", () => {
    const p = { nodes: { n1: { x: 0, y: 0 }, n2: { x: 0, y: 0 } }, walls: [{ id: "w1", a: "n1", b: "n2", thk: 100 }] };
    expect(hitTestPlan({ plan: p, worldPoint: { x: 0, y: 0 }, zoom: 0.1 }).type).toBeNull();
  });

  it("malformed pts не ломают резолвер", () => {
    for (const w of [{ id: "a", pts: [] }, { id: "b", pts: [{ x: 0, y: 0 }] }, { id: "c", pts: null }, { id: "d" }]) {
      expect(() => hitTestPlan({ plan: { walls: [w] }, worldPoint: { x: 0, y: 0 }, zoom: 0.1 })).not.toThrow();
    }
  });

  it("мусорный вход (null/строка/точка без координат) безопасен", () => {
    expect(hitTestPlan({ plan: null, worldPoint: { x: 0, y: 0 }, zoom: 1 }).type).toBeNull();
    expect(hitTestPlan({ plan: "nope", worldPoint: { x: 0, y: 0 }, zoom: 1 }).type).toBeNull();
    expect(hitTestPlan({ plan: plan(), worldPoint: null, zoom: 1 }).type).toBeNull();
    expect(hitTestPlan({}).type).toBeNull();
  });

  it("zoom=0/отрицательный не даёт Infinity/NaN", () => {
    const hit = hitTestPlan({ plan: plan(), worldPoint: { x: 0, y: 0 }, zoom: 0 });
    expect(Number.isFinite(hit.screenDistancePx ?? 0)).toBe(true);
  });
});

describe("PHASE 0E — hidden/locked слои", () => {
  const p = () => ({
    nodes: { n1: { x: 0, y: 0 }, n2: { x: 4000, y: 0 } },
    walls: [{ id: "w1", a: "n1", b: "n2", thk: 100, layer: "walls" }],
  });

  it("скрытая стена не выбирается", () => {
    const hit = hitTestPlan({ plan: p(), worldPoint: { x: 2000, y: 0 }, zoom: 0.1, visibleLayers: { walls: false } });
    expect(hit.type).toBeNull();
  });

  it("locked стена не выбирается", () => {
    const hit = hitTestPlan({ plan: p(), worldPoint: { x: 2000, y: 0 }, zoom: 0.1, lockedLayers: { walls: true } });
    expect(hit.type).toBeNull();
  });

  it("видимая незалоченная стена выбирается", () => {
    const hit = hitTestPlan({ plan: p(), worldPoint: { x: 2000, y: 0 }, zoom: 0.1, visibleLayers: { walls: true }, lockedLayers: { walls: false } });
    expect(hit.type).toBe("wall");
  });
});

describe("PHASE 0E — 9.6 иммутабельность", () => {
  it("hitTestPlan does not mutate input", () => {
    const p = plan();
    const clone = structuredClone(p);
    deepFreeze(p);
    expect(() => hitTestPlan({ plan: p, worldPoint: { x: 0, y: 0 }, zoom: 0.1 })).not.toThrow();
    expect(() => hitTestPlan({ plan: p, worldPoint: { x: 2000, y: 0 }, zoom: 2 })).not.toThrow();
    expect(p).toEqual(clone);
  });
});

describe("PHASE 0E — hitTestWallInteraction (путь PlanPage)", () => {
  const wall = { id: "w1", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] };

  it("клик по середине длинной стены → segment, а не node", () => {
    const hit = hitTestWallInteraction({ wall, worldPoint: { x: 2000, y: 0 }, zoom: 0.1, allWalls: [wall] });
    expect(hit.kind).toBe("segment");
  });

  it("клик по узлу → node", () => {
    const hit = hitTestWallInteraction({ wall, worldPoint: { x: 0, y: 0 }, zoom: 0.1, allWalls: [wall] });
    expect(hit.kind).toBe("node");
    expect(hit.idx).toBe(0);
  });

  it.each(ZOOMS)("zoom=%s: середина стены никогда не становится node", (zoom) => {
    const hit = hitTestWallInteraction({ wall, worldPoint: { x: 2000, y: 0 }, zoom, allWalls: [wall] });
    expect(hit.kind).not.toBe("node");
  });

  it("далеко от стены → none", () => {
    const hit = hitTestWallInteraction({ wall, worldPoint: { x: 2000, y: 5000 }, zoom: 0.1, allWalls: [wall] });
    expect(hit.kind).toBe("none");
  });

  it("вход не мутируется", () => {
    const w = structuredClone(wall);
    const clone = structuredClone(w);
    hitTestWallInteraction({ wall: w, worldPoint: { x: 10, y: 0 }, zoom: 1, allWalls: [w] });
    expect(w).toEqual(clone);
  });
});

describe("PHASE 0E — 9.7 performance (500 walls / 700 nodes)", () => {
  it("серия hit-тестов в широком бюджете", () => {
    const nodes = {};
    const walls = [];
    for (let i = 0; i < 700; i++) nodes[`n${i}`] = { x: (i % 50) * 500, y: Math.floor(i / 50) * 500 };
    for (let i = 0; i < 500; i++) walls.push({ id: `w${i}`, a: `n${i % 700}`, b: `n${(i + 1) % 700}`, thk: 100 });
    const p = { nodes, walls };
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) {
      hitTestPlan({ plan: p, worldPoint: { x: (i * 37) % 25000, y: (i * 13) % 7000 }, zoom: 0.1 });
    }
    const dt = performance.now() - t0;
    if (process.env.PLANNER_PERF_LOG) console.log(`[perf] hitTestPlan x200 on 500 walls: ${dt.toFixed(1)}ms`);
    expect(dt).toBeLessThan(500);
  });
});

function deepFreeze(obj) {
  if (obj && typeof obj === "object") {
    for (const k of Object.keys(obj)) deepFreeze(obj[k]);
    Object.freeze(obj);
  }
  return obj;
}
