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
import { readFileSync } from "node:fs";
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
