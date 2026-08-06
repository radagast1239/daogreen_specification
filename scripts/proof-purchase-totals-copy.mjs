/**
 * Read-only proof of purchase totals against a WAL-safe production DB copy.
 * Usage: node scripts/proof-purchase-totals-copy.mjs <path-to.db>
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { calculatePurchaseSummary } from "../shared/moneyCalc.js";
import { projectTotals as frontendTotals } from "../src/store/helpers.js";
import { projectTotals as backendTotals } from "../backend/src/services/buildItems.js";
import { normalizePurchaseStatus } from "../shared/purchaseStatusRules.js";
import { rowToItem } from "../backend/src/db.js";
import { clientPurchaseDashboard } from "../shared/clientPurchaseStats.js";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: node scripts/proof-purchase-totals-copy.mjs <db>");
  process.exit(1);
}

const TARGETS = [
  "p_oZBUfqsh_S",
  "p_7W_SW295gK",
  "p_FR0f5yxTRp",
  "p_9pf9s9W-kA",
  "p_1Sa3IEbCy4",
];

const db = new DatabaseSync(path.resolve(dbPath), { readOnly: true });

function loadProject(id) {
  const project = db.prepare("SELECT id, name, currency FROM projects WHERE id = ?").get(id);
  if (!project) return null;
  const rows = db.prepare("SELECT * FROM project_items WHERE project_id = ?").all(id);
  const items = rows.map((r) => rowToItem(r));
  return {
    id: project.id,
    name: project.name,
    currency: project.currency || "₽",
    items,
  };
}

const results = [];
for (const id of TARGETS) {
  const project = loadProject(id);
  if (!project) {
    results.push({ id, error: "not found" });
    continue;
  }
  const summary = calculatePurchaseSummary(project.items);
  const fe = frontendTotals(project);
  const be = backendTotals(project.items);
  const dash = clientPurchaseDashboard(project.items);
  const statusCounts = {};
  for (const it of project.items) {
    const s = normalizePurchaseStatus(it);
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  }
  const equal =
    fe.spent === be.spent &&
    fe.remaining === be.remaining &&
    fe.progress === be.progress &&
    fe.total === be.total &&
    fe.doneCount === be.doneCount &&
    dash.boughtSum === fe.spent &&
    dash.remainingSum === fe.remaining &&
    dash.progress === fe.progress;

  results.push({
    id,
    name: project.name,
    currency: project.currency,
    itemCount: project.items.length,
    statusCounts,
    pool: summary.purchasePoolCount,
    orderedCount: summary.orderedCount,
    orderedGross: summary.orderedGross,
    boughtCount: summary.boughtCount,
    boughtGross: summary.boughtGross,
    deliveredCount: summary.deliveredCount,
    deliveredGross: summary.deliveredGross,
    haveCount: summary.haveCount,
    spent: summary.spentGross,
    remaining: summary.remainingGross,
    progress: summary.progressPercent,
    completedCount: summary.completedCount,
    frontend: {
      spent: fe.spent,
      remaining: fe.remaining,
      progress: fe.progress,
      total: fe.total,
      doneCount: fe.doneCount,
    },
    backend: {
      spent: be.spent,
      remaining: be.remaining,
      progress: be.progress,
      total: be.total,
      doneCount: be.doneCount,
    },
    dashboard: {
      boughtSum: dash.boughtSum,
      remainingSum: dash.remainingSum,
      progress: dash.progress,
      boughtCount: dash.boughtCount,
    },
    equality: equal,
  });
}

const oz = results.find((r) => r.id === "p_oZBUfqsh_S");
console.log(JSON.stringify({
  dbPath: path.resolve(dbPath),
  expectedRemaining_p_oZBUfqsh_S: 221448,
  actualRemaining_p_oZBUfqsh_S: oz?.remaining,
  remainingMatch: oz?.remaining === 221448,
  allEqual: results.every((r) => r.equality === true),
  results,
}, null, 2));
