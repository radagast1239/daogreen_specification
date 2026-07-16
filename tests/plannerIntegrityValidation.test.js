/**
 * PHASE 0C — тесты validatePlanIntegrity.
 *
 * Валидатор ТОЛЬКО читает план и выдаёт структурированные diagnostics.
 * Здесь проверяются: valid fixtures, повреждённые in-memory варианты,
 * summary, стабильный порядок, иммутабельность входа, устойчивость к мусору,
 * производительность. Активируется regression «duplicate wall edge is diagnosed».
 */
import { describe, it, expect } from "vitest";
import { validatePlanIntegrity } from "../src/planner/core/validation/validatePlanIntegrity.js";
import { loadPlannerFixture, listPlannerFixtures } from "./fixtures/planner/loadFixture.js";

const FIXTURES = listPlannerFixtures();

function codesOf(result) {
  return result.diagnostics.map((d) => d.code);
}
function has(result, code) {
  return result.diagnostics.some((d) => d.code === code);
}
function firstWith(result, code) {
  return result.diagnostics.find((d) => d.code === code);
}

describe("PHASE 0C — valid golden fixtures", () => {
  it.each(FIXTURES)("%s: без error (valid = отсутствие error)", (name) => {
    const r = validatePlanIntegrity(loadPlannerFixture(name));
    expect(r.summary.errors, JSON.stringify(r.diagnostics)).toBe(0);
    expect(r.valid).toBe(true);
  });

  it("legacy-pts-wall: допустимый info, но не error", () => {
    const r = validatePlanIntegrity(loadPlannerFixture("legacy-pts-wall"));
    expect(r.valid).toBe(true);
    expect(has(r, "LEGACY_WALL_MODEL_PRESENT")).toBe(true);
    expect(firstWith(r, "LEGACY_WALL_MODEL_PRESENT").severity).toBe("info");
  });

  it("door-on-wall: проём корректен до искусственного повреждения", () => {
    const r = validatePlanIntegrity(loadPlannerFixture("door-on-wall"));
    expect(r.diagnostics.filter((d) => d.entityType === "opening")).toEqual([]);
  });

  it("planner-spec-ownership: нет ownership-error", () => {
    const r = validatePlanIntegrity(loadPlannerFixture("planner-spec-ownership"));
    expect(has(r, "ITEM_SPEC_OWNERSHIP_INVALID")).toBe(false);
    expect(r.valid).toBe(true);
  });
});

describe("PHASE 0C — повреждённые варианты (in-memory)", () => {
  const base = () => ({
    nodes: { n1: { x: 0, y: 0 }, n2: { x: 3000, y: 0 } },
    walls: [{ id: "w1", a: "n1", b: "n2", thk: 100 }],
    items: [],
    lines: [],
    dimensions: [],
  });

  it("1. отсутствующий node у стены → WALL_NODE_MISSING (error)", () => {
    const p = base(); p.walls[0].b = "nX";
    const r = validatePlanIntegrity(p);
    expect(has(r, "WALL_NODE_MISSING")).toBe(true);
    expect(r.valid).toBe(false);
  });

  it("2. одинаковые endpoints → WALL_ENDPOINTS_EQUAL (error)", () => {
    const p = base(); p.walls[0].b = "n1";
    expect(has(validatePlanIntegrity(p), "WALL_ENDPOINTS_EQUAL")).toBe(true);
  });

  it("3. duplicate edge в обратном направлении → WALL_DUPLICATE_EDGE (error)", () => {
    const p = base(); p.walls.push({ id: "w2", a: "n2", b: "n1" });
    const r = validatePlanIntegrity(p);
    const dup = firstWith(r, "WALL_DUPLICATE_EDGE");
    expect(dup).toBeTruthy();
    expect(dup.severity).toBe("error");
    expect(dup.relatedEntityIds).toContain("w1");
  });

  it("4. NaN node coordinate → NODE_COORDINATE_INVALID (error)", () => {
    const p = base(); p.nodes.n2 = { x: NaN, y: 0 };
    expect(has(validatePlanIntegrity(p), "NODE_COORDINATE_INVALID")).toBe(true);
  });

  it("5. orphan node → NODE_ORPHAN (warning, не error)", () => {
    const p = base(); p.nodes.nZ = { x: 10, y: 10 };
    const r = validatePlanIntegrity(p);
    const orphan = firstWith(r, "NODE_ORPHAN");
    expect(orphan.severity).toBe("warning");
    expect(r.valid).toBe(true);
  });

  it("6. malformed legacy pts → LEGACY_WALL_PTS_INVALID (error)", () => {
    const p = { walls: [{ id: "w1", pts: [{ x: 0, y: 0 }] }] };
    expect(has(validatePlanIntegrity(p), "LEGACY_WALL_PTS_INVALID")).toBe(true);
  });

  it("7. network/pts geometry conflict → WALL_GEOMETRY_MODEL_AMBIGUOUS (error)", () => {
    const p = base(); p.walls[0].pts = [{ x: 0, y: 0 }, { x: 999, y: 999 }];
    expect(has(validatePlanIntegrity(p), "WALL_GEOMETRY_MODEL_AMBIGUOUS")).toBe(true);
  });

  it("8. opening без wallId → OPENING_WALL_ID_MISSING (error)", () => {
    const p = base(); p.items.push({ id: "d1", kind: "door", x: 1000, y: -50, w: 900, h: 100 });
    expect(has(validatePlanIntegrity(p), "OPENING_WALL_ID_MISSING")).toBe(true);
  });

  it("9. opening с wallId несуществующей стены → OPENING_WALL_NOT_FOUND (error)", () => {
    const p = base(); p.items.push({ id: "d1", kind: "door", x: 1000, y: -50, w: 900, h: 100, wallId: "wX" });
    expect(has(validatePlanIntegrity(p), "OPENING_WALL_NOT_FOUND")).toBe(true);
  });

  it("10. opening со stale wallSeg (дефект split) → OPENING_WALL_SEG_INVALID", () => {
    const p = base(); // стена теперь 0..3000
    p.items.push({ id: "d1", kind: "door", x: 1000, y: -50, w: 900, h: 100, wallId: "w1", wallSeg: { a: { x: 0, y: 0 }, b: { x: 6000, y: 0 } } });
    expect(has(validatePlanIntegrity(p), "OPENING_WALL_SEG_INVALID")).toBe(true);
  });

  it("11. dimension с отсутствующей стеной → DIMENSION_WALL_NOT_FOUND (error)", () => {
    const p = base(); p.dimensions.push({ id: "dm1", attachedTo: { type: "wall", wallId: "wX" } });
    expect(has(validatePlanIntegrity(p), "DIMENSION_WALL_NOT_FOUND")).toBe(true);
  });

  it("12. dimension с неизвестным target type → DIMENSION_ANCHOR_INVALID (error)", () => {
    const p = base(); p.dimensions.push({ id: "dm1", attachedTo: { type: "weird" } });
    expect(has(validatePlanIntegrity(p), "DIMENSION_ANCHOR_INVALID")).toBe(true);
  });

  it("13. duplicate item ID → ITEM_ID_DUPLICATE (error)", () => {
    const p = base();
    p.items.push({ id: "x", x: 0, y: 0 }, { id: "x", x: 1, y: 1 });
    expect(has(validatePlanIntegrity(p), "ITEM_ID_DUPLICATE")).toBe(true);
  });

  it("14. invalid object position → ITEM_POSITION_INVALID (error)", () => {
    const p = base(); p.items.push({ id: "it1", x: "oops", y: 0 });
    expect(has(validatePlanIntegrity(p), "ITEM_POSITION_INVALID")).toBe(true);
  });

  it("15. route с одной точкой → ROUTE_TOO_SHORT (warning)", () => {
    const p = base(); p.lines.push({ id: "r1", layer: "irrigation", pts: [{ x: 0, y: 0 }] });
    const r = validatePlanIntegrity(p);
    expect(firstWith(r, "ROUTE_TOO_SHORT").severity).toBe("warning");
  });

  it("16. route с Infinity → ROUTE_POINT_INVALID (error)", () => {
    const p = base(); p.lines.push({ id: "r1", layer: "drain", pts: [{ x: 0, y: 0 }, { x: Infinity, y: 0 }] });
    expect(has(validatePlanIntegrity(p), "ROUTE_POINT_INVALID")).toBe(true);
  });

  it("17. invalid room polygon → ROOM_POLYGON_INVALID (warning)", () => {
    const p = base(); p.rooms = [{ id: "rm1", polygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }];
    const r = validatePlanIntegrity(p);
    expect(firstWith(r, "ROOM_POLYGON_INVALID").severity).toBe("warning");
  });

  it("18. неизвестное дополнительное поле не вызывает ошибку", () => {
    const p = base();
    p._weird = 42;
    p.foo = { bar: [1, 2, 3] };
    const r = validatePlanIntegrity(p);
    expect(r.valid).toBe(true);
    expect(r.summary.total).toBe(0);
  });
});

describe("PHASE 0C — summary", () => {
  it("total === diagnostics.length; счётчики по severity верны", () => {
    const p = {
      nodes: { n1: { x: 0, y: 0 }, n2: { x: 3000, y: 0 }, nZ: { x: 1, y: 1 } },
      walls: [{ id: "w1", a: "n1", b: "nX" }, { id: "w2", a: "n1", b: "n2" }, { id: "w3", a: "n2", b: "n1" }],
      items: [{ id: "d1", kind: "door", x: 0, y: 0, w: 900, h: 100 }],
      lines: [{ id: "r1", layer: "irrigation", pts: [{ x: 0, y: 0 }] }],
    };
    const r = validatePlanIntegrity(p);
    expect(r.summary.total).toBe(r.diagnostics.length);
    expect(r.summary.errors).toBe(r.diagnostics.filter((d) => d.severity === "error").length);
    expect(r.summary.warnings).toBe(r.diagnostics.filter((d) => d.severity === "warning").length);
    expect(r.summary.info).toBe(r.diagnostics.filter((d) => d.severity === "info").length);
  });

  it("valid === false при наличии error; true при только warning/info", () => {
    const errPlan = { nodes: { n1: { x: 0, y: 0 } }, walls: [{ id: "w1", a: "n1", b: "nX" }] };
    expect(validatePlanIntegrity(errPlan).valid).toBe(false);
    const warnPlan = { nodes: { n1: { x: 0, y: 0 }, n2: { x: 100, y: 0 }, nZ: { x: 9, y: 9 } }, walls: [{ id: "w1", a: "n1", b: "n2" }] };
    const r = validatePlanIntegrity(warnPlan);
    expect(r.summary.errors).toBe(0);
    expect(r.summary.warnings).toBeGreaterThan(0);
    expect(r.valid).toBe(true);
  });
});

describe("PHASE 0C — детерминированный порядок", () => {
  it("один и тот же план даёт deep-equal diagnostics при повторной валидации", () => {
    const p = {
      nodes: { n2: { x: 100, y: 0 }, n1: { x: 0, y: 0 }, nZ: { x: 5, y: 5 } },
      walls: [{ id: "w3", a: "n1", b: "nX" }, { id: "w1", a: "n1", b: "n2" }, { id: "w2", a: "n2", b: "n1" }],
      dimensions: [{ id: "dm1", attachedTo: { type: "weird" } }],
    };
    const a = validatePlanIntegrity(p);
    const b = validatePlanIntegrity(p);
    expect(b.diagnostics).toEqual(a.diagnostics);
    // порядок: error перед warning перед info
    const ranks = a.diagnostics.map((d) => ({ error: 0, warning: 1, info: 2 }[d.severity]));
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
  });
});

describe("PHASE 0C — иммутабельность", () => {
  it("validatePlanIntegrity does not mutate input plan", () => {
    const plan = {
      nodes: { n1: { x: 0, y: 0 }, n2: { x: 3000, y: 0 } },
      walls: [{ id: "w1", a: "n1", b: "nX" }, { id: "w2", a: "n1", b: "n2" }],
      items: [{ id: "d1", kind: "door", x: 0, y: 0, w: 900, h: 100, wallId: "wX" }],
      dimensions: [{ id: "dm1", attachedTo: { type: "wall", wallId: "wX" } }],
      lines: [{ id: "r1", layer: "irrigation", pts: [{ x: 0, y: 0 }] }],
      rooms: [{ id: "rm1", polygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
    };
    const clone = structuredClone(plan);
    deepFreeze(plan);
    expect(() => validatePlanIntegrity(plan)).not.toThrow();
    expect(plan).toEqual(clone);
  });
});

describe("PHASE 0C — устойчивость к мусорному входу", () => {
  it.each([
    ["null", null],
    ["string", "not a plan"],
    ["number", 42],
    ["array", [1, 2, 3]],
  ])("%s → PLAN_NOT_OBJECT без исключения", (_label, input) => {
    let r;
    expect(() => { r = validatePlanIntegrity(input); }).not.toThrow();
    expect(r.valid).toBe(false);
    expect(r.diagnostics[0].code).toBe("PLAN_NOT_OBJECT");
  });

  it("частичный/битый план не роняет валидатор", () => {
    for (const p of [
      {},
      { walls: "nope" },
      { nodes: [1, 2] },
      { walls: [null, { id: "w1" }, { id: "w1", a: "n1", b: "n2" }] },
      { items: [null, { id: "i1" }] },
      { dimensions: [null, {}] },
    ]) {
      expect(() => validatePlanIntegrity(p)).not.toThrow();
    }
  });
});

describe("PHASE 0C — обнаружение подтверждённых дефектов", () => {
  // Дефект split (regression #1 остаётся todo как «исправление»),
  // но валидатор теперь ДЕТЕКТИРУЕТ его.
  it("детектирует stale-привязку проёма после split стены", () => {
    const plan = {
      nodes: { n1: { x: 0, y: 0 }, nMid: { x: 3000, y: 0 }, n2: { x: 6000, y: 0 } },
      // исходная стена разбита на две; проём остался на второй половине,
      // но его wallId указывает на первую (w1), wallSeg — исходный 0..6000.
      walls: [{ id: "w1", a: "n1", b: "nMid" }, { id: "w2", a: "nMid", b: "n2" }],
      items: [{ id: "d1", kind: "door", x: 4500, y: -50, w: 900, h: 100, wallId: "w1", wallSeg: { a: { x: 0, y: 0 }, b: { x: 6000, y: 0 } } }],
    };
    const r = validatePlanIntegrity(plan);
    expect(r.diagnostics.some((d) => d.entityType === "opening" && (d.code === "OPENING_WALL_SEG_INVALID" || d.code === "OPENING_REFERENCE_AMBIGUOUS" || d.code === "OPENING_OUTSIDE_WALL"))).toBe(true);
  });

  it("детектирует сохранённые malformed rooms (для будущего regression #7)", () => {
    const plan = { rooms: [{ id: "rm1", polygon: [{ x: 0, y: NaN }, { x: 1, y: 1 }, { x: 2, y: 2 }] }] };
    const r = validatePlanIntegrity(plan);
    expect(r.diagnostics.some((d) => d.entityType === "room")).toBe(true);
  });
});

describe("PHASE 0C — performance baseline", () => {
  const LOG = !!process.env.PLANNER_PERF_LOG;
  it("смешанный план (100 nodes/150 walls, 500 items, 400 route points) в широком бюджете", () => {
    const nodes = {};
    for (let i = 0; i < 100; i++) nodes[`n${i}`] = { x: (i % 10) * 500, y: Math.floor(i / 10) * 500 };
    const walls = [];
    for (let i = 0; i < 150; i++) walls.push({ id: `w${i}`, a: `n${i % 100}`, b: `n${(i + 1) % 100}`, thk: 100 });
    const items = [];
    for (let i = 0; i < 500; i++) items.push({ id: `it${i}`, kind: "rack", x: i * 10, y: i * 5, w: 300, h: 200 });
    const pts = [];
    for (let i = 0; i < 400; i++) pts.push({ x: i, y: i % 50 });
    const lines = [{ id: "route1", layer: "irrigation", pts }];
    const plan = { nodes, walls, items, lines, dimensions: [] };

    const t0 = performance.now();
    const r = validatePlanIntegrity(plan);
    const dt = performance.now() - t0;
    if (LOG) console.log(`[perf] validatePlanIntegrity mixed: ${dt.toFixed(2)}ms`);
    expect(r.summary.total).toBeGreaterThanOrEqual(0);
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
