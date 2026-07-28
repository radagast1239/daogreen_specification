/** Parity report: admin / client / PDF / Excel totals and composition. */

import { buildClientPurchaseMergedRows } from "./clientPurchaseMerged.js";
import { lineContributesToSum, lineVisibleToClient } from "./itemTypes.js";
import { computeLineMoney, roundMoney } from "./moneyCalc.js";

function lineGross(it) {
  return computeLineMoney(it, { priceMode: "actual" }).gross;
}

function adminPool(project) {
  return (project?.items || []).filter((it) => it.includedInProject !== false && it.enabled !== false);
}

function clientPool(project, releaseSnapshot) {
  const items = releaseSnapshot?.items || project?.items || [];
  return items.filter(
    (it) =>
      it.includedInProject !== false &&
      it.enabled !== false &&
      lineVisibleToClient(it),
  );
}

function summarizeRows(rows) {
  let total = 0;
  for (const it of rows) total += lineGross(it);
  return {
    count: rows.length,
    total: roundMoney(total),
  };
}

function summarizeMerged(rows) {
  let total = 0;
  for (const row of rows) {
    if (!lineContributesToSum(row)) continue;
    total += lineGross(row);
  }
  return {
    count: rows.length,
    total: roundMoney(total),
  };
}

/**
 * @param {object} project
 * @param {object[]} [materials]
 * @param {object|null} [releaseSnapshot] — { items: [...] } from spec_versions
 */
export function buildProjectParityReport(project, materials = [], releaseSnapshot = null) {
  const adminItems = adminPool(project);
  const clientItems = clientPool(project, releaseSnapshot);
  const merged = buildClientPurchaseMergedRows(clientItems);

  const admin = summarizeRows(adminItems);
  const client = summarizeMerged(merged);
  const pdf = client;
  const excel = client;

  const differences = [];
  if (admin.total !== client.total) {
    differences.push({
      kind: "total_mismatch",
      admin: admin.total,
      client: client.total,
      delta: client.total - admin.total,
    });
  }
  if (merged.length !== clientItems.filter(lineContributesToSum).length) {
    differences.push({
      kind: "merge_applied",
      rawClientLines: clientItems.length,
      mergedLines: merged.length,
    });
  }

  const hiddenLeaks = (project?.items || []).filter(
    (it) => !lineVisibleToClient(it) && merged.some((m) => m.sourceIds?.includes(it.id)),
  );
  if (hiddenLeaks.length) {
    differences.push({
      kind: "hidden_in_client_merge",
      count: hiddenLeaks.length,
      ids: hiddenLeaks.map((it) => it.id),
    });
  }

  return {
    admin,
    client,
    pdf,
    excel,
    differences,
    materialsCount: materials?.length || 0,
    usesReleaseSnapshot: Boolean(releaseSnapshot?.items?.length),
  };
}
