/**
 * PHASE 0A — read-only отчёт по графу зависимостей планировщика.
 *
 * Использование:
 *   node scripts/plannerDepGraph.mjs           # печать отчёта
 *   node scripts/plannerDepGraph.mjs --allowlist   # печать allowlist-ключей (по одному в строке)
 *
 * Ничего не меняет в репозитории. Служит для baseline и генерации allowlist
 * для tests/plannerDependencyBoundary.test.js.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildPlannerGraph,
  findCycles,
  violationKey,
} from "../tests/helpers/plannerImportGraph.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const PLANNER_ROOT = join(REPO, "src", "planner");
const CORE_ROOT = join(PLANNER_ROOT, "core");

const graph = buildPlannerGraph(PLANNER_ROOT, CORE_ROOT);
const cycles = findCycles(graph.edges, (x) => x);

if (process.argv.includes("--allowlist")) {
  for (const v of graph.coreOutViolations) console.log(violationKey(v));
  process.exit(0);
}

const largest = cycles[0] || [];

console.log("PHASE 0A — Planner dependency graph baseline");
console.log("=".repeat(52));
console.log(`Файлов (src/planner):        ${graph.fileCount}`);
console.log(`Рёбер import (relative):     ${graph.edgeCount}`);
console.log(`Нетривиальных циклов (SCC):  ${cycles.length}`);
console.log(`Крупнейший цикл (файлов):    ${largest.length}`);
console.log(`core -> вне-core нарушений:  ${graph.coreOutViolations.length}`);
console.log(`core -> react нарушений:     ${graph.coreReactViolations.length}`);
console.log("");

console.log("CORE → LEGACY/UI (нарушения границы CAD Core):");
for (const v of graph.coreOutViolations) {
  console.log(`  ${v.from}  →  ${v.to}   (import "${v.spec}")`);
}
console.log("");

if (largest.length) {
  console.log(`Крупнейший цикл (${largest.length} файлов):`);
  for (const f of largest) console.log(`  ${f}`);
  console.log("");
}

if (cycles.length > 1) {
  console.log(`Остальные циклы: ${cycles.length - 1}`);
  for (const c of cycles.slice(1)) {
    console.log(`  [${c.length}] ${c.join(", ")}`);
  }
}
