/**
 * PHASE 0G (+ corrective pass) — room detection: успех / честное «нет комнат» /
 * сбой движка должны быть различимы, а сбой — не терять существующие
 * rooms/zones/metadata, не мутировать plan и не создавать лишних history
 * checkpoint. Проверяет контракт syncRoomsSafe (core/rooms/syncRooms.js),
 * normalizePlanResult (planNormalize.js) и паттерн PlanPage.jsx
 * (computeAutoZonesSync/syncAutoZones/runAutoZonesSync/runPlanCheck) —
 * воспроизведён локально, компонент не рендерится (окружение тестов "node").
 *
 * PHASE 0G corrective — import-order stability:
 * src/planner/wallGeometry.js делает `export * from "./core/walls/index.js"`
 * (строка 2) — часть уже задокументированного 15-файлового цикла зависимостей
 * planner (см. node scripts/plannerDepGraph.mjs, «Крупнейший цикл»). Это
 * ПРЕДСУЩЕСТВУЮЩИЙ цикл в production-графе — не исправляется в этой фазе (см.
 * PHASE 0G corrective report, «Known risk for PHASE 1A»).
 *
 * Эмпирически проверено (PHASE 0G corrective): при статическом import ИЛИ
 * при простом переупорядочивании последовательных dynamic import()
 * planHasDrawnWalls внутри planNormalize.js мог временно резолвиться в
 * undefined, если core/rooms/index.js достигал цикла раньше wallGeometry.js
 * по ДРУГОМУ транзитивному пути (core/rooms/detectRooms.js → ../walls/wallOps.js
 * напрямую, минуя wallGeometry.js). Простое «await import(planNormalize)
 * раньше» НЕ является надёжным фиксом — тот же баг воспроизводится и при
 * последовательных dynamic import(), если поменять порядок местами (проверено
 * прогоном с обратным порядком до и после фикса ниже).
 *
 * Надёжный фикс: явно и ПЕРВЫМ прогреть (await import) именно
 * wallGeometry.js — тот модуль, откуда planNormalize.js берёт
 * planHasDrawnWalls. Это заставляет его export* полностью материализоваться
 * ДО того, как любой другой путь (core/rooms/*) войдёт в тот же цикл через
 * wallOps.js напрямую. Проверено: результат остаётся зелёным (41/41)
 * независимо от того, в каком порядке импортируются planNormalize.js и
 * core/rooms/index.js ПОСЛЕ этого прогрева.
 */
import { describe, it, expect, beforeAll } from "vitest";

let normalizePlan;
let normalizePlanResult;
let syncRooms;
let syncRoomsSafe;
let ROOM_DETECTION_FAILED;
let resolvePlanWalls;
let HistoryModel;
let mergeDiagnosticsResult;
let filterDiagnostics;
let groupBySeverity;
let isDiagnosticsStale;
let entityTypeLabel;
let getDiagnosticFocusTarget;
let validatePlanIntegrity;

beforeAll(async () => {
  // Прогрев фрагильного export* ПЕРВЫМ — см. комментарий в шапке файла.
  await import("../src/planner/wallGeometry.js");

  const planNormalizeMod = await import("../src/planner/planNormalize.js");
  normalizePlan = planNormalizeMod.normalizePlan;
  normalizePlanResult = planNormalizeMod.normalizePlanResult;

  const roomsMod = await import("../src/planner/core/rooms/index.js");
  syncRooms = roomsMod.syncRooms;
  syncRoomsSafe = roomsMod.syncRoomsSafe;
  ROOM_DETECTION_FAILED = roomsMod.ROOM_DETECTION_FAILED;

  const wallNetworkMod = await import("../src/planner/wallNetwork.js");
  resolvePlanWalls = wallNetworkMod.resolvePlanWalls;

  const historyMod = await import("../src/planner/core/history/historyModel.js");
  HistoryModel = historyMod.HistoryModel;

  const presentationMod = await import("../src/planner/ui/diagnostics/diagnosticPresentation.js");
  mergeDiagnosticsResult = presentationMod.mergeDiagnosticsResult;
  filterDiagnostics = presentationMod.filterDiagnostics;
  groupBySeverity = presentationMod.groupBySeverity;
  isDiagnosticsStale = presentationMod.isDiagnosticsStale;
  entityTypeLabel = presentationMod.entityTypeLabel;

  const focusMod = await import("../src/planner/ui/diagnostics/diagnosticFocus.js");
  getDiagnosticFocusTarget = focusMod.getDiagnosticFocusTarget;

  const validationMod = await import("../src/planner/core/validation/validatePlanIntegrity.js");
  validatePlanIntegrity = validationMod.validatePlanIntegrity;
});

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

/**
 * Воспроизводит src/pages/admin/PlanPage.jsx (PHASE 0G corrective):
 *   computeAutoZonesSync — чистая функция { ok, plan, diagnostics }, без setState;
 *   syncAutoZones        — обёртка для bundled-edit callers (используется ВНУТРИ
 *                          setPlan updater вместе с реальной правкой геометрии);
 *   runAutoZonesSync      — для pure room-only sync (useEffect / кнопка
 *                          «Синхронизировать зоны»): сам решает, вызывать ли
 *                          history.setPlan — НЕ вызывает его при ok:false и НЕ
 *                          вызывает при ok:true без фактического изменения
 *                          rooms/zones.
 * Принимает реальный HistoryModel вместо React state.
 */
function createPlanPageRoomSyncHarness(history) {
  let diagnostic = null;

  const computeAutoZonesSync = (p, syncFn) => {
    const synced = syncRoomsSafe({ ...p, walls: resolvePlanWalls(p) }, syncFn);
    if (!synced.ok) return { ok: false, plan: p, diagnostics: synced.diagnostics };
    const dimWarnings = (p.validationWarnings || []).filter((w) => w.source === "dimensions");
    return {
      ok: true,
      diagnostics: [],
      plan: {
        ...p,
        rooms: synced.rooms,
        zones: synced.zones,
        validationWarnings: [...dimWarnings, ...(synced.validationWarnings || [])],
      },
    };
  };

  const syncAutoZones = (p, syncFn) => {
    const result = computeAutoZonesSync(p, syncFn);
    if (!result.ok) {
      diagnostic = result.diagnostics[0];
      return p;
    }
    if (diagnostic) diagnostic = null;
    return result.plan;
  };

  const runAutoZonesSync = (syncFn) => {
    const result = computeAutoZonesSync(history.current, syncFn);
    if (!result.ok) {
      diagnostic = result.diagnostics[0];
      return;
    }
    if (diagnostic) diagnostic = null;
    const changed = JSON.stringify(result.plan.rooms) !== JSON.stringify(history.current.rooms)
      || JSON.stringify(result.plan.zones) !== JSON.stringify(history.current.zones);
    if (!changed) return;
    history.setPlan(() => result.plan);
  };

  return { computeAutoZonesSync, syncAutoZones, runAutoZonesSync, getDiagnostic: () => diagnostic };
}

describe("PHASE 0G — syncAutoZones pattern (PlanPage integration)", () => {
  it("success updates rooms/zones as before", () => {
    const history = new HistoryModel(closedRectPlan());
    const { syncAutoZones } = createPlanPageRoomSyncHarness(history);
    const next = syncAutoZones(history.current);
    expect(next.rooms).toHaveLength(1);
    expect(next.zones).toHaveLength(1);
  });

  it("failure returns the original plan object unchanged", () => {
    const history = new HistoryModel(closedRectPlan());
    const { syncAutoZones } = createPlanPageRoomSyncHarness(history);
    const plan = history.current;
    const next = syncAutoZones(plan, throwingSyncFn);
    expect(next).toBe(plan);
  });

  it("failure does not clear existing rooms/zones", () => {
    const plan = closedRectPlan();
    plan.rooms = [{ id: "r1", type: "room", name: "Сушка" }];
    plan.zones = [{ id: "r1", auto: true }];
    const history = new HistoryModel(plan);
    const { syncAutoZones } = createPlanPageRoomSyncHarness(history);
    const next = syncAutoZones(plan, throwingSyncFn);
    expect(next.rooms).toEqual(plan.rooms);
    expect(next.zones).toEqual(plan.zones);
  });

  it("failure inside a bundled edit checkpoints only the enclosing edit, not room sync", () => {
    const plan = closedRectPlan();
    const history = new HistoryModel(plan);
    const { syncAutoZones } = createPlanPageRoomSyncHarness(history);
    // Тот же паттерн, что и wall-edit handlers в PlanPage: setPlan(p => { ...edit...; return syncAutoZones(edited); }).
    history.setPlan((p) => syncAutoZones(p, throwingSyncFn));
    expect(history.past).toHaveLength(1); // ровно один checkpoint enclosing-операции
    expect(history.current).toBe(plan); // содержимое не изменилось (return p)
  });

  it("a following successful detection clears the session diagnostic", () => {
    const history = new HistoryModel(closedRectPlan());
    const { syncAutoZones, getDiagnostic } = createPlanPageRoomSyncHarness(history);
    const plan = history.current;
    syncAutoZones(plan, throwingSyncFn);
    expect(getDiagnostic()).toMatchObject({ code: ROOM_DETECTION_FAILED });

    syncAutoZones(plan); // повторный расчёт без инъекции — успешен
    expect(getDiagnostic()).toBeNull();
  });
});

// ── PHASE 0G corrective #1 — history on the PURE room-only sync pattern ──
// (useEffect autosync / кнопка «Синхронизировать зоны» — вызывают room sync
// БЕЗ бандла с другой правкой геометрии; здесь rejected/no-op sync ранее мог
// создать пустой history checkpoint через HistoryModel.mutate.)

describe("PHASE 0G corrective — history on pure room-only sync (runAutoZonesSync)", () => {
  it("room engine failure: no checkpoint, canUndo unchanged, same plan reference, diagnostic set", () => {
    const plan = closedRectPlan();
    const history = new HistoryModel(plan);
    const harness = createPlanPageRoomSyncHarness(history);

    harness.runAutoZonesSync(throwingSyncFn);

    expect(history.past).toHaveLength(0);
    expect(history.canUndo).toBe(false);
    expect(history.current).toBe(plan);
    expect(harness.getDiagnostic()).toMatchObject({ code: ROOM_DETECTION_FAILED });
  });

  it("successful room sync: exactly one history entry, undo restores the original plan", () => {
    const plan = closedRectPlan(); // изначально rooms:[] — sync реально меняет план
    const history = new HistoryModel(plan);
    const harness = createPlanPageRoomSyncHarness(history);

    harness.runAutoZonesSync();

    expect(history.past).toHaveLength(1);
    expect(history.canUndo).toBe(true);
    expect(history.current).not.toBe(plan);
    expect(history.current.rooms).toHaveLength(1);
    expect(history.undo()).toBe(plan);
  });

  it("successful sync without actual changes does not create an empty checkpoint", () => {
    const plan = closedRectPlan();
    const history = new HistoryModel(plan);
    const harness = createPlanPageRoomSyncHarness(history);

    harness.runAutoZonesSync(); // первый sync -> реальное изменение (комната появляется)
    expect(history.past).toHaveLength(1);

    harness.runAutoZonesSync(); // повторный sync той же геометрии -> без изменений
    expect(history.past).toHaveLength(1); // НЕ 2 — пустой checkpoint не создан
    expect(history.canUndo).toBe(true);
  });

  it("failure after a successful sync leaves the already-committed plan and history intact", () => {
    const plan = closedRectPlan();
    const history = new HistoryModel(plan);
    const harness = createPlanPageRoomSyncHarness(history);

    harness.runAutoZonesSync(); // успех -> 1 checkpoint, rooms заполнены
    const afterSuccess = history.current;
    expect(history.past).toHaveLength(1);

    harness.runAutoZonesSync(throwingSyncFn); // сбой -> НЕ должен ничего испортить

    expect(history.past).toHaveLength(1); // без нового checkpoint
    expect(history.current).toBe(afterSuccess); // committed-план не тронут
    expect(harness.getDiagnostic()).toMatchObject({ code: ROOM_DETECTION_FAILED });
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

// ── PHASE 0G corrective #2 — normalizePlanResult (result-aware load) ─────

describe("PHASE 0G corrective — normalizePlanResult result-aware contract", () => {
  it("controlled failure during normalize: existing rooms preserved, diagnostics returned to caller (not into plan)", () => {
    const polygon = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }];
    const raw = {
      ...closedRectPlan(),
      rooms: [{ id: "r1", type: "room", name: "Существующая комната", polygon }],
      zones: [{ id: "r1", auto: true, polygon }],
    };
    const { plan, diagnostics } = normalizePlanResult(raw, { roomSyncFn: throwingSyncFn });
    expect(plan.rooms).toHaveLength(1);
    expect(plan.rooms[0].name).toBe("Существующая комната");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: ROOM_DETECTION_FAILED, severity: "error" });
    expect(plan).not.toHaveProperty("diagnostics");
  });

  it("normalizePlan() compatibility wrapper returns only plan", () => {
    const plan = normalizePlan(closedRectPlan(), { roomSyncFn: throwingSyncFn });
    expect(plan).not.toHaveProperty("diagnostics");
    expect(plan.rooms).toEqual([]); // closedRectPlan имеет пустые исходные rooms/zones
  });

  it("production-like load path: diagnostic reaches session-only UI state, not the serialized plan", () => {
    // Воспроизводит src/pages/admin/PlanPage.jsx (эффект загрузки project/draft):
    //   const { plan: normalized, diagnostics } = normalizePlanResult(raw);
    //   resetHistory(normalized);
    //   setRoomDetectionDiagnostic(diagnostics[0] || null);
    let sessionDiagnostic = null;
    const history = new HistoryModel(null);
    const raw = closedRectPlan();

    const load = (rawPlan, syncFn) => {
      const { plan: normalized, diagnostics } = normalizePlanResult(rawPlan, syncFn ? { roomSyncFn: syncFn } : {});
      history.reset(normalized);
      sessionDiagnostic = diagnostics[0] || null;
    };

    load(raw, throwingSyncFn);
    expect(sessionDiagnostic).toMatchObject({ code: ROOM_DETECTION_FAILED });
    expect(JSON.stringify(history.current)).not.toContain("ROOM_DETECTION_FAILED");
  });

  it("honest empty room detection during load produces no diagnostic and no error", () => {
    const { plan, diagnostics } = normalizePlanResult(noWallsPlan());
    expect(plan.rooms).toEqual([]);
    expect(diagnostics).toEqual([]);
  });

  it("recovery: a following successful load-time sync clears the diagnostic", () => {
    let sessionDiagnostic = null;
    const raw = closedRectPlan();

    const load = (syncFn) => {
      const { diagnostics } = normalizePlanResult(raw, syncFn ? { roomSyncFn: syncFn } : {});
      sessionDiagnostic = diagnostics[0] || null;
    };

    load(throwingSyncFn);
    expect(sessionDiagnostic).toMatchObject({ code: ROOM_DETECTION_FAILED });

    load(); // повторная загрузка без инъекции — успех
    expect(sessionDiagnostic).toBeNull();
  });
});

// ── PHASE 0G corrective #3 — runPlanCheck behavior ────────────────────────

describe("PHASE 0G corrective — runPlanCheck sees but never clears the room diagnostic", () => {
  it("re-runs only validatePlanIntegrity, merges load-time diagnostic, never clears it itself", () => {
    // Воспроизводит src/pages/admin/PlanPage.jsx runPlanCheck:
    //   const result = validatePlanIntegrity(plan);
    //   const merged = mergeDiagnosticsResult(result, roomDetectionDiagnostic ? [roomDetectionDiagnostic] : []);
    let roomDetectionDiagnostic = null;
    const plan = closedRectPlan();

    const runPlanCheck = (currentPlan) => {
      const result = validatePlanIntegrity(currentPlan);
      return mergeDiagnosticsResult(result, roomDetectionDiagnostic ? [roomDetectionDiagnostic] : []);
    };

    // 1. Load-time failure устанавливает diagnostic — ВНЕ runPlanCheck.
    roomDetectionDiagnostic = syncRoomsSafe(plan, throwingSyncFn).diagnostics[0];

    // 2. runPlanCheck видит diagnostic, не запуская room detection повторно
    //    (использует только validatePlanIntegrity).
    const first = runPlanCheck(plan);
    expect(first.diagnostics.some((d) => d.code === ROOM_DETECTION_FAILED)).toBe(true);

    // 3. Повторный вызов runPlanCheck НЕ затирает и не очищает diagnostic сам по себе.
    const second = runPlanCheck(plan);
    expect(second.diagnostics.some((d) => d.code === ROOM_DETECTION_FAILED)).toBe(true);
    expect(roomDetectionDiagnostic).not.toBeNull();

    // 4. Только реальный успешный room sync (не runPlanCheck) очищает diagnostic.
    const synced = syncRoomsSafe(plan);
    roomDetectionDiagnostic = synced.ok ? null : synced.diagnostics[0];
    expect(roomDetectionDiagnostic).toBeNull();

    const third = runPlanCheck(plan);
    expect(third.diagnostics.some((d) => d.code === ROOM_DETECTION_FAILED)).toBe(false);
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
