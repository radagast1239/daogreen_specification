import { describe, expect, it } from "vitest";
import { HistoryModel } from "../src/planner/core/history/historyModel.js";
import { validatePlanIntegrity } from "../src/planner/core/validation/validatePlanIntegrity.js";
import {
  breakWallEdgeAt,
  SPLIT_INTERSECTS_OPENING,
  SPLIT_OPENING_GEOMETRY_INVALID,
  WALL_SPLIT_BOUNDARY_TOLERANCE_MM,
} from "../src/planner/wallNetwork.js";

function ids() {
  const values = ["n-split", "w-target"];
  return () => values.shift();
}

function planFor(a = { x: 0, y: 0 }, b = { x: 6000, y: 0 }, items = [], dimensions = []) {
  return {
    name: "immutable metadata",
    nodes: { n1: a, n2: b },
    walls: [{ id: "w1", a: "n1", b: "n2", thk: 150, material: "brick" }],
    items,
    dimensions,
  };
}

function opening(id, kind, center, extra = {}) {
  const w = extra.w || 600;
  const h = extra.h || 100;
  return { id, kind, x: center.x - w / 2, y: center.y - h / 2, w, h, wallId: "w1", owner: "keep", ...extra };
}

function split(plan, point = { x: 3000, y: 0 }) {
  return breakWallEdgeAt(plan, "w1", point, ids());
}

describe("PHASE 0F — safe wall split entity remap", () => {
  it.each([
    ["door before", opening("d1", "door", { x: 1000, y: 0 }), "w1"],
    ["door after", opening("d1", "door", { x: 5000, y: 0 }), "w-target"],
    ["window before", opening("o1", "window", { x: 1000, y: 0 }), "w1"],
    ["window after", opening("o1", "window", { x: 5000, y: 0 }), "w-target"],
  ])("remaps %s", (_name, item, expectedWallId) => {
    const result = split(planFor(undefined, undefined, [item]));
    expect(result.ok).toBe(true);
    expect(result.plan.items[0]).toMatchObject({ id: item.id, kind: item.kind, wallId: expectedWallId, owner: "keep" });
    expect(result.plan.items[0].wallSeg).toEqual(expectedWallId === "w1"
      ? { a: { x: 0, y: 0 }, b: { x: 3000, y: 0 } }
      : { a: { x: 3000, y: 0 }, b: { x: 6000, y: 0 } });
  });

  it("remaps several openings independently", () => {
    const result = split(planFor(undefined, undefined, [
      opening("d1", "door", { x: 1000, y: 0 }),
      opening("d2", "door", { x: 4800, y: 0 }),
      opening("o1", "window", { x: 5400, y: 0 }, { metadata: { preserved: true } }),
    ]));
    expect(result.plan.items.map((x) => x.wallId)).toEqual(["w1", "w-target", "w-target"]);
    expect(result.plan.items[2].metadata).toEqual({ preserved: true });
    expect(result.entityRemap.openings).toHaveLength(3);
  });

  it.each([
    ["vertical", { x: 0, y: 0 }, { x: 0, y: 6000 }, { x: 0, y: 5000 }, { x: 0, y: 3000 }, { a: { x: 0, y: 3000 }, b: { x: 0, y: 6000 } }],
    ["diagonal", { x: 0, y: 0 }, { x: 6000, y: 6000 }, { x: 5000, y: 5000 }, { x: 3000, y: 3000 }, { a: { x: 3000, y: 3000 }, b: { x: 6000, y: 6000 } }],
    ["reversed", { x: 6000, y: 0 }, { x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 3000, y: 0 }, { a: { x: 3000, y: 0 }, b: { x: 0, y: 0 } }],
  ])("supports %s walls", (_name, a, b, center, point, expectedSeg) => {
    const result = split(planFor(a, b, [opening("d1", "door", center)]), point);
    expect(result.ok).toBe(true);
    expect(result.splitT).toBeCloseTo(0.5);

    const item = result.plan.items[0];
    expect(item.wallId).toBe("w-target");
    expect(item.wallSeg.a).toEqual(expectedSeg.a);
    expect(item.wallSeg.b).toEqual(expectedSeg.b);

    // wallSeg должен совпадать с реальными узлами дочерней стены.
    const child = result.plan.walls.find((w) => w.id === "w-target");
    expect(child).toBeTruthy();
    expect(result.plan.nodes[child.a]).toEqual(expectedSeg.a);
    expect(result.plan.nodes[child.b]).toEqual(expectedSeg.b);

    // Никаких opening-диагностик целостности после split.
    const openingDiagnostics = validatePlanIntegrity(result.plan).diagnostics
      .filter((d) => d.entityType === "opening");
    expect(openingDiagnostics).toEqual([]);
  });

  it("rejects a split intersecting an opening without changing plan or consuming IDs", () => {
    const plan = planFor(undefined, undefined, [opening("d1", "door", { x: 3000, y: 0 }, { w: 900 })]);
    let calls = 0;
    const result = breakWallEdgeAt(plan, "w1", { x: 3000, y: 0 }, () => { calls += 1; return `id-${calls}`; });
    expect(result).toMatchObject({ ok: false, plan, error: { code: SPLIT_INTERSECTS_OPENING, entityId: "d1" } });
    expect(result.plan).toBe(plan);
    expect(calls).toBe(0);
  });

  it("replaces stale wallSeg but leaves an opening missing wallId untouched", () => {
    const stale = opening("d1", "door", { x: 5000, y: 0 }, { wallSeg: { a: { x: -1, y: 0 }, b: { x: 1, y: 0 } } });
    const missing = { ...opening("d2", "door", { x: 1000, y: 0 }), wallId: undefined };
    const result = split(planFor(undefined, undefined, [stale, missing]));
    expect(result.plan.items[0]).toMatchObject({ wallId: "w-target", wallSeg: { a: { x: 3000, y: 0 }, b: { x: 6000, y: 0 } } });
    expect(result.plan.items[1]).toBe(missing);
  });

  it("remaps dimensions before and after split", () => {
    const dimensions = [
      { id: "left", p1: { x: 600, y: 0 }, p2: { x: 1200, y: 0 }, attachedTo: { type: "wall", wallId: "w1", segIndex: 0, t0: 0.1, t1: 0.2 } },
      { id: "right", p1: { x: 4200, y: 0 }, p2: { x: 5400, y: 0 }, attachedTo: { type: "wall", id: "w1", segIndex: 0, t0: 0.7, t1: 0.9 } },
    ];
    const result = split(planFor(undefined, undefined, [], dimensions));
    expect(result.plan.dimensions[0].attachedTo).toMatchObject({ wallId: "w1", t0: 0.2, t1: 0.4 });
    expect(result.plan.dimensions[1].attachedTo).toMatchObject({ id: "w-target", wallId: "w-target" });
    expect(result.plan.dimensions[1].attachedTo.t0).toBeCloseTo(0.4);
    expect(result.plan.dimensions[1].attachedTo.t1).toBeCloseTo(0.8);
  });

  it("preserves a cross-split dimension as a free manual dimension", () => {
    const dim = { id: "cross", p1: { x: 1200, y: 0 }, p2: { x: 4800, y: 0 }, labelOverride: "keep", attachedTo: { type: "wall", wallId: "w1", t0: 0.2, t1: 0.8 } };
    const result = split(planFor(undefined, undefined, [], [dim]));
    expect(result.plan.dimensions[0]).toMatchObject({ id: "cross", p1: dim.p1, p2: dim.p2, labelOverride: "keep", attachedTo: null, kind: "manual", auto: false });
  });

  it("returns the explicit split/remap contract", () => {
    const result = split(planFor());
    expect(result).toMatchObject({ originalWallId: "w1", splitNodeId: "n-split", splitT: 0.5, childWallIds: ["w1", "w-target"], sourceRange: [0, 0.5], targetRange: [0.5, 1] });
    expect(result.entityRemap.walls).toEqual({ originalWallId: "w1", childWallIds: ["w1", "w-target"] });
  });

  it("is immutable and survives JSON round-trip", () => {
    const original = planFor(undefined, undefined, [opening("d1", "door", { x: 5000, y: 0 })]);
    const snapshot = JSON.stringify(original);
    const result = split(original);
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(result.plan).not.toBe(original);
    expect(JSON.parse(JSON.stringify(result.plan))).toEqual(result.plan);
  });

  it("undo restores the exact input and redo restores the exact split result", () => {
    const original = planFor(undefined, undefined, [opening("d1", "door", { x: 5000, y: 0 })]);
    const result = split(original);
    const history = new HistoryModel(original);
    history.setPlan(result.plan);
    expect(history.undo()).toBe(original);
    expect(history.redo()).toBe(result.plan);
  });

  it("introduces no dangling opening or dimension references", () => {
    const item = opening("d1", "door", { x: 5000, y: 0 });
    const dim = { id: "right", p1: { x: 4200, y: 0 }, p2: { x: 5400, y: 0 }, attachedTo: { type: "wall", wallId: "w1", t0: 0.7, t1: 0.9 } };
    const result = split(planFor(undefined, undefined, [item], [dim]));
    const diagnostics = validatePlanIntegrity(result.plan).diagnostics;
    expect(diagnostics.filter((d) => ["OPENING_WALL_NOT_FOUND", "OPENING_WALL_SEG_INVALID", "OPENING_REFERENCE_AMBIGUOUS", "DIMENSION_WALL_NOT_FOUND"].includes(d.code))).toEqual([]);
  });
});

describe("PHASE 0F — blocked split leaves history untouched", () => {
  // Доказывает: заблокированный split НЕ создаёт history-запись.
  // HistoryModel.mutate() всегда делает checkpoint, поэтому корректный контракт —
  // не вызывать mutate/setPlan при ok === false. Здесь воспроизводится ровно этот
  // паттерн вызова (как в PlanPage.handleCtxAction).
  it("adds no history entry, selection or plan change when a split is blocked", () => {
    const plan = planFor(undefined, undefined, [opening("d1", "door", { x: 3000, y: 0 }, { w: 900 })]);
    const history = new HistoryModel(plan);
    let selection = { coll: "walls", id: "w1" };

    // Паттерн вызова: сначала вычисляем результат, затем решаем, менять ли модель.
    const res = breakWallEdgeAt(history.current, "w1", { x: 3000, y: 0 }, ids());
    if (res.ok !== false) {
      history.setPlan(() => res.plan);
      selection = { coll: "walls", id: res.newWallId };
    }

    expect(res.ok).toBe(false);
    expect(history.current).toBe(plan);
    expect(history.canUndo).toBe(false);
    expect(history.past).toHaveLength(0);
    expect(selection).toEqual({ coll: "walls", id: "w1" });
  });

  it("successful split remains a single undoable history operation", () => {
    const plan = planFor(undefined, undefined, [opening("d1", "door", { x: 5000, y: 0 })]);
    const history = new HistoryModel(plan);
    const res = breakWallEdgeAt(history.current, "w1", { x: 3000, y: 0 }, ids());
    expect(res.ok).toBe(true);
    history.setPlan(() => res.plan);

    expect(history.past).toHaveLength(1);
    expect(history.canUndo).toBe(true);
    expect(history.undo()).toBe(plan);
    expect(history.canUndo).toBe(false);
  });
});

describe("PHASE 0F — invalid opening geometry blocks split", () => {
  function attempt(extra) {
    const plan = planFor(undefined, undefined, [opening("d1", "door", { x: 3000, y: 0 }, extra)]);
    let calls = 0;
    const result = breakWallEdgeAt(plan, "w1", { x: 3000, y: 0 }, () => { calls += 1; return `id-${calls}`; });
    return { plan, result, calls };
  }

  it.each([
    ["w = 0", { w: 0 }],
    ["w < 0", { w: -600 }],
    ["x = NaN", { x: NaN }],
    ["y = Infinity", { y: Infinity }],
    ["missing coordinates", { x: undefined, y: undefined }],
  ])("rejects split when opening geometry is invalid (%s)", (_name, extra) => {
    const { plan, result, calls } = attempt(extra);
    expect(result).toMatchObject({
      ok: false,
      error: { code: SPLIT_OPENING_GEOMETRY_INVALID, entityId: "d1", wallId: "w1" },
    });
    expect(typeof result.error.message).toBe("string");
    expect(result.plan).toBe(plan); // тот же объект, без клона
    expect(calls).toBe(0); // makeId не вызывался → узлы/стены не создавались
  });

  it("does not touch an opening without wallId or an opening of another wall", () => {
    const foreign = { ...opening("d2", "door", { x: 1000, y: 0 }), wallId: "other" };
    const noWall = { ...opening("d3", "door", { x: 2000, y: 0 }), wallId: undefined, w: 0 };
    const plan = planFor(undefined, undefined, [foreign, noWall]);
    const result = breakWallEdgeAt(plan, "w1", { x: 3000, y: 0 }, ids());
    // Проём с невалидной геометрией, но НЕ на этой стене, не блокирует и не трогается.
    expect(result.ok).toBe(true);
    expect(result.plan.items[0]).toBe(foreign);
    expect(result.plan.items[1]).toBe(noWall);
  });
});

describe("PHASE 0F — split warning contract", () => {
  it("always returns a warnings array on a successful split", () => {
    const result = split(planFor());
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("returns a top-level warning when a manual dimension detaches across the split", () => {
    const dim = { id: "cross", p1: { x: 1200, y: 0 }, p2: { x: 4800, y: 0 }, offset: 150, style: { color: "red" }, metadata: { note: "keep" }, labelOverride: "L", attachedTo: { type: "wall", wallId: "w1", t0: 0.2, t1: 0.8 } };
    const result = split(planFor(undefined, undefined, [], [dim]));

    expect(result.warnings).toEqual([
      { code: "DIMENSION_DETACHED_AFTER_WALL_SPLIT", entityId: "cross", wallId: "w1" },
    ]);
    // Warning не записывается внутрь plan.
    expect(JSON.stringify(result.plan)).not.toContain("DIMENSION_DETACHED_AFTER_WALL_SPLIT");

    const out = result.plan.dimensions[0];
    expect(out).toMatchObject({ id: "cross", attachedTo: null, kind: "manual", auto: false });
    // p1/p2/label/offset/style/metadata сохраняются.
    expect(out.p1).toEqual(dim.p1);
    expect(out.p2).toEqual(dim.p2);
    expect(out.labelOverride).toBe("L");
    expect(out.offset).toBe(150);
    expect(out.style).toEqual({ color: "red" });
    expect(out.metadata).toEqual({ note: "keep" });
  });

  it("preserves p1/p2 and detaches malformed manual dimensions without deleting them", () => {
    const missingT0 = { id: "mA", p1: { x: 600, y: 0 }, p2: { x: 5400, y: 0 }, attachedTo: { type: "wall", wallId: "w1", t1: 0.9 } };
    const nonFiniteT1 = { id: "mB", p1: { x: 900, y: 0 }, p2: { x: 5100, y: 0 }, attachedTo: { type: "wall", wallId: "w1", t0: 0.1, t1: Infinity } };
    const result = split(planFor(undefined, undefined, [], [missingT0, nonFiniteT1]));

    // Оба размера сохранены (не удалены).
    expect(result.plan.dimensions.map((d) => d.id)).toEqual(["mA", "mB"]);
    for (const out of result.plan.dimensions) {
      expect(out.attachedTo).toBeNull(); // dangling attachment не остаётся
      expect(Number.isFinite(out.p1.x)).toBe(true);
      expect(Number.isFinite(out.p2.x)).toBe(true);
    }
    expect(result.plan.dimensions[0].p1).toEqual(missingT0.p1);
    expect(result.plan.dimensions[0].p2).toEqual(missingT0.p2);
    expect(result.plan.dimensions[1].p1).toEqual(nonFiniteT1.p1);
    expect(result.plan.dimensions[1].p2).toEqual(nonFiniteT1.p2);

    // Warning возвращается при detach (оба пересекают split).
    expect(result.warnings.map((w) => w.entityId).sort()).toEqual(["mA", "mB"]);

    // Никаких dangling dimension-диагностик.
    const dangling = validatePlanIntegrity(result.plan).diagnostics
      .filter((d) => d.code === "DIMENSION_WALL_NOT_FOUND");
    expect(dangling).toEqual([]);
  });
});

describe("PHASE 0F — auto/derived dimensions survive split", () => {
  it("does not convert an auto dimension crossing the split into a persisted manual one", () => {
    const auto = { id: "auto", kind: "auto", auto: true, p1: { x: 1200, y: 0 }, p2: { x: 4800, y: 0 }, attachedTo: { type: "wall", wallId: "w1", t0: 0.2, t1: 0.8 } };
    const result = split(planFor(undefined, undefined, [], [auto]));
    const out = result.plan.dimensions[0];
    expect(out.auto).toBe(true);
    expect(out.kind).toBe("auto");
    expect(out.attachedTo).not.toBeNull(); // осталось на месте для регенерации
    expect(result.warnings).toEqual([]); // detach warning не выдаётся для auto
  });

  it("keeps a stable dimension count (regeneration produces no duplicates)", () => {
    const dims = [
      { id: "a1", kind: "auto", auto: true, attachedTo: { type: "wall", wallId: "w1", t0: 0.1, t1: 0.2 } },
      { id: "a2", kind: "auto", auto: true, attachedTo: { type: "wall", wallId: "w1", t0: 0.2, t1: 0.8 } },
      { id: "m1", p1: { x: 4200, y: 0 }, p2: { x: 5400, y: 0 }, attachedTo: { type: "wall", wallId: "w1", t0: 0.7, t1: 0.9 } },
    ];
    const result = split(planFor(undefined, undefined, [], dims));
    const outIds = result.plan.dimensions.map((d) => d.id);
    expect(outIds).toEqual(["a1", "a2", "m1"]);
    expect(new Set(outIds).size).toBe(outIds.length);
  });
});

describe("PHASE 0F — world-space boundary tolerance", () => {
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const len = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

  // Стена a→b с одним проёмом центра tc и ширины w (мм вдоль стены).
  function planWithOpening(a, b, tc, w, h = 100) {
    const center = lerp(a, b, tc);
    const item = { id: "d1", kind: "door", x: center.x - w / 2, y: center.y - h / 2, w, h, wallId: "w1", owner: "keep" };
    return planFor(a, b, [item]);
  }

  // Точка на стене на смещении offMm внутрь от правой границы проёма (к центру).
  function splitPoint(a, b, tc, w, offMm) {
    const L = len(a, b);
    const t = (tc * L + w / 2 - offMm) / L;
    return lerp(a, b, t);
  }

  const geometries = [
    ["length 1000 mm", { x: 0, y: 0 }, { x: 1000, y: 0 }],
    ["length 6000 mm", { x: 0, y: 0 }, { x: 6000, y: 0 }],
    ["reversed", { x: 6000, y: 0 }, { x: 0, y: 0 }],
    ["diagonal", { x: 0, y: 0 }, { x: 4243, y: 4243 }], // ≈ 6000 мм длины
  ];

  const tc = 0.5;
  const w = 200;

  it("uses the documented millimetre tolerance constant", () => {
    expect(WALL_SPLIT_BOUNDARY_TOLERANCE_MM).toBeGreaterThan(0);
  });

  describe.each(geometries)("wall %s", (_name, a, b) => {
    it("allows a split exactly on the opening boundary", () => {
      const plan = planWithOpening(a, b, tc, w);
      const result = breakWallEdgeAt(plan, "w1", splitPoint(a, b, tc, w, 0), ids());
      expect(result.ok).toBe(true);
    });

    it.each([0.25, 0.5, 1])("allows a split %s mm inside the boundary (within tolerance)", (offMm) => {
      const plan = planWithOpening(a, b, tc, w);
      const result = breakWallEdgeAt(plan, "w1", splitPoint(a, b, tc, w, offMm), ids());
      expect(result.ok).toBe(true);
    });

    it("blocks a split deep inside the opening (beyond tolerance)", () => {
      const plan = planWithOpening(a, b, tc, w);
      const result = breakWallEdgeAt(plan, "w1", splitPoint(a, b, tc, w, w / 2), ids());
      expect(result).toMatchObject({ ok: false, error: { code: SPLIT_INTERSECTS_OPENING } });
    });
  });

  it("gives the same result for identical millimetre offsets on walls of different length", () => {
    const short = [{ x: 0, y: 0 }, { x: 1000, y: 0 }];
    const long = [{ x: 0, y: 0 }, { x: 6000, y: 0 }];
    for (const offMm of [0.25, 0.5, 1, w / 2]) {
      const rShort = breakWallEdgeAt(planWithOpening(short[0], short[1], tc, w), "w1", splitPoint(short[0], short[1], tc, w, offMm), ids());
      const rLong = breakWallEdgeAt(planWithOpening(long[0], long[1], tc, w), "w1", splitPoint(long[0], long[1], tc, w, offMm), ids());
      expect(rShort.ok).toBe(rLong.ok);
    }
  });
});

describe("PHASE 0F — split performance budget", () => {
  function bigPlan() {
    const nodes = { na: { x: 0, y: 0 }, nb: { x: 6000, y: 0 } };
    const walls = [{ id: "w1", a: "na", b: "nb", thk: 150, material: "brick" }];
    // 299 несвязанных стен-заглушек (в стороне от целевой).
    for (let i = 0; i < 299; i++) {
      const a = `f${i}a`;
      const b = `f${i}b`;
      nodes[a] = { x: 10000, y: i * 300 };
      nodes[b] = { x: 10600, y: i * 300 };
      walls.push({ id: `f${i}`, a, b, thk: 100 });
    }
    // 100 проёмов на целевой стене, слева от точки разрыва (не пересекают split).
    const items = [];
    for (let i = 0; i < 100; i++) {
      const cx = 100 + i * 15; // 100..1585, все < 2900
      items.push({ id: `op${i}`, kind: i % 2 ? "window" : "door", x: cx - 50, y: -50, w: 100, h: 100, wallId: "w1" });
    }
    // 100 размеров, привязанных к целевой стене слева (реаттач без detach).
    const dimensions = [];
    for (let i = 0; i < 100; i++) {
      const t0 = 0.01 + i * 0.001;
      dimensions.push({ id: `dm${i}`, kind: "auto", auto: true, attachedTo: { type: "wall", wallId: "w1", t0, t1: t0 + 0.002 } });
    }
    return { nodes, walls, items, dimensions };
  }

  it("splits a 300-wall / 100-opening / 100-dimension plan within 500 ms", () => {
    const plan = bigPlan();
    const t0 = performance.now();
    const result = breakWallEdgeAt(plan, "w1", { x: 3000, y: 0 }, ids());
    const dt = performance.now() - t0;
    expect(result.ok).toBe(true);
    expect(result.plan.items).toHaveLength(100);
    expect(result.plan.dimensions).toHaveLength(100);
    expect(dt).toBeLessThan(500);
  });
});
