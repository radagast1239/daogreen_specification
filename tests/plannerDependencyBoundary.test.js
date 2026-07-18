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
 * НЕ проверяет обратную сторону («PlanPage не импортирует низкоуровневые
 * geometry mutators напрямую») — PlanPage.jsx ещё не мигрирован на command
 * layer в этой фазе (см. RESULT — PHASE 1A, «Remaining direct mutations»).
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
