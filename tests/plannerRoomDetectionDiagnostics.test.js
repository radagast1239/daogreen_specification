/**
 * PHASE 0G — room detection: успех / честное «нет комнат» / сбой движка должны
 * быть различимы, а сбой — не терять существующие rooms/zones/metadata и не
 * мутировать plan. Проверяет контракт syncRoomsSafe (core/rooms/syncRooms.js),
 * его использование в normalizePlan и в паттерне PlanPage.syncAutoZones
 * (воспроизведён локально — компонент не рендерится, окружение тестов "node").
 */
import { describe, it, expect } from "vitest";
import { normalizePlan } from "../src/planner/planNormalize.js";
import {
  syncRooms,
  syncRoomsSafe,
  ROOM_DETECTION_FAILED,
} from "../src/planner/core/rooms/index.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { HistoryModel } from "../src/planner/core/history/historyModel.js";
import {
  mergeDiagnosticsResult,
  filterDiagnostics,
  groupBySeverity,
  isDiagnosticsStale,
  entityTypeLabel,
} from "../src/planner/ui/diagnostics/diagnosticPresentation.js";
import { getDiagnosticFocusTarget } from "../src/planner/ui/diagnostics/diagnosticFocus.js";
import { validatePlanIntegrity } from "../src/planner/core/validation/validatePlanIntegrity.js";

// ── fixtures ─────────────────────────────────────────────────────────────

function closedRectPlan() {
  return {
    room: { w: 4000, h: 3000, wallThk: 100, defaultRoomHeightMm: 3000, height: 3000 },
    nodes: {},
    walls: [
      { id: "w1", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] },
      { id: "w2", thk: 100, pts: [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }] },
      { id: "w3", thk: 100, pts: [{ x: 4000, y: 3000 }, { x: 0, y: 3000 }] },
      { id: "w4", thk: 100, pts: [{ x: 0, y: 3000 }, { x: 0, y: 0 }] },
    ],
    items: [],
    rooms: [],
    zones: [],
    links: [],
  };
}

function twoRoomsPlan() {
  return {
    room: { w: 6000, h: 3000, wallThk: 100, defaultRoomHeightMm: 3000, height: 3000 },
    nodes: {},
    walls: [
      { id: "w1", thk: 100, pts: [{ x: 0, y: 0 }, { x: 6000, y: 0 }] },
      { id: "w2", thk: 100, pts: [{ x: 6000, y: 0 }, { x: 6000, y: 3000 }] },
      { id: "w3", thk: 100, pts: [{ x: 6000, y: 3000 }, { x: 0, y: 3000 }] },
      { id: "w4", thk: 100, pts: [{ x: 0, y: 3000 }, { x: 0, y: 0 }] },
      { id: "w5", thk: 100, pts: [{ x: 3000, y: 0 }, { x: 3000, y: 3000 }] },
    ],
    items: [],
    rooms: [],
    zones: [],
    links: [],
  };
}

function openContourPlan() {
  return {
    room: { w: 4000, h: 3000, wallThk: 100 },
    nodes: {},
    walls: [
      { id: "w1", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] },
      { id: "w2", thk: 100, pts: [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }] },
      { id: "w3", thk: 100, pts: [{ x: 4000, y: 3000 }, { x: 1000, y: 3000 }] },
    ],
    items: [],
    rooms: [],
    zones: [],
    links: [],
  };
}

function noWallsPlan() {
  return { room: { w: 4000, h: 3000 }, nodes: {}, walls: [], items: [], rooms: [], zones: [], links: [] };
}

const throwingSyncFn = () => { throw new Error("controlled room-engine failure"); };

// ── 8.1 успешный detection ──────────────────────────────────────────────

describe("PHASE 0G — successful room detection", () => {
  it("closed rectangle → one room found", () => {
    const result = syncRoomsSafe(closedRectPlan());
    expect(result.ok).toBe(true);
    expect(result.rooms).toHaveLength(1);
    expect(result.diagnostics).toEqual([]);
  });

  it("two rooms separated by a partition → two rooms", () => {
    const result = syncRoomsSafe(twoRoomsPlan());
    expect(result.ok).toBe(true);
    expect(result.rooms.length).toBeGreaterThanOrEqual(2);
    expect(result.diagnostics).toEqual([]);
  });

  it("open contour → honest empty result, ok:true, no diagnostics", () => {
    const result = syncRoomsSafe(openContourPlan());
    expect(result).toMatchObject({ ok: true, rooms: [], diagnostics: [] });
  });

  it("no walls → honest empty result, ok:true, no diagnostics", () => {
    const result = syncRoomsSafe(noWallsPlan());
    expect(result).toMatchObject({ ok: true, rooms: [], diagnostics: [] });
  });

  it("does not mutate the input plan", () => {
    const plan = closedRectPlan();
    const before = JSON.parse(JSON.stringify(plan));
    syncRoomsSafe(plan);
    expect(plan).toEqual(before);
  });

  it("is deterministic for the same plan", () => {
    const plan = closedRectPlan();
    const a = syncRoomsSafe(plan);
    const b = syncRoomsSafe(plan);
    expect(a.rooms).toEqual(b.rooms);
    expect(a.diagnostics).toEqual(b.diagnostics);
  });
});

// ── 8.2 ошибка engine (controlled failure via injection) ────────────────

describe("PHASE 0G — room detection engine failure", () => {
  it("reports a structured diagnostic instead of an empty result", () => {
    const plan = closedRectPlan();
    plan.rooms = [{ id: "existing", type: "room", name: "Тепличный блок", category: "production_main", heightMm: 3200 }];
    plan.zones = [{ id: "existing", auto: true }];
    const before = JSON.parse(JSON.stringify(plan));

    const result = syncRoomsSafe(plan, throwingSyncFn);

    expect(result.ok).toBe(false);
    expect(result.rooms).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: ROOM_DETECTION_FAILED,
      severity: "error",
      entityType: "plan",
    });
    expect(typeof result.diagnostics[0].message).toBe("string");
    expect(result.diagnostics[0].message.length).toBeGreaterThan(0);

    // plan (включая existing rooms/zones/metadata) не тронут вообще.
    expect(plan).toEqual(before);
  });

  it("does not leak the raw Error or its stack into the diagnostic", () => {
    const result = syncRoomsSafe(closedRectPlan(), throwingSyncFn);
    const json = JSON.stringify(result);
    expect(json).not.toContain("controlled room-engine failure");
    expect(json).not.toContain(".js:");
    expect(result.diagnostics[0]).not.toHaveProperty("stack");
    expect(result.diagnostics[0]).not.toHaveProperty("error");
    for (const v of Object.values(result.diagnostics[0])) {
      expect(v).not.toBeInstanceOf(Error);
    }
  });

  it("failure is not the same shape as a successful empty result", () => {
    const failure = syncRoomsSafe(closedRectPlan(), throwingSyncFn);
    const emptySuccess = syncRoomsSafe(noWallsPlan());
    expect(failure.ok).toBe(false);
    expect(emptySuccess.ok).toBe(true);
    expect(failure.rooms).toBeNull();
    expect(emptySuccess.rooms).toEqual([]);
    expect(failure.diagnostics).not.toEqual(emptySuccess.diagnostics);
  });
});

// ── 8.3 паттерн PlanPage.syncAutoZones (без рендера React) ──────────────

/** Воспроизводит логику src/pages/admin/PlanPage.jsx syncAutoZones + session diagnostic. */
function createSyncAutoZonesHarness() {
  let diagnostic = null;
  const syncAutoZones = (p, syncFn) => {
    const synced = syncRoomsSafe({ ...p, walls: resolvePlanWalls(p) }, syncFn);
    if (!synced.ok) {
      diagnostic = synced.diagnostics[0];
      return p;
    }
    if (diagnostic) diagnostic = null;
    const dimWarnings = (p.validationWarnings || []).filter((w) => w.source === "dimensions");
    return {
      ...p,
      rooms: synced.rooms,
      zones: synced.zones,
      validationWarnings: [...dimWarnings, ...(synced.validationWarnings || [])],
    };
  };
  return { syncAutoZones, getDiagnostic: () => diagnostic };
}

describe("PHASE 0G — syncAutoZones pattern (PlanPage integration)", () => {
  it("success updates rooms/zones as before", () => {
    const { syncAutoZones } = createSyncAutoZonesHarness();
    const next = syncAutoZones(closedRectPlan());
    expect(next.rooms).toHaveLength(1);
    expect(next.zones).toHaveLength(1);
  });

  it("failure returns the original plan object unchanged", () => {
    const { syncAutoZones } = createSyncAutoZonesHarness();
    const plan = closedRectPlan();
    const next = syncAutoZones(plan, throwingSyncFn);
    expect(next).toBe(plan);
  });

  it("failure does not clear existing rooms/zones", () => {
    const { syncAutoZones } = createSyncAutoZonesHarness();
    const plan = closedRectPlan();
    plan.rooms = [{ id: "r1", type: "room", name: "Сушка" }];
    plan.zones = [{ id: "r1", auto: true }];
    const next = syncAutoZones(plan, throwingSyncFn);
    expect(next.rooms).toEqual(plan.rooms);
    expect(next.zones).toEqual(plan.zones);
  });

  it("failure does not create a history checkpoint beyond the enclosing edit", () => {
    const plan = closedRectPlan();
    const history = new HistoryModel(plan);
    const { syncAutoZones } = createSyncAutoZonesHarness();
    // Тот же паттерн, что и useEffect/handlers в PlanPage: setPlan(p => syncAutoZones(p)).
    history.setPlan((p) => syncAutoZones(p, throwingSyncFn));
    expect(history.past).toHaveLength(1); // ровно один checkpoint enclosing-операции
    expect(history.current).toBe(plan); // содержимое не изменилось (return p)
  });

  it("a following successful detection clears the session diagnostic", () => {
    const { syncAutoZones, getDiagnostic } = createSyncAutoZonesHarness();
    const plan = closedRectPlan();
    syncAutoZones(plan, throwingSyncFn);
    expect(getDiagnostic()).toMatchObject({ code: ROOM_DETECTION_FAILED });

    syncAutoZones(plan); // повторный расчёт без инъекции — успешен
    expect(getDiagnostic()).toBeNull();
  });
});

// ── 8.4 normalize/load ───────────────────────────────────────────────────

describe("PHASE 0G — normalize/load", () => {
  it("normalizePlan does not erase existing rooms on a room-engine failure", () => {
    const polygon = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }];
    const raw = {
      ...closedRectPlan(),
      rooms: [{ id: "r1", type: "room", name: "Существующее помещение", category: "storage_clean", heightMm: 3100, polygon }],
      zones: [{ id: "r1", auto: true, name: "Существующее помещение", polygon }],
    };
    const plan = normalizePlan(raw, { roomSyncFn: throwingSyncFn });
    expect(plan.rooms.length).toBeGreaterThan(0);
    expect(plan.rooms[0].name).toBe("Существующее помещение");
    expect(plan.rooms[0].heightMm).toBe(3100);
  });

  it("plan with no drawn walls legitimately gets rooms:[] (not a failure code path)", () => {
    const plan = normalizePlan(noWallsPlan());
    expect(plan.rooms).toEqual([]);
    expect(plan.zones).toEqual([]);
  });

  it("normal successful load still works (room engine not injected)", () => {
    const plan = normalizePlan(closedRectPlan());
    expect(plan.rooms.length).toBeGreaterThan(0);
  });

  it("JSON round-trip does not persist any runtime diagnostics field", () => {
    const plan = normalizePlan(closedRectPlan(), { roomSyncFn: throwingSyncFn });
    const json = JSON.stringify(plan);
    expect(json).not.toContain("ROOM_DETECTION_FAILED");
    expect(json).not.toContain("diagnostics");
  });

  it("existing projects without any new field continue to load", () => {
    // Проект, сохранённый до PHASE 0G — нет rooms/zones вовсе.
    const legacyRaw = { room: { w: 4000, h: 3000 }, walls: closedRectPlan().walls };
    expect(() => normalizePlan(legacyRaw)).not.toThrow();
    const plan = normalizePlan(legacyRaw);
    expect(Array.isArray(plan.rooms)).toBe(true);
    expect(Array.isArray(plan.zones)).toBe(true);
  });

  it("plan JSON schema (top-level keys) is unchanged by normalizePlan", () => {
    const plan = normalizePlan(closedRectPlan());
    // Ничего из PHASE 0G (diagnostics/ok/roomSyncFn) не просочилось в сам plan.
    expect(plan).not.toHaveProperty("diagnostics");
    expect(plan).not.toHaveProperty("ok");
    expect(plan).not.toHaveProperty("roomSyncFn");
  });
});

// ── 8.5 diagnostics panel pipeline (pure functions, без React-рендера) ──

describe("PHASE 0G — diagnostics panel integration (pure pipeline)", () => {
  function roomFailureDiagnostic() {
    return syncRoomsSafe(closedRectPlan(), throwingSyncFn).diagnostics[0];
  }

  it("room diagnostic is displayed among structural diagnostics", () => {
    const plan = { nodes: {}, walls: [], items: [] }; // валиден для validatePlanIntegrity
    const structural = validatePlanIntegrity(plan);
    const merged = mergeDiagnosticsResult(structural, [roomFailureDiagnostic()]);
    expect(merged.diagnostics.some((d) => d.code === ROOM_DETECTION_FAILED)).toBe(true);
    expect(merged.summary.errors).toBeGreaterThanOrEqual(1);
    expect(merged.valid).toBe(false);
  });

  it("severity and label are correct", () => {
    const diag = roomFailureDiagnostic();
    expect(diag.severity).toBe("error");
    expect(entityTypeLabel(diag.entityType)).toBe("План");
  });

  it("source is present for filtering", () => {
    const diag = roomFailureDiagnostic();
    expect(diag.metadata.source).toBe("room-detection");
  });

  it("survives filter/group like any other diagnostic", () => {
    const merged = mergeDiagnosticsResult({ valid: true, summary: { errors: 0, warnings: 0, info: 0, total: 0 }, diagnostics: [] }, [roomFailureDiagnostic()]);
    const errorsOnly = filterDiagnostics(merged.diagnostics, { error: true, warning: false, info: false });
    expect(errorsOnly).toHaveLength(1);
    const groups = groupBySeverity(merged.diagnostics);
    expect(groups[0].severity).toBe("error");
  });

  it("stale mechanic works the same as for structural diagnostics", () => {
    const plan = closedRectPlan();
    const checkedRef = plan;
    const edited = { ...plan, walls: [...plan.walls] };
    expect(isDiagnosticsStale(checkedRef, plan)).toBe(false); // viewport/selection не трогает ref
    expect(isDiagnosticsStale(checkedRef, edited)).toBe(true); // plan изменился → stale
  });

  it("clears after a successful next detection (merge with no extra diagnostics)", () => {
    const structural = { valid: true, summary: { errors: 0, warnings: 0, info: 0, total: 0 }, diagnostics: [] };
    const merged = mergeDiagnosticsResult(structural, []); // диагностик больше нет
    expect(merged.diagnostics.some((d) => d.code === ROOM_DETECTION_FAILED)).toBe(false);
    expect(merged).toBe(structural); // без лишних diagnostics — тот же объект, без пересоздания
  });

  it("focus action on a diagnostic with no entityId does not throw", () => {
    const diag = roomFailureDiagnostic();
    const plan = closedRectPlan();
    expect(() => getDiagnosticFocusTarget(plan, diag)).not.toThrow();
    const focus = getDiagnosticFocusTarget(plan, diag);
    expect(focus.canFocus).toBe(false);
    expect(focus.selection).toBeNull();
  });
});

// ── 8.6 room metadata regression ─────────────────────────────────────────

describe("PHASE 0G — room metadata regression", () => {
  it("name/type/height survive a successful match after a small wall move", () => {
    const plan = closedRectPlan();
    const first = syncRooms(plan);
    const withMeta = {
      ...plan,
      rooms: [{ ...first.rooms[0], name: "Сушильная камера", category: "storage_clean", heightMm: 3400 }],
    };
    const moved = {
      ...withMeta,
      walls: [
        { id: "w1", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4050, y: 0 }] },
        { id: "w2", thk: 100, pts: [{ x: 4050, y: 0 }, { x: 4050, y: 3000 }] },
        { id: "w3", thk: 100, pts: [{ x: 4050, y: 3000 }, { x: 0, y: 3000 }] },
        { id: "w4", thk: 100, pts: [{ x: 0, y: 3000 }, { x: 0, y: 0 }] },
      ],
    };
    const second = syncRooms(moved);
    expect(second.rooms[0].name).toBe("Сушильная камера");
    expect(second.rooms[0].category).toBe("storage_clean");
    expect(second.rooms[0].heightMm).toBe(3400);
  });

  it("on failure, room metadata stays deep-equal (nothing recomputed)", () => {
    const plan = closedRectPlan();
    plan.rooms = [{ id: "r1", type: "room", name: "Тепличный блок", category: "production_main", heightMm: 3200, notes: "custom" }];
    const before = JSON.parse(JSON.stringify(plan.rooms));
    const result = syncRoomsSafe(plan, throwingSyncFn);
    expect(result.ok).toBe(false);
    expect(plan.rooms).toEqual(before);
  });

  it("two adjacent rooms keep their own metadata (no swap)", () => {
    const plan = twoRoomsPlan();
    const first = syncRooms(plan);
    expect(first.rooms.length).toBeGreaterThanOrEqual(2);
    const [roomA, roomB] = first.rooms;
    const withMeta = {
      ...plan,
      rooms: [
        { ...roomA, name: "Левое помещение" },
        { ...roomB, name: "Правое помещение" },
      ],
    };
    const second = syncRooms(withMeta);
    const byId = new Map(second.rooms.map((r) => [r.id, r]));
    expect(byId.get(roomA.id).name).toBe("Левое помещение");
    expect(byId.get(roomB.id).name).toBe("Правое помещение");
  });
});

// ── 8.7 performance ───────────────────────────────────────────────────────

describe("PHASE 0G — room detection performance", () => {
  it("detects rooms in a reasonable grid within the existing budget", () => {
    // 5x5 сетка комнат (24 внутренние стены + 4 внешние) — разумный практический размер,
    // без изменения алгоритма и без spatial index.
    const N = 5;
    const cell = 3000;
    const nodes = {};
    const walls = [];
    let wid = 0;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        nodes[`n_${i}_${j}`] = { x: i * cell, y: j * cell };
      }
    }
    for (let i = 0; i < N; i++) {
      for (let j = 0; j <= N; j++) {
        walls.push({ id: `h_${wid++}`, a: `n_${i}_${j}`, b: `n_${i + 1}_${j}`, thk: 100 });
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i <= N; i++) {
        walls.push({ id: `v_${wid++}`, a: `n_${i}_${j}`, b: `n_${i}_${j + 1}`, thk: 100 });
      }
    }
    const plan = { room: { w: N * cell, h: N * cell }, nodes, walls, items: [], rooms: [], zones: [] };

    const t0 = performance.now();
    const result = syncRoomsSafe(plan);
    const dt = performance.now() - t0;

    expect(result.ok).toBe(true);
    expect(result.rooms.length).toBeGreaterThan(0);
    expect(dt).toBeLessThan(5000); // тот же широкий бюджет, что и у существующего PHASE 0A perf-теста
    if (process.env.PLANNER_PERF_LOG) console.log(`[perf] room grid sync ${dt.toFixed(1)}ms`);
  });
});
