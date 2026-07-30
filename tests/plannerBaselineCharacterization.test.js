/**
 * PHASE 0A — Characterization tests планировщика.
 *
 * Фиксируют ТЕКУЩЕЕ допустимое поведение normalizePlan на golden fixtures
 * (tests/fixtures/planner/*.json). Тесты НЕ требуют изменения production-кода
 * и НЕ кодируют желаемое поведение — только то, что уже истинно сейчас.
 *
 * Опасные дефекты фиксируются как it.todo в plannerBaselineRegressions.test.js.
 */
import { describe, it, expect } from "vitest";
import { normalizePlan } from "../src/planner/planNormalize.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { resolveAttachedDimension } from "../src/planner/core/dimensions/model.js";
import { createPlannerSpecItems } from "../src/planner/specSync.js";
import { loadPlannerFixture, listPlannerFixtures } from "./fixtures/planner/loadFixture.js";

const FIXTURES = listPlannerFixtures();

function isFiniteXY(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function resolvedWalls(plan) {
  return resolvePlanWalls(plan);
}

describe("PHASE 0A characterization — fixtures load & normalize", () => {
  it("набор golden fixtures непустой и включает ожидаемые сценарии", () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(8);
    for (const name of [
      "rectangle-room",
      "legacy-pts-wall",
      "t-junction",
      "door-on-wall",
      "manual-dimension",
      "two-rooms",
      "engineering-route",
      "planner-spec-ownership",
    ]) {
      expect(FIXTURES).toContain(name);
    }
  });

  it.each(FIXTURES)("normalizePlan(%s) не бросает и возвращает объект плана", (name) => {
    const plan = normalizePlan(loadPlannerFixture(name));
    expect(plan).toBeTruthy();
    expect(typeof plan).toBe("object");
    expect(plan.nodes && typeof plan.nodes === "object").toBe(true);
    expect(Array.isArray(plan.walls)).toBe(true);
  });
});

describe("PHASE 0A characterization — 5.2 геометрические инварианты", () => {
  it.each(FIXTURES)("%s: узлы имеют конечные координаты", (name) => {
    const plan = normalizePlan(loadPlannerFixture(name));
    for (const [id, n] of Object.entries(plan.nodes)) {
      expect(isFiniteXY(n), `node ${id}`).toBe(true);
    }
  });

  it.each(FIXTURES)("%s: каждое ребро стены ссылается на существующие узлы", (name) => {
    const plan = normalizePlan(loadPlannerFixture(name));
    for (const w of plan.walls) {
      expect(w.a, `wall ${w.id}.a`).toBeTruthy();
      expect(w.b, `wall ${w.id}.b`).toBeTruthy();
      expect(plan.nodes[w.a], `node for wall ${w.id}.a`).toBeTruthy();
      expect(plan.nodes[w.b], `node for wall ${w.id}.b`).toBeTruthy();
    }
  });

  it.each(FIXTURES)("%s: конечные точки стены различны (нет нулевых рёбер)", (name) => {
    const plan = normalizePlan(loadPlannerFixture(name));
    for (const w of resolvedWalls(plan)) {
      expect(w.pts.length).toBeGreaterThanOrEqual(2);
      const a = w.pts[0];
      const b = w.pts[w.pts.length - 1];
      expect(isFiniteXY(a) && isFiniteXY(b), `wall ${w.id} pts finite`).toBe(true);
      expect(a.x !== b.x || a.y !== b.y, `wall ${w.id} not degenerate`).toBe(true);
    }
  });

  it.each(FIXTURES)("%s: id стен уникальны в пределах плана", (name) => {
    const plan = normalizePlan(loadPlannerFixture(name));
    const ids = plan.walls.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(FIXTURES)("%s: id items уникальны в пределах плана", (name) => {
    const plan = normalizePlan(loadPlannerFixture(name));
    const ids = plan.items.map((it) => it.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("PHASE 0A characterization — 5.1 round-trip", () => {
  // Существенное содержимое, сохраняющееся при сериализации/повторной нормализации.
  function essentials(plan) {
    return {
      wallCount: plan.walls.length,
      nodeCount: Object.keys(plan.nodes).length,
      itemCount: plan.items.length,
      lineCount: plan.lines.length,
      dimCount: plan.dimensions.length,
      roomCount: plan.rooms.length,
      wallIds: plan.walls.map((w) => w.id).sort(),
    };
  }

  it.each(FIXTURES)("%s: round-trip сохраняет количества сущностей и id стен", (name) => {
    const once = normalizePlan(loadPlannerFixture(name));
    const roundTripped = normalizePlan(JSON.parse(JSON.stringify(once)));
    expect(essentials(roundTripped)).toEqual(essentials(once));
  });

  it.each(FIXTURES)("%s: повторная нормализация детерминирована по геометрии узлов", (name) => {
    // Координаты узлов должны совпадать (по значению) после round-trip,
    // даже если сами id узлов у legacy-pts могут пересоздаваться.
    const once = normalizePlan(loadPlannerFixture(name));
    const twice = normalizePlan(JSON.parse(JSON.stringify(once)));
    const coords = (p) => Object.values(p.nodes).map((n) => `${n.x}:${n.y}`).sort();
    expect(coords(twice)).toEqual(coords(once));
  });
});

describe("PHASE 0A characterization — 5.3 стабильность id", () => {
  it("network-модель: id узлов и стен стабильны при round-trip", () => {
    // rectangle-room задан в network-формате (nodes+a/b) — id не пересоздаются.
    const once = normalizePlan(loadPlannerFixture("rectangle-room"));
    const twice = normalizePlan(JSON.parse(JSON.stringify(once)));
    expect(Object.keys(twice.nodes).sort()).toEqual(Object.keys(once.nodes).sort());
    expect(twice.walls.map((w) => w.id).sort()).toEqual(once.walls.map((w) => w.id).sort());
  });

  it("legacy pts→network: id стены сохраняется, id узлов пересоздаётся (текущее поведение)", () => {
    const raw = loadPlannerFixture("legacy-pts-wall");
    const a = normalizePlan(raw);
    const b = normalizePlan(loadPlannerFixture("legacy-pts-wall"));
    // wall.id из исходной 2-точечной pts-стены сохраняется.
    expect(a.walls[0].id).toBe("w1");
    expect(b.walls[0].id).toBe("w1");
    // Но id узлов генерируются через uid() (Date.now+random) — между двумя
    // независимыми нормализациями исходного legacy-плана они различаются.
    const aNodeIds = Object.keys(a.nodes).sort();
    const bNodeIds = Object.keys(b.nodes).sort();
    expect(aNodeIds).not.toEqual(bNodeIds);
  });

  it("авто-помещение имеет детерминированный id по геометрии контура", () => {
    const a = normalizePlan(loadPlannerFixture("rectangle-room"));
    const b = normalizePlan(loadPlannerFixture("rectangle-room"));
    expect(a.rooms).toHaveLength(1);
    expect(a.rooms[0].id).toBe(b.rooms[0].id);
    expect(a.rooms[0].areaM2).toBe(24);
  });
});

describe("PHASE 0A characterization — сценарные инварианты", () => {
  it("rectangle-room: ровно одно помещение площадью 24 м²", () => {
    const plan = normalizePlan(loadPlannerFixture("rectangle-room"));
    expect(plan.rooms).toHaveLength(1);
    expect(plan.rooms[0].areaM2).toBe(24);
    expect(plan.validationWarnings).toEqual([]);
  });

  it("t-junction: три ребра и четыре узла сохраняются", () => {
    const plan = normalizePlan(loadPlannerFixture("t-junction"));
    expect(plan.walls).toHaveLength(3);
    expect(Object.keys(plan.nodes)).toHaveLength(4);
  });

  it("two-rooms: детектируется несколько помещений с конечной положительной площадью", () => {
    // Текущий детектор на общей перегородке выдаёт >= 2 контуров.
    const plan = normalizePlan(loadPlannerFixture("two-rooms"));
    expect(plan.rooms.length).toBeGreaterThanOrEqual(2);
    for (const r of plan.rooms) {
      expect(Number.isFinite(r.areaM2)).toBe(true);
      expect(r.areaM2).toBeGreaterThan(0);
    }
  });

  it("door-on-wall: дверь сохраняет привязку к стене (wallId)", () => {
    const plan = normalizePlan(loadPlannerFixture("door-on-wall"));
    const door = plan.items.find((it) => it.id === "d1");
    expect(door).toBeTruthy();
    expect(door.kind).toBe("door");
    expect(door.wallId).toBe("w1");
    expect(plan.walls.some((w) => w.id === "w1")).toBe(true);
  });

  it("manual-dimension: размер резолвится к геометрии стены (invalid=false)", () => {
    const plan = normalizePlan(loadPlannerFixture("manual-dimension"));
    expect(plan.dimensions).toHaveLength(1);
    const resolved = resolveAttachedDimension(plan.dimensions[0], {
      ...plan,
      walls: resolvePlanWalls(plan),
    });
    expect(resolved.invalid).toBe(false);
    expect(isFiniteXY(resolved.p1) && isFiniteXY(resolved.p2)).toBe(true);
  });

  it("engineering-route: линия трассы нормализуется в трубу с диаметром", () => {
    const plan = normalizePlan(loadPlannerFixture("engineering-route"));
    expect(plan.lines).toHaveLength(1);
    const pipe = plan.lines[0];
    expect(pipe.layer).toBe("irrigation");
    expect(Number.isFinite(pipe.diameterMm)).toBe(true);
    expect(pipe.diameterMm).toBeGreaterThan(0);
  });

  it("planner-spec-ownership: объект порождает planner-owned позицию спецификации", () => {
    const plan = normalizePlan(loadPlannerFixture("planner-spec-ownership"));
    const rack = plan.items.find((it) => it.id === "rk1");
    expect(rack.includedInProject).toBe(true);
    const spec = createPlannerSpecItems({ plan, materials: [], modules: [], existingItems: [] });
    expect(spec.generatedCount).toBe(1);
    expect(spec.generated[0].source).toBe("planner");
    expect(spec.generated[0].sourceObjectIds).toContain("rk1");
  });
});

describe("PHASE 0A characterization — 5.4 видимость повреждений", () => {
  it("malformed (null) план → возвращается непустой DEFAULT_PLAN, не бросает", () => {
    const plan = normalizePlan(null);
    expect(plan).toBeTruthy();
    expect(plan.walls).toEqual([]);
    expect(plan.rooms).toEqual([]);
  });

  it("неизвестные поля верхнего уровня сохраняются (не вычищаются)", () => {
    const plan = normalizePlan({ ...loadPlannerFixture("rectangle-room"), _customUnknown: 42 });
    expect(plan._customUnknown).toBe(42);
  });

  it("стена со ссылкой на несуществующий узел отбрасывается из network-графа", () => {
    // Текущее поведение: ensureWallNetwork/фильтры оставляют только валидные рёбра.
    const raw = loadPlannerFixture("rectangle-room");
    raw.walls.push({ id: "w_bad", a: "n1", b: "nX_missing", thk: 100 });
    const plan = normalizePlan(raw);
    const bad = plan.walls.find((w) => w.id === "w_bad");
    // Ребро на несуществующий узел не резолвится в геометрию.
    expect(resolvePlanWalls(plan).some((w) => w.id === "w_bad")).toBe(false);
    expect(bad === undefined || plan.nodes["nX_missing"] === undefined).toBe(true);
  });
});
