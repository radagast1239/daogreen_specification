/**
 * In-memory status transition proof using production-copy project items.
 * Does not write to any DB.
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { rowToItem } from "../backend/src/db.js";
import { calculatePurchaseSummary } from "../shared/moneyCalc.js";
import { projectTotals as frontendTotals } from "../src/store/helpers.js";
import { projectTotals as backendTotals } from "../backend/src/services/buildItems.js";
import { purchaseStatusPatch } from "../shared/purchaseStatusRules.js";

const dbPath = process.argv[2];
const projectId = process.argv[3] || "p_9pf9s9W-kA";
if (!dbPath) {
  console.error("Usage: node scripts/proof-purchase-transitions.mjs <db> [projectId]");
  process.exit(1);
}

const db = new DatabaseSync(path.resolve(dbPath), { readOnly: true });
const rows = db.prepare("SELECT * FROM project_items WHERE project_id = ?").all(projectId);
const items = rows.map((r) => rowToItem(r));
const target = items.find((i) => i.status === "not_bought" && Number(i.qty) > 0 && Number(i.price) > 0);
if (!target) {
  console.error("No not_bought target");
  process.exit(1);
}

function snap(label, list) {
  const fe = frontendTotals({ currency: "₽", items: list });
  const be = backendTotals(list);
  const sum = calculatePurchaseSummary(list);
  return {
    label,
    targetStatus: list.find((i) => i.id === target.id)?.status,
    spent: sum.spentGross,
    remaining: sum.remainingGross,
    progress: sum.progressPercent,
    feBeEqual: fe.spent === be.spent && fe.remaining === be.remaining && fe.progress === be.progress,
  };
}

const base = items.map((i) => ({ ...i }));
const steps = [];
steps.push(snap("initial", base));

function apply(status) {
  return base.map((i) =>
    i.id === target.id ? { ...i, ...purchaseStatusPatch(status) } : i,
  );
}

const afterOrdered = apply("ordered");
steps.push(snap("not_bought→ordered", afterOrdered));
const afterBought = afterOrdered.map((i) =>
  i.id === target.id ? { ...i, ...purchaseStatusPatch("bought") } : i,
);
steps.push(snap("ordered→bought", afterBought));
const afterOpen = afterBought.map((i) =>
  i.id === target.id ? { ...i, ...purchaseStatusPatch("not_bought") } : i,
);
steps.push(snap("bought→not_bought", afterOpen));
const afterHave = afterOpen.map((i) =>
  i.id === target.id ? { ...i, ...purchaseStatusPatch("have") } : i,
);
steps.push(snap("not_bought→have", afterHave));
const afterHaveBack = afterHave.map((i) =>
  i.id === target.id ? { ...i, ...purchaseStatusPatch("not_bought") } : i,
);
steps.push(snap("have→not_bought", afterHaveBack));

const planned = Number(target.qty) * Number(target.price) * (1 + (Number(target.vatRate) || 0) / 100);
const init = steps[0];
const ordered = steps[1];
const bought = steps[2];
const reopen = steps[3];
const have = steps[4];
const haveBack = steps[5];

const checks = {
  orderedIncreasesSpent: ordered.spent === init.spent + planned,
  orderedDropsRemaining: ordered.remaining === init.remaining - planned,
  orderedProgressUp: ordered.progress > init.progress,
  boughtNoDoubleSpend: bought.spent === ordered.spent,
  boughtProgressSame: bought.progress === ordered.progress,
  reopenRestores: reopen.spent === init.spent && reopen.remaining === init.remaining,
  haveNoSpendChange: have.spent === reopen.spent,
  haveDropsRemaining: have.remaining === reopen.remaining - planned,
  haveProgressUp: have.progress > reopen.progress,
  haveBackRestores: haveBack.spent === init.spent && haveBack.remaining === init.remaining,
  allFeBeEqual: steps.every((s) => s.feBeEqual),
};

console.log(JSON.stringify({
  projectId,
  targetId: target.id,
  plannedLine: planned,
  steps,
  checks,
  ok: Object.values(checks).every(Boolean),
}, null, 2));
