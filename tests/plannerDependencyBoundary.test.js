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
import {
  buildPlannerGraph,
  violationKey,
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
  // wallCommands.js composes the existing wallNetwork.js primitives (add/
  // move/split/delete/merge) into one structured-result command API — same
  // established pattern as wallCommit.js above, not a new kind of coupling.
  "core/walls/wallCommands.js -> wallNetwork.js",
  // PlanPage adapter: materialize + T-junction connect uses resolvePlanWalls.
  "core/walls/applyWallCommand.js -> wallNetwork.js",
  // Live draw topology commit resolves hosts via resolvePlanWalls / findNodeIdAt.
  "core/walls/wallDrawTopology.js -> wallNetwork.js",
  // Pass-through scan reuses resolvePlanWalls for node-derived endpoints.
  "core/walls/passThroughCandidateScan.js -> wallNetwork.js",
  "core/walls/wallJoins.js -> wallJoins.js",
  "core/walls/wallOps.js -> doorTypes.js",
  "core/walls/wallOps.js -> wallParallelGeometry.js",
  "core/walls/wallRender.js -> wallParallelGeometry.js",
  // renderedContours.js deliberately wraps the renderer's own pipeline
  // (wallGeometryMap -> buildWallMassGeometry) so the dimension generator
  // measures the exact geometry wallRender draws — same established pattern
  // as generateWallDimensions.js -> buildWallGeometry.js / wallNetwork.js above.
  "core/walls/renderedContours.js -> buildWallGeometry.js",
  "core/walls/renderedContours.js -> wallNetwork.js",
  // LIVE / LIVE4 live metrology + selected physical spans reuse renderer geometry.
  "core/walls/liveWallMeasurements.js -> wallNetwork.js",
  "core/walls/liveWallMeasurements.js -> wallParallelGeometry.js",
  "core/walls/selectedWallPhysicalSpans.js -> buildWallGeometry.js",
  "core/walls/selectedWallPhysicalSpans.js -> wallNetwork.js",
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
