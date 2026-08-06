/**
 * PHASE 0A — Регрессионные тесты планировщика.
 *
 * Правило пакета:
 *   • если текущее поведение уже КОРРЕКТНО — активный passing-тест;
 *   • если дефект ПОДТВЕРЖДЁН на реальном коде — it.todo с названием требуемого
 *     результата (production-код НЕ меняется в этом пакете).
 *
 * it.todo намеренно не выполняется: он фиксирует требование будущей миграции,
 * не кодируя ошибочное поведение как желаемое и не ломая suite.
 *
 * Подтверждения дефектов получены прямыми прогонами normalizePlan /
 * breakWallEdgeAt (см. RESULT — PHASE 0A, раздел Confirmed audit findings).
 */
import { describe, it, expect } from "vitest";
import { normalizePlan } from "../src/planner/planNormalize.js";
import { resolvePlanWalls, movePlanNode } from "../src/planner/wallNetwork.js";
import { resolveAttachedDimension } from "../src/planner/core/dimensions/model.js";
import { runSnapEngine } from "../src/planner/core/snap/snapEngine.js";
import { createPlannerSpecItems } from "../src/planner/specSync.js";
import { loadPlannerFixture } from "./fixtures/planner/loadFixture.js";
import { parsePlannerPlan, resolveProjectPlanFields } from "../backend/src/plannerPlanState.js";
import { validatePlanIntegrity } from "../src/planner/core/validation/validatePlanIntegrity.js";
import { hitTestPlan, pxToWorld, PLAN_HIT_TEST } from "../src/planner/ui/hitTesting/planHitTest.js";

function withResolvedWalls(plan) {
  return { ...plan, walls: resolvePlanWalls(plan) };
}

describe("PHASE 0A regressions — активные (поведение уже корректно)", () => {
  // #2 manual dimension follows its geometry anchor
  it("manual dimension follows its geometry anchor", () => {
    const plan = normalizePlan(loadPlannerFixture("manual-dimension"));
    const before = resolveAttachedDimension(plan.dimensions[0], withResolvedWalls(plan));
    expect(before.invalid).toBe(false);
    expect(before.p2.x).toBe(4000);

    // Двигаем конечный узел стены — размер должен следовать за геометрией.
    const wall = plan.walls[0];
    const moved = movePlanNode(plan, wall.b, { x: 5000, y: 0 });
    const after = resolveAttachedDimension(moved.dimensions[0], withResolvedWalls(moved));
    expect(after.invalid).toBe(false);
    expect(after.p2.x).toBe(5000);
  });

  // #3 wall snap screen distance is invariant across zoom
  it("wall snap screen distance is invariant across zoom", () => {
    const plan = normalizePlan(loadPlannerFixture("door-on-wall")); // стена n1(0,0)-n2(4000,0)
    // Точка на фиксированном ЭКРАННОМ расстоянии 60px от вершины n1.
    // Мировое смещение = 60 / zoom -> разное при разных зумах, но снап к вершине
    // должен срабатывать одинаково (порог core snap = px / zoom, экранно-инвариантен).
    const snapVertexAt = (zoom) => runSnapEngine({
      point: { x: 60 / zoom, y: 0 },
      mode: "wall",
      plan,
      view: { zoom },
      options: { snapOn: true, snapWalls: true, snapGrid: false, snapDistancePx: 10 },
    });
    const results = [0.08, 0.2, 0.5].map(snapVertexAt);
    for (const r of results) {
      expect(r.snapped).toBe(true);
      expect(r.type).toBe("vertex");
      expect(r.point).toEqual({ x: 0, y: 0 });
    }
  });

  // #9 network wall attached dimension resolves after reload
  it("network wall attached dimension resolves after reload", () => {
    const once = normalizePlan(loadPlannerFixture("manual-dimension"));
    // reload = сериализация в JSON и повторная нормализация (как через backend).
    const reloaded = normalizePlan(JSON.parse(JSON.stringify(once)));
    const dim = reloaded.dimensions[0];
    expect(dim.attachedTo).toBeTruthy();
    expect(dim.attachedTo.type).toBe("wall");
    const resolved = resolveAttachedDimension(dim, withResolvedWalls(reloaded));
    expect(resolved.invalid).toBe(false);
    expect(Number.isFinite(resolved.p1.x)).toBe(true);
  });

  // #10 normalization does not lose specification ownership metadata
  it("normalization does not lose specification ownership metadata", () => {
    const once = normalizePlan(loadPlannerFixture("planner-spec-ownership"));
    const reloaded = normalizePlan(JSON.parse(JSON.stringify(once)));
    const rack = reloaded.items.find((it) => it.id === "rk1");
    expect(rack.includedInProject).toBe(true);
    expect(rack.specMode).toBe("custom");
    const spec = createPlannerSpecItems({ plan: reloaded, materials: [], modules: [], existingItems: [] });
    expect(spec.generatedCount).toBe(1);
    expect(spec.generated[0].source).toBe("planner");
    expect(spec.generated[0].sourceObjectIds).toContain("rk1");
  });

  // #4 node hit radius remains a reasonable screen-space value
  // Активирован в PHASE 0E: прежний порог узла был `320 / zoom`
  // (core/walls/wallOps.js:861) — ≈320 ЭКРАННЫХ px при видимом маркере 6px,
  // причём узел возвращался безусловно, до проверки тела стены.
  it("node hit radius remains a reasonable screen-space value", () => {
    // 1. Радиус захвата узла задан в экранных пикселях и разумен.
    expect(PLAN_HIT_TEST.nodeRadiusPx).toBeGreaterThanOrEqual(8);
    expect(PLAN_HIT_TEST.nodeRadiusPx).toBeLessThanOrEqual(14);

    const plan = {
      nodes: { n1: { x: 0, y: 0 }, n2: { x: 4000, y: 0 } },
      walls: [{ id: "w1", a: "n1", b: "n2", thk: 100 }],
    };

    for (const zoom of [0.05, 0.1, 0.25, 0.5, 1, 2, 4]) {
      // 2. Одинаковое ЭКРАННОЕ отклонение даёт одинаковый результат при любом zoom.
      const onNode = hitTestPlan({ plan, worldPoint: { x: pxToWorld(4, zoom), y: 0 }, zoom });
      expect(onNode.type, `zoom=${zoom} 4px от узла`).toBe("node");
      expect(onNode.nodeId).toBe("n1");

      // 3. Узел за пределами порога НЕ перехватывает клик по телу стены.
      //    40px вдоль стены: со старым радиусом 320px это был бы node.
      const onWall = hitTestPlan({ plan, worldPoint: { x: pxToWorld(40, zoom), y: 0 }, zoom });
      expect(onWall.type, `zoom=${zoom} 40px от узла`).toBe("wall");
      expect(onWall.entityId).toBe("w1");

      // 4. Захват узла не превышает заявленный радиус (не 320px).
      const justOutside = hitTestPlan({
        plan,
        worldPoint: { x: pxToWorld(PLAN_HIT_TEST.nodeRadiusPx + 6, zoom), y: 0 },
        zoom,
      });
      expect(justOutside.type, `zoom=${zoom} чуть вне радиуса`).not.toBe("node");
    }
  });

  // #6 duplicate wall edge is diagnosed
  // Активирован в PHASE 0C: rejection ещё не реализован (production wall creation
  // не менялся), но валидатор целостности ДИАГНОСТИРУЕТ дубль ребра.
  it("duplicate wall edge is diagnosed", () => {
    const plan = normalizePlan({
      room: { w: 12000, h: 8000, height: 3000 },
      nodes: { n1: { x: 0, y: 0 }, n2: { x: 4000, y: 0 } },
      walls: [
        { id: "w1", a: "n1", b: "n2", thk: 100 },
        { id: "w2", a: "n2", b: "n1", thk: 100 }, // тот же неориентированный edge
      ],
    });
    const result = validatePlanIntegrity(plan);
    const dup = result.diagnostics.find((d) => d.code === "WALL_DUPLICATE_EDGE");
    expect(dup).toBeTruthy();
    expect(dup.severity).toBe("error");
    expect(dup.entityType).toBe("wall");
    expect(dup.relatedEntityIds.length).toBeGreaterThan(0);
    expect(result.valid).toBe(false);
  });

  // #5 malformed saved plan is not silently replaced with an empty plan
  // Активирован в PHASE 0B: backend различает "нет плана" и "повреждён",
  // повреждённый план не превращается молча в {} / пустой план.
  it("malformed saved plan is not silently replaced with an empty plan", () => {
    const malformed = '{"walls":[{"id":"w1"}], "nodes": {oops';

    const parsed = parsePlannerPlan(malformed);
    expect(parsed.status).toBe("corrupt");
    expect(parsed.plan).toBeNull();
    expect(parsed.code).toBe("PLANNER_PLAN_JSON_INVALID");

    // Пустой/отсутствующий план — это НЕ повреждение (без ложных срабатываний).
    expect(parsePlannerPlan("{}").status).toBe("empty");
    expect(parsePlannerPlan(null).status).toBe("empty");

    // На уровне проекта: повреждение выдаёт diagnostic, а не пустой план.
    const fields = resolveProjectPlanFields(malformed, null);
    expect(fields.plan).toBeNull();
    expect(fields.plan).not.toEqual({});
    expect(fields.plannerPlanState).toEqual({ status: "corrupt", code: "PLANNER_PLAN_JSON_INVALID" });
  });

  // #8 dense wall normalization stays within the current performance budget
  it("dense wall normalization stays within the current performance budget", () => {
    // Детерминированная плотная сетка узлов/стен (без random).
    const nodes = {};
    const walls = [];
    const N = 12; // 12x12 сетка -> 144 узла, ~264 ребра
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        nodes[`n_${i}_${j}`] = { x: i * 500, y: j * 500 };
      }
    }
    let k = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        if (i + 1 < N) walls.push({ id: `h_${k++}`, a: `n_${i}_${j}`, b: `n_${i + 1}_${j}`, thk: 100 });
        if (j + 1 < N) walls.push({ id: `v_${k++}`, a: `n_${i}_${j}`, b: `n_${i}_${j + 1}`, thk: 100 });
      }
    }
    const raw = { room: { w: 12000, h: 8000, height: 3000 }, nodes, walls, items: [], lines: [] };
    const t0 = performance.now();
    const plan = normalizePlan(raw);
    const dt = performance.now() - t0;
    // Широкий бюджет: цель — ловить катастрофические регрессии, не микросекунды.
    expect(plan.walls.length).toBeGreaterThan(0);
    expect(dt).toBeLessThan(5000);
    if (process.env.PLANNER_PERF_LOG) console.log(`[perf] dense normalize ${dt.toFixed(1)}ms`);
  });
});

describe("PHASE 0A regressions — подтверждённые дефекты (todo до миграции)", () => {
  // #1 ПОДТВЕРЖДЕНО: breakWallEdgeAt не мигрирует проём на новую половину стены.
  // Дверь с center на второй половине сохраняет wallId исходной стены (теперь первая
  // половина), новая половина получает новый id -> проём "отвязывается".
  it.todo("opening remains attached after wall split");

  // #4 АКТИВИРОВАН в PHASE 0E (см. активный тест выше): порог узла переведён
  // в экранные пиксели и вынесен в ui/hitTesting/planHitTest.js.

  // #5 АКТИВИРОВАН в PHASE 0B (см. активный тест выше).

  // #6 АКТИВИРОВАН в PHASE 0C как «duplicate wall edge is diagnosed» (см. выше).
  // Полное rejection при создании стены — задача будущей фазы.

  // #7 ПОДТВЕРЖДЕНО: в normalizePlan синк комнат обёрнут в try/catch, который
  // молча гасит исключение (catch (_) -> сброс rooms/zones) вместо диагностики.
  it.todo("room detection reports diagnostics instead of swallowing errors");
});
