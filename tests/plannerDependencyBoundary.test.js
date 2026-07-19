/**
 * PHASE 0A — базовая линия границы зависимостей CAD Core.
 *
 * Будущее правило архитектуры:
 *   UI / adapters / legacy  →  CAD Core     (разрешено)
 *   CAD Core  →  React / UI / backend / legacy planner wrappers   (ЗАПРЕЩЕНО)
 *
 * Сейчас core уже нарушает правило. Этот тест НЕ разрывает существующие
 * зависимости — он их фиксирует в allowlist и запрещает появление НОВЫХ.
 *
 *   • тест ПРОХОДИТ при текущем списке нарушений;
 *   • тест ПАДАЕТ, если появится новый core → вне-core / core → react import;
 *   • удаление элемента из allowlist разрешено (уменьшение долга) и не роняет тест.
 *
 * Обновить baseline-цифры/allowlist:  node scripts/plannerDepGraph.mjs
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import {
  buildPlannerGraph,
  violationKey,
  findCycles,
} from "./helpers/plannerImportGraph.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const PLANNER_ROOT = join(REPO, "src", "planner");
const CORE_ROOT = join(PLANNER_ROOT, "core");

// Зафиксированные на момент PHASE 0A нарушения границы core -> вне-core.
// Формат ключа: "<core-файл> -> <файл-цель>" (пути относительно src/planner).
const CORE_OUT_ALLOWLIST = new Set([
  "core/dimensions/generateWallDimensions.js -> buildWallGeometry.js",
  "core/dimensions/generateWallDimensions.js -> doorTypes.js",
  "core/dimensions/generateWallDimensions.js -> rackProperties.js",
  "core/dimensions/generateWallDimensions.js -> wallNetwork.js",
  "core/dimensions/wallDimChains.js -> doorGeometry.js",
  "core/rooms/detectRooms.js -> doorTypes.js",
  "core/rooms/validateRooms.js -> doorTypes.js",
  "core/snap/snapEngine.js -> lineProperties.js",
  "core/snap/snapEngine.js -> plannerSnap.js",
  "core/snap/snapEngine.js -> snapContour.js",
  "core/snap/snapEngine.js -> wallNetwork.js",
  "core/walls/wallCommit.js -> wallNetwork.js",
  "core/walls/wallJoins.js -> wallJoins.js",
  "core/walls/wallOps.js -> doorTypes.js",
  "core/walls/wallOps.js -> wallParallelGeometry.js",
  "core/walls/wallRender.js -> wallParallelGeometry.js",
]);

describe("PHASE 0A — dependency boundary baseline", () => {
  const graph = buildPlannerGraph(PLANNER_ROOT, CORE_ROOT);

  it("новых нарушений границы core → вне-core нет (только из allowlist)", () => {
    const current = graph.coreOutViolations.map(violationKey);
    const unexpected = current.filter((k) => !CORE_OUT_ALLOWLIST.has(k));
    expect(unexpected, `Новые запрещённые импорты из CAD Core:\n${unexpected.join("\n")}`).toEqual([]);
  });

  it("CAD Core не импортирует react/react-dom", () => {
    expect(graph.coreReactViolations).toEqual([]);
  });

  it("baseline графа планировщика стабилен (диагностический ориентир)", () => {
    // Не строгий контракт: широкие границы, чтобы ловить резкие сдвиги графа.
    expect(graph.fileCount).toBeGreaterThan(100);
    expect(graph.edgeCount).toBeGreaterThan(300);
    // Текущий срез: 16 нарушений границы. Рост числа => регрессия долга.
    expect(graph.coreOutViolations.length).toBeLessThanOrEqual(CORE_OUT_ALLOWLIST.size);
  });
});

/**
 * PHASE 1A — статическая проверка границы command layer
 * (src/planner/commands/geometryCommands.js).
 *
 * Подтверждает:
 *   • geometry commands НЕ входят в существующий 15-файловый SCC
 *     (зависят от его членов — wallNetwork.js — но ничто из цикла не
 *     импортирует обратно этот модуль, поэтому новой SCC не образуется);
 *   • command layer не импортирует React/ReactDOM/PlanPage/window/document;
 *   • core → React остаётся 0 (переиспользует тот же graph, что и выше).
 *
 * Обратная сторона («PlanPage не импортирует низкоуровневые geometry
 * mutators напрямую для context-menu операций») — см. describe ниже,
 * «PHASE 1A-2A — PlanPage boundary», после миграции wall.split/straighten/
 * align/merge context-menu actions на command layer.
 */
describe("PHASE 1A — geometry command layer boundary", () => {
  const graph = buildPlannerGraph(PLANNER_ROOT, CORE_ROOT);
  const COMMAND_FILE = join(PLANNER_ROOT, "commands", "geometryCommands.js");
  const commandFileRel = "commands/geometryCommands.js";
  const commandSource = readFileSync(COMMAND_FILE, "utf8");

  it("не входит ни в один известный SCC/цикл планировщика", () => {
    const cycles = findCycles(graph.edges.map((e) => ({ from: e.from, to: e.to })), (x) => x);
    const memberOf = cycles.find((c) => c.includes(commandFileRel));
    expect(memberOf, `geometryCommands.js попал в цикл: ${JSON.stringify(memberOf)}`).toBeUndefined();
  });

  it("количество и состав циклов не изменилось (largest SCC — те же 15 файлов)", () => {
    const cycles = findCycles(graph.edges.map((e) => ({ from: e.from, to: e.to })), (x) => x);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toHaveLength(15);
    expect(cycles[0]).not.toContain(commandFileRel);
  });

  it("не импортирует React/ReactDOM", () => {
    expect(/from\s*["']react(-dom)?["']/.test(commandSource)).toBe(false);
    expect(/^\s*import\s*["']react/m.test(commandSource)).toBe(false);
  });

  it("не импортирует PlanPage и не ссылается на window/document (вне комментариев)", () => {
    const codeOnly = commandSource
      .replace(/\/\*[\s\S]*?\*\//g, "") // блочные комментарии (шапка файла ссылается на PlanPage.jsx в документации)
      .replace(/\/\/.*$/gm, ""); // строчные комментарии
    expect(codeOnly).not.toMatch(/from\s*["'][^"']*PlanPage/);
    expect(codeOnly).not.toMatch(/\bwindow\./);
    expect(codeOnly).not.toMatch(/\bdocument\./);
  });

  it("не импортирует broad barrel (core/rooms/index.js, wallGeometry.js напрямую)", () => {
    expect(commandSource).not.toMatch(/from\s*["'][^"']*core\/rooms\/index\.js["']/);
    expect(commandSource).not.toMatch(/from\s*["'][^"']*wallGeometry\.js["']/);
  });

  it("core → React остаётся 0 после добавления command layer", () => {
    expect(graph.coreReactViolations).toEqual([]);
  });
});

/**
 * PHASE 1A-2A — PlanPage boundary.
 *
 * После миграции wall.split, wall.straighten (H/V), wall.alignToNeighbor и
 * wall.merge context-menu actions на executeGeometryCommand, PlanPage.jsx не
 * должен больше напрямую
 * импортировать эти 4 конкретных low-level mutator'а — они существовали в
 * PlanPage ИСКЛЮЧИТЕЛЬНО ради этих branches (подтверждено grep-аудитом перед
 * миграцией: ни одного другого caller не было), поэтому проверка «не
 * импортируется вовсе» здесь означает именно «эти production action
 * branches больше не вызывают их напрямую», а не грубый запрет чтения кода.
 *
 * Не проверяет ВСЕ geometry-related imports PlanPage — drag/draft/nudge/
 * delete/clearSheet остаются на старых low-level путях в этой фазе (см.
 * RESULT — PHASE 1A-2A, «Remaining direct mutations») и продолжают законно
 * импортировать movePlanNode/applyNetworkNodeAtWall/applyNetworkWallSegMove/
 * nudgeWallInPlan/deleteWallEdge/commitWallEdge/refreshWallMountedItems.
 */
describe("PHASE 1A-2A — PlanPage boundary", () => {
  const PLAN_PAGE_FILE = join(REPO, "src", "pages", "admin", "PlanPage.jsx");
  const planPageSource = readFileSync(PLAN_PAGE_FILE, "utf8");

  const MIGRATED_LOW_LEVEL_FNS = ["breakWallEdgeAt", "straightenWallEdge", "alignWallEdgeToNeighbor", "tryMergeWallEdge"];

  it("does not import the 4 migrated low-level mutators from wallNetwork.js", () => {
    const match = planPageSource.match(/import\s*\{([\s\S]*?)\}\s*from\s*["']\.\.\/\.\.\/planner\/wallNetwork\.js["']/);
    expect(match, "wallNetwork.js import not found in PlanPage.jsx").toBeTruthy();
    const importedNames = match[1];
    for (const fn of MIGRATED_LOW_LEVEL_FNS) {
      expect(importedNames, `${fn} should no longer be imported into PlanPage.jsx`).not.toMatch(new RegExp(`\\b${fn}\\b`));
    }
  });

  it("does not call the 4 migrated low-level mutators anywhere in the file (function-call form)", () => {
    for (const fn of MIGRATED_LOW_LEVEL_FNS) {
      expect(planPageSource, `${fn}(...) should no longer be called in PlanPage.jsx`).not.toMatch(new RegExp(`\\b${fn}\\s*\\(`));
    }
  });

  it("imports executeGeometryCommand only indirectly, via the UI orchestration dispatcher", () => {
    expect(planPageSource).not.toMatch(/from\s*["'][^"']*commands\/geometryCommands\.js["']/);
    expect(planPageSource).toMatch(/import\s*\{\s*createGeometryCommandDispatcher\s*\}\s*from\s*["'][^"']*ui\/geometryCommandDispatcher\.js["']/);
  });

  it("the 5 migrated context-menu branches route through runGeometryCommand", () => {
    // Широкие окна (с запасом под многострочные комментарии) — тест ловит
    // отсутствие миграции, а не точное форматирование соседнего кода.
    const branches = [
      /actionId === "wall-straight-h"[\s\S]{0,400}?runGeometryCommand/,
      /actionId === "wall-straight-v"[\s\S]{0,400}?runGeometryCommand/,
      /actionId === "wall-align"[\s\S]{0,400}?runGeometryCommand/,
      /actionId === "wall-merge"[\s\S]{0,600}?runGeometryCommand/,
      /actionId === "wall-break"[\s\S]{0,800}?runGeometryCommand/,
    ];
    for (const re of branches) {
      expect(planPageSource, `expected to find runGeometryCommand near ${re}`).toMatch(re);
    }
  });
});

/**
 * PHASE 1A-2A — geometryCommandDispatcher.js boundary (UI orchestration layer).
 */
describe("PHASE 1A-2A — geometry command dispatcher boundary", () => {
  const DISPATCHER_FILE = join(PLANNER_ROOT, "ui", "geometryCommandDispatcher.js");
  const dispatcherSource = readFileSync(DISPATCHER_FILE, "utf8");

  it("does not import React/ReactDOM", () => {
    expect(/from\s*["']react(-dom)?["']/.test(dispatcherSource)).toBe(false);
  });

  it("does not import PlanPage or backend", () => {
    const codeOnly = dispatcherSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/from\s*["'][^"']*PlanPage/);
    expect(codeOnly).not.toMatch(/from\s*["'][^"']*backend/);
  });

  it("imports executeGeometryCommand directly from the command layer (the one legitimate caller)", () => {
    expect(dispatcherSource).toMatch(/import\s*\{\s*executeGeometryCommand\s*\}\s*from\s*["'][^"']*commands\/geometryCommands\.js["']/);
  });
});

/**
 * PHASE 1A-2B1 — node-drag / wall-segment-drag / keyboard-nudge boundary.
 *
 * После перевода финального commit node/wall-segment drag и keyboard nudge
 * на geometry command boundary, onUp's final-commit branches больше не
 * должны напрямую вызывать низкоуровневые мутаторы geometry/room-sync —
 * это теперь делает сам geometry command (см. PlanPage.jsx onUp,
 * commitNodeDrag/commitWallSegDrag pattern в RESULT — PHASE 1A-2B1).
 *
 * Preview (onMove) НАМЕРЕННО не тронут в этом slice (см. "Scope decisions
 * applied" в отчёте) — те же helpers там должны остаться, тест это
 * подтверждает положительной проверкой, а не глобальным запретом на
 * helpers как таковые.
 */
describe("PHASE 1A-2B1 — drag/nudge boundary", () => {
  const PLAN_PAGE_FILE = join(REPO, "src", "pages", "admin", "PlanPage.jsx");
  const planPageSource = readFileSync(PLAN_PAGE_FILE, "utf8");

  function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  function extractBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    expect(start, `marker not found: ${startMarker}`).toBeGreaterThanOrEqual(0);
    const end = source.indexOf(endMarker, start);
    expect(end, `end marker not found: ${endMarker}`).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  // code-only (comments stripped) — explanatory comments in this diff quote
  // the old function names (e.g. "не commitFrom(preview-plan)"), which would
  // otherwise false-positive against the same regexes used to detect real calls.
  const onMoveSource = stripComments(extractBetween(planPageSource, "const onMove = (e) => {", "const onUp = (e) => {"));
  const onUpSource = stripComments(extractBetween(planPageSource, "const onUp = (e) => {", "const onWheel = (e) => {"));

  it("onUp's final-commit branches do not call the low-level preview mutators or commitFrom directly", () => {
    for (const fn of ["applyNetworkNodeAtWall", "applyNetworkWallSegMove", "commitFrom"]) {
      expect(onUpSource, `${fn}(...) should not be called from onUp`).not.toMatch(new RegExp(`\\b${fn}\\s*\\(`));
    }
  });

  it("onUp does not call syncAutoZones/refreshWallMountedItems directly (room sync/refresh now belongs to the command)", () => {
    expect(onUpSource).not.toMatch(/\bsyncAutoZones\s*\(/);
    expect(onUpSource).not.toMatch(/\brefreshWallMountedItems\s*\(/);
  });

  it("onUp routes node-drag and wall-segment-drag final commit through node.move / wall.moveSegment", () => {
    expect(onUpSource).toMatch(/runGeometryCommand\(\{\s*type:\s*["']node\.move["']/);
    expect(onUpSource).toMatch(/runGeometryCommand\(\{\s*type:\s*["']wall\.moveSegment["']/);
  });

  it("preview (onMove) still uses the low-level mutators and eager refresh/sync directly — unchanged in this slice", () => {
    expect(onMoveSource).toMatch(/\bapplyNetworkNodeAtWall\s*\(/);
    expect(onMoveSource).toMatch(/\bapplyNetworkWallSegMove\s*\(/);
    expect(onMoveSource).toMatch(/\bsyncAutoZones\s*\(/);
    expect(onMoveSource).toMatch(/\brefreshWallMountedItems\s*\(/);
  });

  it("keyboard nudge (nudgeWallSelection) no longer calls nudgeWallInPlan directly and routes through node.nudge", () => {
    const match = planPageSource.match(/const nudgeWallSelection = \(dx, dy\) => \{([\s\S]*?)\n {2}\};/);
    expect(match, "nudgeWallSelection not found").toBeTruthy();
    const codeOnly = stripComments(match[1]);
    expect(codeOnly).not.toMatch(/\bnudgeWallInPlan\s*\(/);
    expect(codeOnly).toMatch(/runGeometryCommand\(\{\s*type:\s*["']node\.nudge["']/);
  });

  it("does not reintroduce the stale getPlan: () => plan pattern (PHASE 1A-2A hardening follow-up)", () => {
    expect(planPageSource).not.toMatch(/getPlan:\s*\(\)\s*=>\s*plan\b/);
  });
});

/**
 * PHASE 1A-2B2 — wall drawing / finish-draft boundary.
 *
 * finishWallChain() (the single canonical finish-draft path — Enter,
 * double-click, context-menu "wall-draft-finish", and the close-loop branch
 * in onUp all call it, directly or via finishDraft()) no longer builds the
 * chain via a direct commitWallChain/commitWallEdge call inside a
 * commitPlan(updater) — it now dispatches one wall.create command. Draft/
 * preview construction (addWallDraftSegment, wallDraftAddSegment, etc.) is
 * untouched and stays out of scope for this check.
 */
describe("PHASE 1A-2B2 — finish-draft boundary", () => {
  const PLAN_PAGE_FILE = join(REPO, "src", "pages", "admin", "PlanPage.jsx");
  const planPageSource = readFileSync(PLAN_PAGE_FILE, "utf8");

  function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  it("finishWallChain no longer calls commitWallChain/commitWallEdge/commitPlan/setPlan/syncAutoZones/refreshWallMountedItems directly and routes through wall.create", () => {
    const match = planPageSource.match(/const finishWallChain = \(\) => \{([\s\S]*?)\n {2}\};/);
    expect(match, "finishWallChain not found").toBeTruthy();
    const codeOnly = stripComments(match[1]);
    for (const fn of ["commitWallChain", "commitWallEdge", "commitPlan", "setPlan", "syncAutoZones", "refreshWallMountedItems"]) {
      expect(codeOnly, `${fn}(...) should no longer be called from finishWallChain`).not.toMatch(new RegExp(`\\b${fn}\\s*\\(`));
    }
    expect(codeOnly).toMatch(/runGeometryCommand\(\{\s*type:\s*["']wall\.create["']/);
  });

  it("finishWallChain reads draft state via ref-only assignment — no stale wallDraftStateRef/draft fallback (PHASE 1A-2B2 corrective regression guard)", () => {
    const match = planPageSource.match(/const finishWallChain = \(\) => \{([\s\S]*?)\n {2}\};/);
    expect(match, "finishWallChain not found").toBeTruthy();
    const codeOnly = stripComments(match[1]);

    expect(codeOnly).toMatch(
      /const\s+meta\s*=\s*wallDraftFinishMeta\(\s*wallDraftStateRef\.current\s*\)\s*;/
    );
    expect(codeOnly).not.toMatch(
      /wallDraftFinishMeta\(\s*wallDraftStateRef\.current\s*\)\s*\|\|/
    );
    expect(codeOnly).not.toMatch(/\bdraft\s*\.\s*length\b/);
    expect(codeOnly).not.toMatch(/\bpts\s*:\s*draft\b/);
  });

  it("does not import commitWallChain (no other production caller left in PlanPage.jsx)", () => {
    expect(planPageSource).not.toMatch(/from\s*["'][^"']*wallCommit\.js["']/);
  });

  it("never dispatches the wall.finishDraft alias as a second UI command path (wall.create is canonical)", () => {
    const codeOnly = stripComments(planPageSource);
    expect(codeOnly).not.toMatch(/type:\s*["']wall\.finishDraft["']/);
  });

  it("all production finish triggers converge on finishWallChain()", () => {
    const codeOnly = stripComments(planPageSource);
    const triggers = [
      // Enter, tool==="wall", draft.length>=1
      /e\.key === ["']Enter["'][\s\S]{0,300}?tool === ["']wall["'] && draft\.length >= 1[\s\S]{0,200}?finishWallChain\(\)/,
      // double-click
      /const onDblClick = \(e\) => \{[\s\S]{0,200}?finishWallChain\(\)/,
      // context-menu "wall-draft-finish"
      /actionId === ["']wall-draft-finish["'][\s\S]{0,100}?finishWallChain\(\)/,
      // onUp close-loop snap branch
      /snap\?\.kind === ["']close["'][\s\S]{0,400}?finishWallChain\(\)/,
      // finishDraft() wrapper, tool==="wall" branch
      /const finishDraft = \(ptsOverride = null\) => \{[\s\S]{0,300}?finishWallChain\(\)/,
      // deprecated commitWallDraft() wrapper
      /const commitWallDraft = \(pts\) => \{[\s\S]{0,200}?finishWallChain\(\)/,
    ];
    for (const re of triggers) {
      expect(codeOnly, `expected to find finishWallChain() near ${re}`).toMatch(re);
    }
  });
});

/**
 * PHASE 1B-1A — wall.setLength boundary (core-only command, no UI wiring in
 * this phase — see RESULT — PHASE 1B-1A). node.move's own public contract is
 * verified unchanged by the full existing plannerGeometryCommands.test.js
 * regression suite (127 tests, all green after the applyNodeMoveGeometry
 * extraction) — not re-asserted statically here.
 */
describe("PHASE 1B-1A — wall.setLength boundary", () => {
  const COMMAND_FILE = join(PLANNER_ROOT, "commands", "geometryCommands.js");
  const commandSource = readFileSync(COMMAND_FILE, "utf8");

  function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  it("wall.setLength is registered in the command table", () => {
    expect(commandSource).toMatch(/["']wall\.setLength["']\s*:\s*handleWallSetLength/);
  });

  it("handleWallSetLength does not call executeGeometryCommand recursively", () => {
    const match = commandSource.match(/function handleWallSetLength\(plan, command\) \{([\s\S]*?)\n\}/);
    expect(match, "handleWallSetLength not found").toBeTruthy();
    const codeOnly = stripComments(match[1]);
    expect(codeOnly).not.toMatch(/\bexecuteGeometryCommand\s*\(/);
  });

  it("geometryCommands.js does not import the UI dispatcher or HistoryModel (command layer stays dispatcher/history-agnostic)", () => {
    expect(commandSource).not.toMatch(/from\s*["'][^"']*ui\/geometryCommandDispatcher\.js["']/);
    expect(commandSource).not.toMatch(/from\s*["'][^"']*historyModel\.js["']/);
  });
});

/**
 * PHASE 1B-1B — wall-length dimension editor boundary (PlanPage wiring for
 * wall.setLength). node.move/geometryCommands.js themselves are untouched by
 * this phase; only the double-click classification + apply glue in
 * PlanPage.jsx is new.
 */
describe("PHASE 1B-1B — wall-length dimension editor boundary", () => {
  const PLAN_PAGE_FILE = join(REPO, "src", "pages", "admin", "PlanPage.jsx");
  const planPageSource = readFileSync(PLAN_PAGE_FILE, "utf8");

  function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  const submitMatch = planPageSource.match(/const submitWallLengthEdit = \(entry\) => \{([\s\S]*?)\n {2}\};/);
  const submitBody = submitMatch ? stripComments(submitMatch[1]) : "";

  it("submitWallLengthEdit exists", () => {
    expect(submitMatch, "submitWallLengthEdit not found").toBeTruthy();
    expect(submitBody.length).toBeGreaterThan(0);
  });

  it("canonical apply path does not call setPlan/commitPlan/applyNetworkNodeAtWall/refreshWallMountedItems/syncAutoZones directly", () => {
    for (const fn of ["setPlan", "commitPlan", "applyNetworkNodeAtWall", "refreshWallMountedItems", "syncAutoZones"]) {
      expect(submitBody, `${fn}(...) should not be called from submitWallLengthEdit`).not.toMatch(new RegExp(`\\b${fn}\\s*\\(`));
    }
  });

  it("canonical apply path does not dispatch node.move directly", () => {
    expect(submitBody).not.toMatch(/type:\s*["']node\.move["']/);
  });

  it("canonical apply path does not call HistoryModel methods directly", () => {
    for (const fn of ["mutate", "checkpoint", "commitFrom"]) {
      expect(submitBody).not.toMatch(new RegExp(`\\.${fn}\\s*\\(`));
    }
  });

  it("canonical apply path routes through applyWallLengthEdit with an explicit fixedEndpoint and the synchronous session guard", () => {
    expect(submitBody).toMatch(/applyWallLengthEdit\(/);
    expect(submitBody).toMatch(/fixedEndpoint:\s*entry\.fixedEndpoint/);
    expect(submitBody).toMatch(/dimensionEditSessionRef\.current\.tryConsume\(/);
  });

  it("wall.setLength is the canonical command type dispatched by the apply helper", () => {
    const applyHelperSource = readFileSync(join(PLANNER_ROOT, "ui", "applyWallLengthEdit.js"), "utf8");
    expect(applyHelperSource).toMatch(/type:\s*["']wall\.setLength["']/);
  });

  it("imports the wall-length apply helper and mapping helper, and does not create a second geometry command dispatcher", () => {
    expect(planPageSource).toMatch(/from\s*["'][^"']*ui\/applyWallLengthEdit\.js["']/);
    expect(planPageSource).toMatch(/from\s*["'][^"']*ui\/wallLengthDimensionMapping\.js["']/);
    const dispatcherCalls = planPageSource.match(/createGeometryCommandDispatcher\s*\(/g) || [];
    expect(dispatcherCalls.length).toBe(1);
  });

  it("the wall-attached double-click branch no longer contains the old TODO alert stub", () => {
    const codeOnly = stripComments(planPageSource);
    expect(codeOnly).not.toMatch(/Изменение геометрии по связанному размеру будет добавлено следующим шагом/);
  });

  it("partial/item dimensions still show an unsupported message (via window.alert)", () => {
    expect(planPageSource).toMatch(/window\.alert\(ITEM_DIMENSION_MESSAGE\)/);
    expect(planPageSource).toMatch(/window\.alert\(WALL_PARTIAL_DIMENSION_MESSAGE\)/);
  });

  it("manual dimension labelOverride path no longer contains the stub alert", () => {
    const match = planPageSource.match(/const applyDimensionEdit = \(dimId, value\) => \{([\s\S]*?)\n {2}\};/);
    expect(match, "applyDimensionEdit not found").toBeTruthy();
    const codeOnly = stripComments(match[1]);
    expect(codeOnly).toMatch(/labelOverride:\s*value/);
    expect(codeOnly).not.toMatch(/window\.alert/);
  });
});

/**
 * PHASE 1A-2C2B — single-wall delete UI trigger convergence + boundary.
 * item delete, item-attached dimensions, multi/mixed delete, clearSheet, and
 * the no-selection Delete-key fallback are explicitly out of scope for this
 * phase (see RESULT — PHASE 1A-2C2B, "Remaining direct destructive paths").
 */
describe("PHASE 1A-2C2B — wall delete UI trigger convergence", () => {
  const PLAN_PAGE_FILE = join(REPO, "src", "pages", "admin", "PlanPage.jsx");
  const planPageSource = readFileSync(PLAN_PAGE_FILE, "utf8");

  function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  function extractBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    expect(start, `marker not found: ${startMarker}`).toBeGreaterThanOrEqual(0);
    const end = source.indexOf(endMarker, start);
    expect(end, `end marker not found: ${endMarker}`).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  it("delSel converges on deleteHits", () => {
    const body = extractBetween(planPageSource, "const delSel = () => {", "const deleteHit = useCallback");
    expect(stripComments(body)).toMatch(/\bdeleteHits\s*\(/);
  });

  it("deleteHit converges on deleteHits", () => {
    const body = extractBetween(planPageSource, "const deleteHit = useCallback((hit) => {", "const pickPlanHit");
    expect(stripComments(body)).toMatch(/\bdeleteHits\s*\(/);
  });

  it("handleDeleteAction converges on deleteHits for the selected-entity branch", () => {
    const body = extractBetween(planPageSource, "const handleDeleteAction = useCallback(() => {", "const createLink = ");
    expect(stripComments(body)).toMatch(/\bdeleteHits\s*\(/);
  });

  it("the wall branch inside deleteHits routes through applyWallDelete/runGeometryCommand, with no competing direct-mutation path", () => {
    const body = stripComments(extractBetween(planPageSource, "// PHASE 1A-2C2B: canonical command boundary", "setPlan((p) => {"));
    expect(body).toMatch(/applyWallDelete\s*\(/);
    expect(body).toMatch(/runGeometryCommand/);
    expect(body).not.toMatch(/\bsetPlan\s*\(/);
    expect(body).not.toMatch(/\bdeleteWallEdge\s*\(/);
    expect(body).not.toMatch(/\brefreshWallMountedItems\s*\(/);
    expect(body).not.toMatch(/\bsyncAutoZones\s*\(/);
    expect(body).not.toMatch(/\bpruneOrphanNodes\s*\(/);
  });

  it("the wall branch dispatches wall.delete with an explicit wallId", () => {
    const body = stripComments(extractBetween(planPageSource, "// PHASE 1A-2C2B: canonical command boundary", "setPlan((p) => {"));
    expect(body).toMatch(/wallId:\s*ids\[0\]/);
  });

  it("selection cleanup in the wall branch is result-status-based, not unconditional", () => {
    const body = stripComments(extractBetween(planPageSource, "// PHASE 1A-2C2B: canonical command boundary", "setPlan((p) => {"));
    expect(body).toMatch(/status === "success"/);
    expect(body).toMatch(/clearSelection\s*\(/);
  });

  it("PlanPage.jsx no longer imports deleteWallEdge or isNetworkPlan (no remaining direct wall-delete path)", () => {
    expect(planPageSource).not.toMatch(/\bdeleteWallEdge\b/);
    expect(planPageSource).not.toMatch(/\bisNetworkPlan\b/);
  });

  it("applyWallDelete dispatches the canonical wall.delete command type", () => {
    const helperSource = readFileSync(join(PLANNER_ROOT, "ui", "applyWallDelete.js"), "utf8");
    expect(helperSource).toMatch(/type:\s*["']wall\.delete["']/);
  });

  it("applyWallDelete does not import React, HistoryModel, or geometryCommands directly", () => {
    const helperSource = readFileSync(join(PLANNER_ROOT, "ui", "applyWallDelete.js"), "utf8");
    expect(helperSource).not.toMatch(/from\s*["']react/);
    expect(helperSource).not.toMatch(/from\s*["'][^"']*historyModel\.js["']/);
    expect(helperSource).not.toMatch(/from\s*["'][^"']*commands\/geometryCommands\.js["']/);
  });
});

/**
 * PHASE 1A-2C2D2 — atomic partitions clear (wall.bulkDelete) UI trigger
 * convergence + boundary. Only clearSheet's "partitions" branch is migrated
 * here. room/line/item clearSheet branches, item.delete, item-attached
 * dimensions, general multi/mixed delete, and the no-selection Delete-key
 * fallback remain explicitly out of scope (see RESULT — PHASE 1A-2C2D2,
 * "Remaining clearSheet branches").
 */
describe("PHASE 1A-2C2D2 — partitions clearSheet wall.bulkDelete convergence", () => {
  const PLAN_PAGE_FILE = join(REPO, "src", "pages", "admin", "PlanPage.jsx");
  const planPageSource = readFileSync(PLAN_PAGE_FILE, "utf8");
  const GEOMETRY_COMMANDS_FILE = join(PLANNER_ROOT, "commands", "geometryCommands.js");
  const geometryCommandsSource = readFileSync(GEOMETRY_COMMANDS_FILE, "utf8");

  function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  function extractBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    expect(start, `marker not found: ${startMarker}`).toBeGreaterThanOrEqual(0);
    const end = source.indexOf(endMarker, start);
    expect(end, `end marker not found: ${endMarker}`).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  function partitionsBranchBody() {
    return extractBetween(planPageSource, 'if (active === "partitions") {', "setPlan((p) => {");
  }

  it("clearSheet keeps the original confirm text unconditionally, before branching on active", () => {
    const body = extractBetween(planPageSource, "const clearSheet = () => {", 'if (active === "partitions") {');
    expect(stripComments(body)).toMatch(/window\.confirm\(`Очистить объекты листа «\$\{name\}»\?`\)/);
  });

  it("the partitions branch routes through applyWallBulkDelete/runGeometryCommand, with no competing direct-mutation path", () => {
    const body = stripComments(partitionsBranchBody());
    expect(body).toMatch(/applyWallBulkDelete\s*\(/);
    expect(body).toMatch(/runGeometryCommand/);
    expect(body).not.toMatch(/\bsetPlan\s*\(/);
    expect(body).not.toMatch(/\bdeleteWallEdge\s*\(/);
    expect(body).not.toMatch(/\bpruneOrphanNodes\s*\(/);
    expect(body).not.toMatch(/\brefreshWallMountedItems\s*\(/);
    expect(body).not.toMatch(/\bsyncAutoZones\s*\(/);
  });

  it("the partitions branch computes wallIds from the live plan via role !== \"outer\", not a hardcoded/stale list", () => {
    const body = stripComments(partitionsBranchBody());
    expect(body).toMatch(/getCurrentPlan\(\)\.walls\.filter\(\(w\)\s*=>\s*w\.role\s*!==\s*"outer"\)/);
  });

  it("the partitions branch does not filter walls a second time inside a setPlan updater (single computation, no duplicate policy)", () => {
    const body = stripComments(partitionsBranchBody());
    expect(body).not.toMatch(/\(p\)\s*=>/);
    expect(body).not.toMatch(/p\.walls\.filter/);
  });

  it("selection cleanup in the partitions branch is result-status-based, not unconditional", () => {
    const body = stripComments(partitionsBranchBody());
    expect(body).toMatch(/status === "success"/);
    expect(body).toMatch(/status === "noop"/);
    expect(body).toMatch(/status === "no-target"/);
    expect(body).toMatch(/setSel\(null\)/);
  });

  it("the partitions branch returns early and never falls through to the legacy setPlan block", () => {
    const body = stripComments(partitionsBranchBody());
    expect(body.trim().replace(/\}\s*$/, "").trim().endsWith("return;")).toBe(true);
  });

  it("line/item clearSheet branches are unmigrated legacy paths (still direct setPlan, not routed through a geometry command)", () => {
    // NOTE: originally also asserted `active === "room"` here — room was
    // migrated to item.bulkDelete in PHASE 1A-2C2D3D2 and no longer reaches
    // this trailing setPlan block at all (see that phase's dedicated
    // boundary block for the room-specific proof).
    const body = stripComments(
      extractBetween(planPageSource, "setPlan((p) => {\r\n      const next = { ...p };", "  };")
    );
    expect(body).toMatch(/LINE_LAYER_IDS\.includes\(active\)/);
    expect(body).toMatch(/ITEM_LAYER_IDS\.includes\(active\)/);
    expect(body).not.toMatch(/applyWallBulkDelete/);
    expect(body).not.toMatch(/runGeometryCommand/);
  });

  it("imports the wall-bulk-delete apply helper, and still creates only one geometry command dispatcher", () => {
    expect(planPageSource).toMatch(/from\s*["'][^"']*ui\/applyWallBulkDelete\.js["']/);
    const dispatcherCalls = planPageSource.match(/createGeometryCommandDispatcher\s*\(/g) || [];
    expect(dispatcherCalls.length).toBe(1);
  });

  it("applyWallBulkDelete dispatches the canonical wall.bulkDelete command type", () => {
    const helperSource = readFileSync(join(PLANNER_ROOT, "ui", "applyWallBulkDelete.js"), "utf8");
    expect(helperSource).toMatch(/type:\s*["']wall\.bulkDelete["']/);
  });

  it("applyWallBulkDelete does not import React, HistoryModel, or geometryCommands directly", () => {
    const helperSource = readFileSync(join(PLANNER_ROOT, "ui", "applyWallBulkDelete.js"), "utf8");
    expect(helperSource).not.toMatch(/from\s*["']react/);
    expect(helperSource).not.toMatch(/from\s*["'][^"']*historyModel\.js["']/);
    expect(helperSource).not.toMatch(/from\s*["'][^"']*commands\/geometryCommands\.js["']/);
  });

  it("wall.bulkDelete is registered in the command HANDLERS map alongside wall.delete", () => {
    expect(geometryCommandsSource).toMatch(/"wall\.delete":\s*handleWallDelete,/);
    expect(geometryCommandsSource).toMatch(/"wall\.bulkDelete":\s*handleWallBulkDelete,/);
  });

  it("wall.delete and wall.bulkDelete share one internal delete implementation (no duplicate cleanup policy)", () => {
    const codeOnly = stripComments(geometryCommandsSource);
    const sharedHelperDefs = codeOnly.match(/function\s+deleteWallsFromPlan\s*\(/g) || [];
    expect(sharedHelperDefs.length).toBe(1);
    const handleWallDeleteBody = extractBetween(codeOnly, "function handleWallDelete(", "\nfunction handleWallBulkDelete(");
    const handleWallBulkDeleteBody = extractBetween(codeOnly, "function handleWallBulkDelete(", "\nfunction isFiniteConsecutivePoint(");
    expect(handleWallDeleteBody).toMatch(/deleteWallsFromPlan\s*\(/);
    expect(handleWallBulkDeleteBody).toMatch(/deleteWallsFromPlan\s*\(/);
  });
});

/**
 * PHASE 1A-2C2D3B — atomic item delete (item.bulkDelete) UI trigger
 * convergence + boundary. deleteHits' "items" branch (covering delSel,
 * deleteHit, handleDeleteAction, context-menu delete, multi-item selection)
 * and clearSheet's five simple item layers (racks/water/sockets/sanitary/
 * furn) are migrated here. room/line/disputed (mode:"both"/climate/staff)
 * clearSheet branches, legacy item-layer migration, label.targetId, and
 * editor-session cleanup remain explicitly out of scope (see RESULT —
 * PHASE 1A-2C2D3B, "Remaining item-layer branches").
 */
describe("PHASE 1A-2C2D3B — item bulk delete UI trigger convergence", () => {
  const PLAN_PAGE_FILE = join(REPO, "src", "pages", "admin", "PlanPage.jsx");
  const planPageSource = readFileSync(PLAN_PAGE_FILE, "utf8");
  const GEOMETRY_COMMANDS_FILE = join(PLANNER_ROOT, "commands", "geometryCommands.js");
  const geometryCommandsSource = readFileSync(GEOMETRY_COMMANDS_FILE, "utf8");

  function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  function extractBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    expect(start, `marker not found: ${startMarker}`).toBeGreaterThanOrEqual(0);
    const end = source.indexOf(endMarker, start);
    expect(end, `end marker not found: ${endMarker}`).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  function deleteHitsItemsBranchBody() {
    return extractBetween(
      planPageSource,
      'if (coll === "items") {\r\n      // PHASE 1A-2C2D3B (deleteHits):',
      "setPlan((p) => {",
    );
  }

  function clearSheetItemsBranchBody() {
    return extractBetween(
      planPageSource,
      "if (MIGRATED_ITEM_CLEAR_LAYER_IDS.includes(active)) {",
      'setPlan((p) => {\r\n      const next = { ...p };',
    );
  }

  it("delSel/deleteHit/handleDeleteAction all converge on deleteHits (same trigger-convergence proof as wall delete)", () => {
    const delSelBody = extractBetween(planPageSource, "const delSel = () => {", "const deleteHit = useCallback");
    expect(stripComments(delSelBody)).toMatch(/\bdeleteHits\s*\(/);
    const deleteHitBody = extractBetween(planPageSource, "const deleteHit = useCallback((hit) => {", "const pickPlanHit");
    expect(stripComments(deleteHitBody)).toMatch(/\bdeleteHits\s*\(/);
    const handleDeleteActionBody = extractBetween(planPageSource, "const handleDeleteAction = useCallback(() => {", "const createLink = ");
    expect(stripComments(handleDeleteActionBody)).toMatch(/\bdeleteHits\s*\(/);
  });

  it("the items branch inside deleteHits routes through applyItemBulkDelete/runGeometryCommand, with no competing direct-mutation path", () => {
    const body = stripComments(deleteHitsItemsBranchBody());
    expect(body).toMatch(/applyItemBulkDelete\s*\(/);
    expect(body).toMatch(/runGeometryCommand/);
    expect(body).not.toMatch(/\bsetPlan\s*\(/);
    expect(body).not.toMatch(/\bsyncEngineeringPlan\s*\(/);
    expect(body).not.toMatch(/\.filter\(\(o\)\s*=>\s*!idSet\.has\(o\.id\)\)/);
    expect(body).not.toMatch(/\.filter\(\(l\)\s*=>\s*!idSet\.has\(l\.fromId\)/);
  });

  it("the deleteHits items branch dispatches item.bulkDelete with the full explicit ids array", () => {
    const body = stripComments(deleteHitsItemsBranchBody());
    expect(body).toMatch(/itemIds:\s*ids/);
  });

  it("selection cleanup in the deleteHits items branch is result-status-based, not unconditional", () => {
    const body = stripComments(deleteHitsItemsBranchBody());
    expect(body).toMatch(/status === "success"/);
    expect(body).toMatch(/status === "noop"/);
    expect(body).toMatch(/status === "no-target"/);
    expect(body).toMatch(/clearSelection\s*\(/);
  });

  it("the clearSheet five-layer branch routes through applyItemBulkDelete/runGeometryCommand, with no competing direct-mutation path", () => {
    const body = stripComments(clearSheetItemsBranchBody());
    expect(body).toMatch(/applyItemBulkDelete\s*\(/);
    expect(body).toMatch(/runGeometryCommand/);
    expect(body).not.toMatch(/\bsetPlan\s*\(/);
    expect(body).not.toMatch(/\bsyncEngineeringPlan\s*\(/);
  });

  it("the clearSheet five-layer branch computes itemIds from the live plan via item.layer === active, not a hardcoded/stale list", () => {
    const body = stripComments(clearSheetItemsBranchBody());
    expect(body).toMatch(/getCurrentPlan\(\)\.items\.filter\(\(it\)\s*=>\s*it\.layer === active\)/);
  });

  it("the clearSheet five-layer branch returns early and never falls through to the legacy setPlan block", () => {
    const body = stripComments(clearSheetItemsBranchBody());
    expect(body.trim().replace(/\}\s*$/, "").trim().endsWith("return;")).toBe(true);
  });

  it("MIGRATED_ITEM_CLEAR_LAYER_IDS is exactly the six proven-working item layers (five simple + climate from PHASE 1A-2C2D3E3), not the full ITEM_LAYER_IDS set", () => {
    expect(planPageSource).toMatch(/const MIGRATED_ITEM_CLEAR_LAYER_IDS = \["racks", "water", "sockets", "sanitary", "furn", "climate"\];/);
  });

  it("line/disputed clearSheet branches are unmigrated legacy paths (still direct setPlan, not routed through a geometry command)", () => {
    // NOTE: originally also asserted `active === "room"` here — room was
    // migrated to item.bulkDelete in PHASE 1A-2C2D3D2 (see that phase's
    // dedicated boundary block below).
    const body = stripComments(
      extractBetween(planPageSource, "setPlan((p) => {\r\n      const next = { ...p };", "  };"),
    );
    expect(body).toMatch(/LINE_LAYER_IDS\.includes\(active\)/);
    expect(body).toMatch(/ITEM_LAYER_IDS\.includes\(active\)/);
    expect(body).not.toMatch(/applyItemBulkDelete/);
    expect(body).not.toMatch(/runGeometryCommand/);
  });

  it("imports the item-bulk-delete apply helper, and still creates only one geometry command dispatcher", () => {
    expect(planPageSource).toMatch(/from\s*["'][^"']*ui\/applyItemBulkDelete\.js["']/);
    const dispatcherCalls = planPageSource.match(/createGeometryCommandDispatcher\s*\(/g) || [];
    expect(dispatcherCalls.length).toBe(1);
  });

  it("applyItemBulkDelete dispatches the canonical item.bulkDelete command type", () => {
    const helperSource = readFileSync(join(PLANNER_ROOT, "ui", "applyItemBulkDelete.js"), "utf8");
    expect(helperSource).toMatch(/type:\s*["']item\.bulkDelete["']/);
  });

  it("applyItemBulkDelete does not import React, HistoryModel, or geometryCommands directly", () => {
    const helperSource = readFileSync(join(PLANNER_ROOT, "ui", "applyItemBulkDelete.js"), "utf8");
    expect(helperSource).not.toMatch(/from\s*["']react/);
    expect(helperSource).not.toMatch(/from\s*["'][^"']*historyModel\.js["']/);
    expect(helperSource).not.toMatch(/from\s*["'][^"']*commands\/geometryCommands\.js["']/);
  });

  it("item.bulkDelete is registered in the command HANDLERS map", () => {
    expect(geometryCommandsSource).toMatch(/"item\.bulkDelete":\s*handleItemBulkDelete,/);
  });

  it("deleteItemsFromPlan is the single internal item-delete implementation used by item.bulkDelete", () => {
    const codeOnly = stripComments(geometryCommandsSource);
    const sharedHelperDefs = codeOnly.match(/function\s+deleteItemsFromPlan\s*\(/g) || [];
    expect(sharedHelperDefs.length).toBe(1);
    const handleItemBulkDeleteBody = extractBetween(codeOnly, "function handleItemBulkDelete(", "\nconst HANDLERS = {");
    expect(handleItemBulkDeleteBody).toMatch(/deleteItemsFromPlan\s*\(/);
  });
});

/**
 * PHASE 1A-2C2D3D2 — room-layer clear (item.bulkDelete) UI trigger
 * convergence + boundary. Only clearSheet's "room" branch is migrated here,
 * with its own project-wide destructive confirmation (distinct from the
 * generic per-sheet confirm text used by every other branch). irrigation/
 * power/light/vent/climate/staff/line-layer branches, legacy item-layer
 * migration, label.targetId, and editor-session cleanup remain explicitly
 * out of scope (see RESULT — PHASE 1A-2C2D3D2, "Unchanged clearSheet
 * branches").
 */
describe("PHASE 1A-2C2D3D2 — room clearSheet item.bulkDelete convergence", () => {
  const PLAN_PAGE_FILE = join(REPO, "src", "pages", "admin", "PlanPage.jsx");
  const planPageSource = readFileSync(PLAN_PAGE_FILE, "utf8");

  function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  function extractBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    expect(start, `marker not found: ${startMarker}`).toBeGreaterThanOrEqual(0);
    const end = source.indexOf(endMarker, start);
    expect(end, `end marker not found: ${endMarker}`).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  function roomBranchBody() {
    return extractBetween(planPageSource, 'if (active === "room") {', "const name = layerById(active).name;");
  }

  it("clearSheet checks active===\"room\" as its own early branch, before the generic per-sheet confirm", () => {
    const start = planPageSource.indexOf("const clearSheet = () => {");
    expect(start).toBeGreaterThanOrEqual(0);
    const roomIfIndex = planPageSource.indexOf('if (active === "room") {', start);
    const genericConfirmIndex = planPageSource.indexOf("const name = layerById(active).name;", start);
    expect(roomIfIndex).toBeGreaterThan(start);
    expect(genericConfirmIndex).toBeGreaterThan(roomIfIndex);
  });

  it("the room branch reads getCurrentPlan() before confirmation to compute display counts, and early-returns with cleared selection when there is nothing to clear", () => {
    const body = stripComments(roomBranchBody());
    expect(body).toMatch(/const roomItemsBeforeConfirm = getCurrentPlan\(\)\.items\.filter\(\(it\) => it\.layer === "room"\)/);
    expect(body).toMatch(/roomItemsBeforeConfirm\.length === 0/);
    expect(body).toMatch(/setSel\(null\);\s*\n\s*return;/);
  });

  it("the room branch uses summarizeRoomClearItems/buildRoomClearConfirmMessage for an explicit destructive confirm, not the generic per-sheet confirm text", () => {
    const body = stripComments(roomBranchBody());
    expect(body).toMatch(/summarizeRoomClearItems\s*\(/);
    expect(body).toMatch(/window\.confirm\(buildRoomClearConfirmMessage\(counts\)\)/);
    expect(body).not.toMatch(/Очистить объекты листа/);
  });

  it("the room branch recomputes itemIds from a fresh getCurrentPlan() read AFTER the confirm (live-plan race safety), not from the pre-confirm snapshot", () => {
    const body = stripComments(roomBranchBody());
    const getCurrentPlanCalls = body.match(/getCurrentPlan\(\)\.items\.filter\(\(it\) => it\.layer === "room"\)/g) || [];
    // one read for the pre-confirm counts, one independent read for the
    // authoritative post-confirm delete set — never reused/cached between them.
    expect(getCurrentPlanCalls.length).toBe(2);
    const confirmIdx = body.indexOf("window.confirm(buildRoomClearConfirmMessage(counts))");
    const secondReadIdx = body.indexOf('getCurrentPlan().items.filter((it) => it.layer === "room")', confirmIdx);
    expect(secondReadIdx).toBeGreaterThan(confirmIdx);
  });

  it("the room branch routes through applyItemBulkDelete/runGeometryCommand, with no competing direct-mutation path", () => {
    const body = stripComments(roomBranchBody());
    expect(body).toMatch(/applyItemBulkDelete\s*\(/);
    expect(body).toMatch(/runGeometryCommand/);
    expect(body).not.toMatch(/\bsetPlan\s*\(/);
    expect(body).not.toMatch(/\.filter\(\(i\)\s*=>\s*i\.layer\s*!==\s*"room"\)/);
    expect(body).not.toMatch(/\bsyncEngineeringPlan\s*\(/);
  });

  it("selection cleanup in the room branch is result-status-based, not unconditional", () => {
    const body = stripComments(roomBranchBody());
    expect(body).toMatch(/status === "success"/);
    expect(body).toMatch(/status === "noop"/);
    expect(body).toMatch(/status === "no-target"/);
  });

  it("the generic legacy room-clear line no longer exists in the trailing setPlan updater (unreachable dead branch removed)", () => {
    const codeOnly = stripComments(planPageSource);
    expect(codeOnly).not.toMatch(/i\.layer\s*!==\s*"room"/);
  });

  it("imports summarizeRoomClearItems/buildRoomClearConfirmMessage from the leaf roomClearSummary helper", () => {
    expect(planPageSource).toMatch(/from\s*["'][^"']*ui\/roomClearSummary\.js["']/);
  });

  it("roomClearSummary.js does not import React, DOM, HistoryModel, or geometryCommands", () => {
    const helperSource = readFileSync(join(PLANNER_ROOT, "ui", "roomClearSummary.js"), "utf8");
    expect(helperSource).not.toMatch(/from\s*["']react/);
    expect(helperSource).not.toMatch(/from\s*["'][^"']*historyModel\.js["']/);
    expect(helperSource).not.toMatch(/from\s*["'][^"']*commands\/geometryCommands\.js["']/);
  });

  it("disputed clearSheet branches (power/light/vent/staff/line layers) remain unmigrated legacy paths (climate migrated in PHASE 1A-2C2D3E3, see that phase's own boundary block below; irrigation/drain migrated in PHASE 1A-2C2D3E2)", () => {
    const body = stripComments(
      extractBetween(planPageSource, "setPlan((p) => {\r\n      const next = { ...p };", "  };"),
    );
    expect(body).toMatch(/LINE_LAYER_IDS\.includes\(active\)/);
    expect(body).toMatch(/ITEM_LAYER_IDS\.includes\(active\)/);
    expect(body).not.toMatch(/applyItemBulkDelete/);
    expect(body).not.toMatch(/summarizeRoomClearItems/);
  });
});

/**
 * PHASE 1A-2C2D3E2 — atomic line delete (line.bulkDelete) UI trigger
 * convergence + boundary. deleteHits' "lines" branch (covering delSel,
 * deleteHit, handleDeleteAction, context-menu delete) and clearSheet's two
 * proven line-only layers (drain/irrigation — zero catalog item kinds today,
 * see AUDIT PHASE 1A-2C2D3E1) are migrated here. power/light/vent/climate/
 * staff clearSheet branches (mode:"both"/disputed item+line layers) remain
 * explicitly out of scope until a combined item+line clear command exists.
 */
describe("PHASE 1A-2C2D3E2 — line bulk delete UI trigger convergence", () => {
  const PLAN_PAGE_FILE = join(REPO, "src", "pages", "admin", "PlanPage.jsx");
  const planPageSource = readFileSync(PLAN_PAGE_FILE, "utf8");
  const GEOMETRY_COMMANDS_FILE = join(PLANNER_ROOT, "commands", "geometryCommands.js");
  const geometryCommandsSource = readFileSync(GEOMETRY_COMMANDS_FILE, "utf8");

  function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  function extractBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    expect(start, `marker not found: ${startMarker}`).toBeGreaterThanOrEqual(0);
    const end = source.indexOf(endMarker, start);
    expect(end, `end marker not found: ${endMarker}`).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  function deleteHitsLinesBranchBody() {
    return extractBetween(
      planPageSource,
      'if (coll === "lines") {\r\n      // PHASE 1A-2C2D3E2 (deleteHits):',
      "setPlan((p) => {",
    );
  }

  function clearSheetLineBranchBody() {
    return extractBetween(
      planPageSource,
      "if (MIGRATED_LINE_CLEAR_LAYER_IDS.includes(active)) {",
      'setPlan((p) => {\r\n      const next = { ...p };',
    );
  }

  it("delSel/deleteHit/handleDeleteAction all converge on deleteHits (same trigger-convergence proof as wall/item delete)", () => {
    const delSelBody = extractBetween(planPageSource, "const delSel = () => {", "const deleteHit = useCallback");
    expect(stripComments(delSelBody)).toMatch(/\bdeleteHits\s*\(/);
    const deleteHitBody = extractBetween(planPageSource, "const deleteHit = useCallback((hit) => {", "const pickPlanHit");
    expect(stripComments(deleteHitBody)).toMatch(/\bdeleteHits\s*\(/);
    const handleDeleteActionBody = extractBetween(planPageSource, "const handleDeleteAction = useCallback(() => {", "const createLink = ");
    expect(stripComments(handleDeleteActionBody)).toMatch(/\bdeleteHits\s*\(/);
  });

  it("the lines branch inside deleteHits routes through applyLineBulkDelete/runGeometryCommand, with no competing direct-mutation path", () => {
    const body = stripComments(deleteHitsLinesBranchBody());
    expect(body).toMatch(/applyLineBulkDelete\s*\(/);
    expect(body).toMatch(/runGeometryCommand/);
    expect(body).not.toMatch(/\bsetPlan\s*\(/);
    expect(body).not.toMatch(/\bsyncEngineeringPlan\s*\(/);
    expect(body).not.toMatch(/\.filter\(\(o\)\s*=>\s*!idSet\.has\(o\.id\)\)/);
  });

  it("the deleteHits lines branch dispatches line.bulkDelete with the full explicit ids array (not just ids[0])", () => {
    const body = stripComments(deleteHitsLinesBranchBody());
    expect(body).toMatch(/lineIds:\s*ids/);
  });

  it("selection cleanup in the deleteHits lines branch is result-status-based, not unconditional", () => {
    const body = stripComments(deleteHitsLinesBranchBody());
    expect(body).toMatch(/status === "success"/);
    expect(body).toMatch(/status === "noop"/);
    expect(body).toMatch(/status === "no-target"/);
    expect(body).toMatch(/clearSelection\s*\(/);
  });

  it("the deleteHits fallback setPlan updater no longer special-cases coll===\"lines\" with a direct syncEngineeringPlan call (dead code removed, not left as a second competing path)", () => {
    const body = stripComments(
      extractBetween(planPageSource, 'setPlan((p) => {\r\n      let next = { ...p };', "clearSelection();\r\n    return true;"),
    );
    expect(body).not.toMatch(/coll === "lines"/);
    expect(body).not.toMatch(/\bsyncEngineeringPlan\s*\(/);
  });

  it("the clearSheet drain/irrigation branch routes through applyLineBulkDelete/runGeometryCommand, with no competing direct-mutation path", () => {
    const body = stripComments(clearSheetLineBranchBody());
    expect(body).toMatch(/applyLineBulkDelete\s*\(/);
    expect(body).toMatch(/runGeometryCommand/);
    expect(body).not.toMatch(/\bsetPlan\s*\(/);
  });

  it("the clearSheet drain/irrigation branch computes lineIds from the live plan via layer/migrateLayerId match, not a hardcoded/stale list", () => {
    const body = stripComments(clearSheetLineBranchBody());
    expect(body).toMatch(/getCurrentPlan\(\)\.lines/);
    expect(body).toMatch(/line\.layer === active/);
    expect(body).toMatch(/migrateLayerId\(line\.layer\) === active/);
  });

  it("the clearSheet drain/irrigation branch returns early and never falls through to the legacy setPlan block", () => {
    const body = stripComments(clearSheetLineBranchBody());
    expect(body.trim().replace(/\}\s*$/, "").trim().endsWith("return;")).toBe(true);
  });

  it("MIGRATED_LINE_CLEAR_LAYER_IDS is exactly the two proven-working line-only layers (drain/irrigation), not the full LINE_LAYER_IDS set", () => {
    expect(planPageSource).toMatch(/const MIGRATED_LINE_CLEAR_LAYER_IDS = \["drain", "irrigation"\];/);
  });

  it("power/light/vent/climate/staff clearSheet branches remain unmigrated legacy paths (still direct setPlan, not routed through a geometry command)", () => {
    const body = stripComments(
      extractBetween(planPageSource, "setPlan((p) => {\r\n      const next = { ...p };", "  };"),
    );
    expect(body).toMatch(/LINE_LAYER_IDS\.includes\(active\)/);
    expect(body).toMatch(/ITEM_LAYER_IDS\.includes\(active\)/);
    expect(body).not.toMatch(/applyLineBulkDelete/);
  });

  it("imports the line-bulk-delete apply helper, and still creates only one geometry command dispatcher", () => {
    expect(planPageSource).toMatch(/from\s*["'][^"']*ui\/applyLineBulkDelete\.js["']/);
    const dispatcherCalls = planPageSource.match(/createGeometryCommandDispatcher\s*\(/g) || [];
    expect(dispatcherCalls.length).toBe(1);
  });

  it("applyLineBulkDelete dispatches the canonical line.bulkDelete command type", () => {
    const helperSource = readFileSync(join(PLANNER_ROOT, "ui", "applyLineBulkDelete.js"), "utf8");
    expect(helperSource).toMatch(/type:\s*["']line\.bulkDelete["']/);
  });

  it("applyLineBulkDelete does not import React, HistoryModel, or geometryCommands directly", () => {
    const helperSource = readFileSync(join(PLANNER_ROOT, "ui", "applyLineBulkDelete.js"), "utf8");
    expect(helperSource).not.toMatch(/from\s*["']react/);
    expect(helperSource).not.toMatch(/from\s*["'][^"']*historyModel\.js["']/);
    expect(helperSource).not.toMatch(/from\s*["'][^"']*commands\/geometryCommands\.js["']/);
  });

  it("line.bulkDelete is registered in the command HANDLERS map", () => {
    expect(geometryCommandsSource).toMatch(/"line\.bulkDelete":\s*handleLineBulkDelete,/);
  });

  it("deleteLinesFromPlan is the single internal line-delete implementation used by line.bulkDelete", () => {
    const codeOnly = stripComments(geometryCommandsSource);
    const sharedHelperDefs = codeOnly.match(/function\s+deleteLinesFromPlan\s*\(/g) || [];
    expect(sharedHelperDefs.length).toBe(1);
    const handleLineBulkDeleteBody = extractBetween(codeOnly, "function handleLineBulkDelete(", "\nconst HANDLERS = {");
    expect(handleLineBulkDeleteBody).toMatch(/deleteLinesFromPlan\s*\(/);
  });

  it("ENTITY_KINDS includes \"lines\" (typed entityChanges contract, additive to walls/nodes/items/dimensions/links)", () => {
    expect(geometryCommandsSource).toMatch(/const ENTITY_KINDS = \["walls", "nodes", "items", "dimensions", "links", "lines"\];/);
  });

  it("REQUIRED FIX F-01: emptyEntityChanges derives each bucket from ENTITY_KINDS via a shared helper, not a hand-maintained literal that could fall behind it", () => {
    const codeOnly = stripComments(geometryCommandsSource);
    expect(codeOnly).toMatch(/function\s+emptyEntityBucket\s*\(\)\s*\{\s*return\s+Object\.fromEntries\(ENTITY_KINDS\.map/);
    const emptyEntityChangesBody = extractBetween(codeOnly, "function emptyEntityChanges() {", "\nfunction normalizeEntityChanges");
    expect(emptyEntityChangesBody).toMatch(/created:\s*emptyEntityBucket\(\)/);
    expect(emptyEntityChangesBody).toMatch(/changed:\s*emptyEntityBucket\(\)/);
    expect(emptyEntityChangesBody).toMatch(/deleted:\s*emptyEntityBucket\(\)/);
    // No leftover hand-maintained partial literal (walls/nodes/items/
    // dimensions only, missing links/lines) anywhere in the file.
    expect(codeOnly).not.toMatch(/\{\s*walls:\s*\[\],\s*nodes:\s*\[\],\s*items:\s*\[\],\s*dimensions:\s*\[\]\s*\}/);
  });
});

/**
 * PHASE 1A-2C2D3E3 — climate clearSheet routing fix: climate's LAYERS.mode
 * was already "items" (17 real catalog kinds, no "line" tool in
 * LAYER_TOOLS.climate — see AUDIT PHASE 1A-2C2D3E1, Risk R1), but climate
 * also sits in LINE_LAYER_IDS, so the legacy if/else-if fallback used to
 * intercept it as a line-layer and clear (almost always zero) lines, leaving
 * every climate item untouched. Only the routing is fixed here — climate is
 * added to MIGRATED_ITEM_CLEAR_LAYER_IDS, reusing the existing item.bulkDelete
 * branch unchanged. LINE_LAYER_IDS, LAYERS.mode, catalog, LAYER_TOOLS, and
 * line.bulkDelete are all untouched by this phase. power/light/vent/staff
 * remain on the legacy line-fallback path.
 */
describe("PHASE 1A-2C2D3E3 — climate clearSheet item.bulkDelete convergence", () => {
  const PLAN_PAGE_FILE = join(REPO, "src", "pages", "admin", "PlanPage.jsx");
  const planPageSource = readFileSync(PLAN_PAGE_FILE, "utf8");

  function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  it("climate is in MIGRATED_ITEM_CLEAR_LAYER_IDS (the exact six-layer set)", () => {
    expect(planPageSource).toMatch(/const MIGRATED_ITEM_CLEAR_LAYER_IDS = \["racks", "water", "sockets", "sanitary", "furn", "climate"\];/);
  });

  it("climate is NOT in MIGRATED_LINE_CLEAR_LAYER_IDS (still exactly drain/irrigation, unchanged by this phase)", () => {
    expect(planPageSource).toMatch(/const MIGRATED_LINE_CLEAR_LAYER_IDS = \["drain", "irrigation"\];/);
  });

  it("climate stays in LINE_LAYER_IDS unchanged (only routing changed, not layer classification)", () => {
    expect(planPageSource).toMatch(/const LINE_LAYER_IDS = \["drain", "irrigation", "supply", "power", "vent", "climate", "ac", "light", "staff"\];/);
  });

  it("the MIGRATED_ITEM_CLEAR_LAYER_IDS branch (now including climate) is checked before MIGRATED_LINE_CLEAR_LAYER_IDS and the legacy fallback, so climate can never reach either", () => {
    const codeOnly = stripComments(planPageSource);
    const itemBranchIdx = codeOnly.indexOf("if (MIGRATED_ITEM_CLEAR_LAYER_IDS.includes(active)) {");
    const lineBranchIdx = codeOnly.indexOf("if (MIGRATED_LINE_CLEAR_LAYER_IDS.includes(active)) {");
    const legacyFallbackIdx = codeOnly.indexOf("if (LINE_LAYER_IDS.includes(active)) next.lines");
    expect(itemBranchIdx).toBeGreaterThan(-1);
    expect(lineBranchIdx).toBeGreaterThan(itemBranchIdx);
    expect(legacyFallbackIdx).toBeGreaterThan(lineBranchIdx);
  });

  it("power/light/vent/staff remain reachable only through the legacy LINE_LAYER_IDS fallback (still not in either migrated set)", () => {
    for (const layer of ["power", "light", "vent", "staff"]) {
      expect(planPageSource).not.toMatch(new RegExp(`MIGRATED_ITEM_CLEAR_LAYER_IDS = \\[[^\\]]*"${layer}"`));
      expect(planPageSource).not.toMatch(new RegExp(`MIGRATED_LINE_CLEAR_LAYER_IDS = \\[[^\\]]*"${layer}"`));
    }
  });

  it("line.bulkDelete registration and ENTITY_KINDS are unchanged by this phase (climate migration touches only PlanPage.jsx routing)", () => {
    const GEOMETRY_COMMANDS_FILE = join(PLANNER_ROOT, "commands", "geometryCommands.js");
    const geometryCommandsSource = readFileSync(GEOMETRY_COMMANDS_FILE, "utf8");
    expect(geometryCommandsSource).toMatch(/"line\.bulkDelete":\s*handleLineBulkDelete,/);
    expect(geometryCommandsSource).toMatch(/const ENTITY_KINDS = \["walls", "nodes", "items", "dimensions", "links", "lines"\];/);
  });
});

/**
 * PHASE 1A-2C2D3E4B — pure structural cleanup primitive extraction.
 * computeItemRemoval/computeLineRemoval are extracted out of
 * deleteItemsFromPlan/deleteLinesFromPlan so a future combined item+line
 * delete command can reuse them against one shared plan + one
 * runEngineeringSync pass. This phase does NOT introduce that combined
 * command, any UI wiring, or any power/light/vent/staff migration — only
 * the internal command-layer refactor, with item.bulkDelete/line.bulkDelete
 * behavior fully preserved (proven by the unchanged, still-passing
 * dispatcher test suites).
 */
describe("PHASE 1A-2C2D3E4B — structural cleanup primitive extraction", () => {
  const GEOMETRY_COMMANDS_FILE = join(PLANNER_ROOT, "commands", "geometryCommands.js");
  const geometryCommandsSource = readFileSync(GEOMETRY_COMMANDS_FILE, "utf8");

  function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  function extractBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    expect(start, `marker not found: ${startMarker}`).toBeGreaterThanOrEqual(0);
    const end = source.indexOf(endMarker, start);
    expect(end, `end marker not found: ${endMarker}`).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  const codeOnly = stripComments(geometryCommandsSource);

  it("computeItemRemoval and computeLineRemoval each exist exactly once (single source of structural cleanup truth)", () => {
    expect((codeOnly.match(/function\s+computeItemRemoval\s*\(/g) || []).length).toBe(1);
    expect((codeOnly.match(/function\s+computeLineRemoval\s*\(/g) || []).length).toBe(1);
  });

  it("computeItemRemoval does not call runEngineeringSync, changedOk, rejected, or executeGeometryCommand", () => {
    const body = extractBetween(codeOnly, "function computeItemRemoval(", "\nfunction deleteItemsFromPlan(");
    expect(body).not.toMatch(/\brunEngineeringSync\s*\(/);
    expect(body).not.toMatch(/\bchangedOk\s*\(/);
    expect(body).not.toMatch(/\brejected\s*\(/);
    expect(body).not.toMatch(/\bexecuteGeometryCommand\s*\(/);
  });

  it("computeLineRemoval does not call runEngineeringSync, changedOk, rejected, or executeGeometryCommand", () => {
    const body = extractBetween(codeOnly, "function computeLineRemoval(", "\nfunction deleteLinesFromPlan(");
    expect(body).not.toMatch(/\brunEngineeringSync\s*\(/);
    expect(body).not.toMatch(/\bchangedOk\s*\(/);
    expect(body).not.toMatch(/\brejected\s*\(/);
    expect(body).not.toMatch(/\bexecuteGeometryCommand\s*\(/);
  });

  it("computeItemRemoval and computeLineRemoval never reference UI layer/sheet semantics (power/light/vent/climate/staff)", () => {
    const itemBody = extractBetween(codeOnly, "function computeItemRemoval(", "\nfunction deleteItemsFromPlan(");
    const lineBody = extractBetween(codeOnly, "function computeLineRemoval(", "\nfunction deleteLinesFromPlan(");
    for (const layer of ["power", "light", "vent", "climate", "staff"]) {
      expect(itemBody).not.toMatch(new RegExp(`["']${layer}["']`));
      expect(lineBody).not.toMatch(new RegExp(`["']${layer}["']`));
    }
  });

  it("deleteItemsFromPlan delegates to computeItemRemoval and calls runEngineeringSync exactly once", () => {
    const body = extractBetween(codeOnly, "function deleteItemsFromPlan(", "\nfunction handleItemBulkDelete(");
    expect(body).toMatch(/computeItemRemoval\s*\(/);
    expect((body.match(/\brunEngineeringSync\s*\(/g) || []).length).toBe(1);
  });

  it("deleteLinesFromPlan delegates to computeLineRemoval and calls runEngineeringSync exactly once", () => {
    const body = extractBetween(codeOnly, "function deleteLinesFromPlan(", "\nfunction handleLineBulkDelete(");
    expect(body).toMatch(/computeLineRemoval\s*\(/);
    expect((body.match(/\brunEngineeringSync\s*\(/g) || []).length).toBe(1);
  });

  it("no items.filter/links.filter/dimensions cleanup math exists outside computeItemRemoval (single source of truth)", () => {
    const outsideItemPrimitive = codeOnly.replace(
      extractBetween(codeOnly, "function computeItemRemoval(", "\nfunction deleteItemsFromPlan("),
      "",
    );
    expect(outsideItemPrimitive).not.toMatch(/\(plan\.items \|\| \[\]\)\.filter\(\(it\) => !deletedItemIdSet\.has\(it\.id\)\)/);
    // Specific to the item-deletion link cleanup (deletedItemIdSet) — not a
    // false-positive match against deleteWallsFromPlan's own, legitimately
    // different link cleanup (danglingItemIdSet), which shares the same
    // generic "(plan.links || []).filter((l) => {" opening syntax.
    expect(outsideItemPrimitive).not.toMatch(/deletedItemIdSet\.has\(l\.fromId\) \|\| deletedItemIdSet\.has\(l\.toId\)/);
  });

  it("no lines.filter cleanup math exists outside computeLineRemoval (single source of truth)", () => {
    const outsideLinePrimitive = codeOnly.replace(
      extractBetween(codeOnly, "function computeLineRemoval(", "\nfunction deleteLinesFromPlan("),
      "",
    );
    expect(outsideLinePrimitive).not.toMatch(/\(plan\.lines \|\| \[\]\)\.filter\(\(l\) => !deletedLineIdSet\.has\(l\.id\)\)/);
  });

  it("handlers remain thin: handleItemBulkDelete/handleLineBulkDelete call the wrapper, not the primitive, directly", () => {
    const itemHandlerBody = extractBetween(codeOnly, "function handleItemBulkDelete(", "\nfunction computeLineRemoval(");
    const lineHandlerBody = extractBetween(codeOnly, "function handleLineBulkDelete(", "\nfunction deleteItemsAndLinesFromPlan(");
    expect(itemHandlerBody).toMatch(/deleteItemsFromPlan\s*\(/);
    expect(itemHandlerBody).not.toMatch(/computeItemRemoval\s*\(/);
    expect(lineHandlerBody).toMatch(/deleteLinesFromPlan\s*\(/);
    expect(lineHandlerBody).not.toMatch(/computeLineRemoval\s*\(/);
  });

  it("entities.bulkDelete / layer.bulkDelete were never introduced (itemLine.bulkDelete is the one canonical combined command, not a generic/layer-aware alternative)", () => {
    expect(geometryCommandsSource).not.toMatch(/entities\.bulkDelete/);
    expect(geometryCommandsSource).not.toMatch(/layer\.bulkDelete/);
  });

  it("power/light/vent/staff are still absent from both migrated clearSheet sets (itemLine.bulkDelete exists in core but is not wired into clearSheet yet — PHASE 1A-2C2D3E4D)", () => {
    const PLAN_PAGE_FILE = join(REPO, "src", "pages", "admin", "PlanPage.jsx");
    const planPageSource = readFileSync(PLAN_PAGE_FILE, "utf8");
    expect(planPageSource).toMatch(/const MIGRATED_ITEM_CLEAR_LAYER_IDS = \["racks", "water", "sockets", "sanitary", "furn", "climate"\];/);
    expect(planPageSource).toMatch(/const MIGRATED_LINE_CLEAR_LAYER_IDS = \["drain", "irrigation"\];/);
    for (const layer of ["power", "light", "vent", "staff"]) {
      expect(planPageSource).not.toMatch(new RegExp(`MIGRATED_ITEM_CLEAR_LAYER_IDS = \\[[^\\]]*"${layer}"`));
      expect(planPageSource).not.toMatch(new RegExp(`MIGRATED_LINE_CLEAR_LAYER_IDS = \\[[^\\]]*"${layer}"`));
    }
  });
});

/**
 * PHASE 1A-2C2D3E4C — canonical combined item+line delete command
 * (itemLine.bulkDelete). Core-only: no PlanPage wiring, no clearSheet
 * migration, no confirmation helper, no power/light/vent/staff changes —
 * those remain PHASE 1A-2C2D3E4D. The combined wrapper
 * (deleteItemsAndLinesFromPlan) calls the already-accepted
 * computeItemRemoval/computeLineRemoval primitives against the SAME
 * original plan and runs runEngineeringSync exactly once — it does not
 * call deleteItemsFromPlan/deleteLinesFromPlan (each of which would run
 * its own sync pass) or recurse into executeGeometryCommand.
 */
describe("PHASE 1A-2C2D3E4C — combined item+line delete command", () => {
  const GEOMETRY_COMMANDS_FILE = join(PLANNER_ROOT, "commands", "geometryCommands.js");
  const geometryCommandsSource = readFileSync(GEOMETRY_COMMANDS_FILE, "utf8");
  const PLAN_PAGE_FILE = join(REPO, "src", "pages", "admin", "PlanPage.jsx");
  const planPageSource = readFileSync(PLAN_PAGE_FILE, "utf8");

  function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  function extractBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    expect(start, `marker not found: ${startMarker}`).toBeGreaterThanOrEqual(0);
    const end = source.indexOf(endMarker, start);
    expect(end, `end marker not found: ${endMarker}`).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  const codeOnly = stripComments(geometryCommandsSource);

  it("itemLine.bulkDelete is registered in HANDLERS exactly once", () => {
    expect((geometryCommandsSource.match(/"itemLine\.bulkDelete":\s*handleItemLineBulkDelete,/g) || []).length).toBe(1);
  });

  it("handleItemLineBulkDelete and deleteItemsAndLinesFromPlan each exist exactly once", () => {
    expect((codeOnly.match(/function\s+handleItemLineBulkDelete\s*\(/g) || []).length).toBe(1);
    expect((codeOnly.match(/function\s+deleteItemsAndLinesFromPlan\s*\(/g) || []).length).toBe(1);
  });

  it("the combined wrapper calls computeItemRemoval and computeLineRemoval, both against the same original plan parameter (not against each other's output)", () => {
    const body = extractBetween(codeOnly, "function deleteItemsAndLinesFromPlan(", "\nfunction handleItemLineBulkDelete(");
    expect(body).toMatch(/computeItemRemoval\s*\(\s*plan\s*,\s*itemIds\s*\)/);
    expect(body).toMatch(/computeLineRemoval\s*\(\s*plan\s*,\s*lineIds\s*\)/);
  });

  it("the combined wrapper calls runEngineeringSync exactly once", () => {
    const body = extractBetween(codeOnly, "function deleteItemsAndLinesFromPlan(", "\nfunction handleItemLineBulkDelete(");
    expect((body.match(/\brunEngineeringSync\s*\(/g) || []).length).toBe(1);
  });

  it("the combined wrapper does not call deleteItemsFromPlan, deleteLinesFromPlan, executeGeometryCommand, or any public command dispatch", () => {
    const body = extractBetween(codeOnly, "function deleteItemsAndLinesFromPlan(", "\nfunction handleItemLineBulkDelete(");
    expect(body).not.toMatch(/\bdeleteItemsFromPlan\s*\(/);
    expect(body).not.toMatch(/\bdeleteLinesFromPlan\s*\(/);
    expect(body).not.toMatch(/\bexecuteGeometryCommand\s*\(/);
    expect(body).not.toMatch(/type:\s*["']item\.bulkDelete["']/);
    expect(body).not.toMatch(/type:\s*["']line\.bulkDelete["']/);
  });

  it("handleItemLineBulkDelete is thin: calls the combined wrapper, not the primitives or the single-collection wrappers directly", () => {
    const body = extractBetween(codeOnly, "function handleItemLineBulkDelete(", "\nconst HANDLERS = {");
    expect(body).toMatch(/deleteItemsAndLinesFromPlan\s*\(/);
    expect(body).not.toMatch(/computeItemRemoval\s*\(/);
    expect(body).not.toMatch(/computeLineRemoval\s*\(/);
    expect(body).not.toMatch(/\bdeleteItemsFromPlan\s*\(/);
    expect(body).not.toMatch(/\bdeleteLinesFromPlan\s*\(/);
  });

  it("the combined command validates both fields as required arrays, rejecting missing/non-array/both-empty as GEOMETRY_COMMAND_INVALID", () => {
    const body = extractBetween(codeOnly, "function handleItemLineBulkDelete(", "\nconst HANDLERS = {");
    expect(body).toMatch(/Array\.isArray\(itemIds\)/);
    expect(body).toMatch(/Array\.isArray\(lineIds\)/);
    expect(body).toMatch(/GEOMETRY_COMMAND_INVALID/);
    expect(body).toMatch(/GEOMETRY_COMMAND_NO_TARGET/);
  });

  it("neither the combined wrapper nor the handler reference UI layer/sheet semantics (power/light/vent/climate/staff/room/partitions)", () => {
    const wrapperBody = extractBetween(codeOnly, "function deleteItemsAndLinesFromPlan(", "\nfunction handleItemLineBulkDelete(");
    const handlerBody = extractBetween(codeOnly, "function handleItemLineBulkDelete(", "\nconst HANDLERS = {");
    for (const layer of ["power", "light", "vent", "climate", "staff", "room", "partitions"]) {
      expect(wrapperBody).not.toMatch(new RegExp(`["']${layer}["']`));
      expect(handlerBody).not.toMatch(new RegExp(`["']${layer}["']`));
    }
  });

  it("applyItemLineBulkDelete leaf helper exists and dispatches the canonical itemLine.bulkDelete command type", () => {
    const helperSource = readFileSync(join(PLANNER_ROOT, "ui", "applyItemLineBulkDelete.js"), "utf8");
    expect(helperSource).toMatch(/type:\s*["']itemLine\.bulkDelete["']/);
  });

  it("applyItemLineBulkDelete does not import React, DOM, HistoryModel, geometryCommands, or PlanPage", () => {
    const helperSource = readFileSync(join(PLANNER_ROOT, "ui", "applyItemLineBulkDelete.js"), "utf8");
    expect(helperSource).not.toMatch(/from\s*["']react/);
    expect(helperSource).not.toMatch(/from\s*["'][^"']*historyModel\.js["']/);
    expect(helperSource).not.toMatch(/from\s*["'][^"']*commands\/geometryCommands\.js["']/);
    expect(helperSource).not.toMatch(/from\s*["'][^"']*PlanPage/);
    expect(helperSource).not.toMatch(/\bwindow\./);
    expect(helperSource).not.toMatch(/\bdocument\./);
  });

  it("REQUIRED FIX F-01: applyItemLineBulkDelete no longer contains the generic Array.isArray(value) ? value : [] coercion that masked malformed input as omission", () => {
    const helperSource = readFileSync(join(PLANNER_ROOT, "ui", "applyItemLineBulkDelete.js"), "utf8");
    expect(helperSource).not.toMatch(/Array\.isArray\(itemIds\)\s*\?\s*itemIds\s*:\s*\[\]/);
    expect(helperSource).not.toMatch(/Array\.isArray\(lineIds\)\s*\?\s*lineIds\s*:\s*\[\]/);
    expect(helperSource).toMatch(/itemIds\s*===\s*undefined/);
    expect(helperSource).toMatch(/lineIds\s*===\s*undefined/);
  });

  it("REQUIRED FIX F-01 (runtime proof): a malformed non-array collection never dispatches, even when the other collection is a valid non-empty array — the real, previously-reproduced bug", async () => {
    const { applyItemLineBulkDelete } = await import("../src/planner/ui/applyItemLineBulkDelete.js");
    let calls = 0;
    const runGeometryCommand = () => { calls += 1; return { ok: true, changed: true }; };

    expect(applyItemLineBulkDelete({ itemIds: "i1", lineIds: ["l1"], runGeometryCommand })).toEqual({ status: "no-target", result: null });
    expect(calls).toBe(0);

    expect(applyItemLineBulkDelete({ itemIds: ["i1"], lineIds: "l1", runGeometryCommand })).toEqual({ status: "no-target", result: null });
    expect(calls).toBe(0);

    // Genuine omission (undefined) is the only value that safely defaults to [].
    const result = applyItemLineBulkDelete({ itemIds: ["i1"], runGeometryCommand });
    expect(result.status).toBe("success");
    expect(calls).toBe(1);
  });

  it("PlanPage.jsx does not import applyItemLineBulkDelete directly (it reaches the combined command only through applyCombinedLayerClear, see PHASE 1A-2C2D3E4D's own boundary block below)", () => {
    expect(planPageSource).not.toMatch(/from\s*["'][^"']*ui\/applyItemLineBulkDelete\.js["']/);
  });

  it("itemLine.bulkDelete is the exactly-one combined command path (no second/alias entry point)", () => {
    const registrations = geometryCommandsSource.match(/handleItemLineBulkDelete/g) || [];
    // exactly 2 occurrences expected: the function definition itself, and
    // its one HANDLERS registration — a second registration under a
    // different command-type string would push this above 2.
    expect(registrations.length).toBe(2);
  });
});

/**
 * PHASE 1A-2C2D3E4D — combined power/light/vent clearSheet wiring.
 * itemLine.bulkDelete (core, unchanged by this phase) is reached from
 * clearSheet through a factored-out pure orchestration helper
 * (applyCombinedLayerClear.js), which itself composes
 * combinedLayerClearSummary.js (counts/IDs) + applyItemLineBulkDelete.js
 * (dispatch) — not a direct import of either from PlanPage.jsx. This keeps
 * the same "leaf helper does the work, PlanPage only wires it up" shape as
 * every other migrated clearSheet branch, while making the full flow
 * (empty-check/confirm/live-plan-race/dispatch) unit-testable without
 * rendering PlanPage.jsx (see tests/plannerCombinedLayerClear.test.js).
 * staff/climate/drain/irrigation/room/partitions are untouched by this
 * phase.
 */
describe("PHASE 1A-2C2D3E4D — combined power/light/vent clearSheet wiring", () => {
  const PLAN_PAGE_FILE = join(REPO, "src", "pages", "admin", "PlanPage.jsx");
  const planPageSource = readFileSync(PLAN_PAGE_FILE, "utf8");

  function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  function extractBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    expect(start, `marker not found: ${startMarker}`).toBeGreaterThanOrEqual(0);
    const end = source.indexOf(endMarker, start);
    expect(end, `end marker not found: ${endMarker}`).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  function combinedBranchBody() {
    return extractBetween(
      planPageSource,
      "if (MIGRATED_COMBINED_CLEAR_LAYER_IDS.includes(active)) {",
      "const name = layerById(active).name;",
    );
  }

  it("MIGRATED_COMBINED_CLEAR_LAYER_IDS is exactly power/light/vent, not built dynamically from LINE_LAYER_IDS/ITEM_LAYER_IDS", () => {
    expect(planPageSource).toMatch(/const MIGRATED_COMBINED_CLEAR_LAYER_IDS = \["power", "light", "vent"\];/);
  });

  it("staff is absent from MIGRATED_COMBINED_CLEAR_LAYER_IDS (no staff migration in this phase)", () => {
    expect(planPageSource).not.toMatch(/MIGRATED_COMBINED_CLEAR_LAYER_IDS = \[[^\]]*"staff"/);
  });

  it("climate remains item-only migrated (MIGRATED_ITEM_CLEAR_LAYER_IDS unchanged); drain/irrigation remain line-only migrated (MIGRATED_LINE_CLEAR_LAYER_IDS unchanged)", () => {
    expect(planPageSource).toMatch(/const MIGRATED_ITEM_CLEAR_LAYER_IDS = \["racks", "water", "sockets", "sanitary", "furn", "climate"\];/);
    expect(planPageSource).toMatch(/const MIGRATED_LINE_CLEAR_LAYER_IDS = \["drain", "irrigation"\];/);
  });

  it("the combined branch is checked before the generic per-sheet confirm (and therefore before partitions/item-only/line-only/legacy fallback, all of which sit after that confirm)", () => {
    const combinedIdx = planPageSource.indexOf("if (MIGRATED_COMBINED_CLEAR_LAYER_IDS.includes(active)) {");
    const genericConfirmIdx = planPageSource.indexOf("const name = layerById(active).name;");
    const legacyFallbackIdx = planPageSource.indexOf("if (LINE_LAYER_IDS.includes(active)) next.lines");
    expect(combinedIdx).toBeGreaterThan(-1);
    expect(genericConfirmIdx).toBeGreaterThan(combinedIdx);
    expect(legacyFallbackIdx).toBeGreaterThan(genericConfirmIdx);
  });

  it("the combined branch routes through applyCombinedLayerClear, with no competing direct-mutation path and no separate item/line helper calls", () => {
    const body = stripComments(combinedBranchBody());
    expect(body).toMatch(/applyCombinedLayerClear\s*\(/);
    expect(body).not.toMatch(/\bsetPlan\s*\(/);
    expect(body).not.toMatch(/\bapplyItemBulkDelete\s*\(/);
    expect(body).not.toMatch(/\bapplyLineBulkDelete\s*\(/);
    expect(body).not.toMatch(/\bapplyItemLineBulkDelete\s*\(/);
    expect(body).not.toMatch(/\.filter\(\(it\)\s*=>\s*!?it\.layer/);
    expect(body).not.toMatch(/\.filter\(\(l(?:ine)?\)\s*=>\s*!?l(?:ine)?\.layer/);
    expect(body).not.toMatch(/\bsyncEngineeringPlan\s*\(/);
  });

  it("the combined branch passes getCurrentPlan and layerById(active).name through to applyCombinedLayerClear (live-plan reads and count-based confirm both live inside the helper, not duplicated in PlanPage)", () => {
    const body = stripComments(combinedBranchBody());
    expect(body).toMatch(/getCurrentPlan\s*,/);
    expect(body).toMatch(/layerId:\s*active/);
    expect(body).toMatch(/layerLabel:\s*layerById\(active\)\.name/);
    expect(body).toMatch(/confirmFn:/);
    expect(body).toMatch(/runGeometryCommand/);
  });

  it("selection cleanup in the combined branch is status-based, covering the helper's own status vocabulary (including \"empty\")", () => {
    const body = stripComments(combinedBranchBody());
    expect(body).toMatch(/status === "success"/);
    expect(body).toMatch(/status === "noop"/);
    expect(body).toMatch(/status === "no-target"/);
    expect(body).toMatch(/status === "empty"/);
    expect(body).toMatch(/setSel\(null\)/);
  });

  it("the combined branch returns early and never falls through to the legacy setPlan block", () => {
    const body = stripComments(combinedBranchBody());
    expect(body.trim().replace(/\}\s*$/, "").trim().endsWith("return;")).toBe(true);
  });

  it("PlanPage.jsx imports applyCombinedLayerClear (and no longer imports applyItemLineBulkDelete/combinedLayerClearSummary directly)", () => {
    expect(planPageSource).toMatch(/from\s*["'][^"']*ui\/applyCombinedLayerClear\.js["']/);
    expect(planPageSource).not.toMatch(/from\s*["'][^"']*ui\/combinedLayerClearSummary\.js["']/);
  });

  it("applyCombinedLayerClear itself composes combinedLayerClearSummary + applyItemLineBulkDelete — the real combined command IS reached, just not via a direct PlanPage import", () => {
    const helperSource = readFileSync(join(PLANNER_ROOT, "ui", "applyCombinedLayerClear.js"), "utf8");
    const codeOnly = stripComments(helperSource);
    expect(helperSource).toMatch(/from\s*["']\.\/combinedLayerClearSummary\.js["']/);
    expect(helperSource).toMatch(/from\s*["']\.\/applyItemLineBulkDelete\.js["']/);
    expect(codeOnly).toMatch(/applyItemLineBulkDelete\s*\(/);
    const dispatchCalls = (codeOnly.match(/applyItemLineBulkDelete\s*\(/g) || []).length;
    expect(dispatchCalls).toBe(1);
  });

  it("applyCombinedLayerClear does not import React, DOM, HistoryModel, geometryCommands, or PlanPage, and never calls confirmFn (window.confirm) more than once per invocation", () => {
    const helperSource = readFileSync(join(PLANNER_ROOT, "ui", "applyCombinedLayerClear.js"), "utf8");
    const codeOnly = stripComments(helperSource);
    expect(helperSource).not.toMatch(/from\s*["']react/);
    expect(helperSource).not.toMatch(/from\s*["'][^"']*historyModel\.js["']/);
    expect(helperSource).not.toMatch(/from\s*["'][^"']*commands\/geometryCommands\.js["']/);
    expect(helperSource).not.toMatch(/from\s*["'][^"']*PlanPage/);
    expect(codeOnly).not.toMatch(/\bwindow\./);
    expect(codeOnly).not.toMatch(/\bdocument\./);
    const confirmCalls = (codeOnly.match(/confirmFn\s*\(/g) || []).length;
    expect(confirmCalls).toBe(1);
  });

  it("combinedLayerClearSummary.js is a pure leaf: no React/DOM/HistoryModel/geometryCommands/dispatcher, and uses production migrateLayerId rather than a re-derived alias map", () => {
    const helperSource = readFileSync(join(PLANNER_ROOT, "ui", "combinedLayerClearSummary.js"), "utf8");
    expect(helperSource).not.toMatch(/from\s*["']react/);
    expect(helperSource).not.toMatch(/from\s*["'][^"']*historyModel\.js["']/);
    expect(helperSource).not.toMatch(/from\s*["'][^"']*commands\/geometryCommands\.js["']/);
    expect(helperSource).not.toMatch(/\bwindow\./);
    expect(helperSource).not.toMatch(/\bdocument\./);
    expect(helperSource).toMatch(/from\s*["']\.\.\/catalog\.js["']/);
    expect(helperSource).toMatch(/migrateLayerId\s*\(/);
  });

  it("power/light/vent clearSheet branches no longer fall through to the legacy direct-setPlan block (that block's LINE_LAYER_IDS/ITEM_LAYER_IDS fallback text is unchanged, but power/light/vent now return early above it)", () => {
    const legacyBody = stripComments(
      extractBetween(planPageSource, "setPlan((p) => {\r\n      const next = { ...p };", "  };"),
    );
    // The legacy fallback text itself is untouched (still generically
    // matches all of LINE_LAYER_IDS/ITEM_LAYER_IDS) — the guarantee that
    // power/light/vent never reach it comes from the branch-ordering test
    // above, not from removing power/light/vent out of these lists (which
    // would be a layer-classification change out of scope for this phase).
    expect(legacyBody).toMatch(/LINE_LAYER_IDS\.includes\(active\)/);
    expect(legacyBody).toMatch(/ITEM_LAYER_IDS\.includes\(active\)/);
  });
});
