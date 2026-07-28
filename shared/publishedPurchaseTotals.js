/** Planned (published snapshot) vs actual purchase totals — do not mix labels. */

import { lineContributesToSum, lineVisibleToClient } from "./itemTypes.js";
import { computeLineMoney, roundMoney } from "./moneyCalc.js";

function visiblePurchaseLines(items = []) {
  return (items || []).filter((it) => lineVisibleToClient(it) && lineContributesToSum(it));
}

/** Frozen planned total from published snapshot prices. */
export function publishedPlannedTotal(items = []) {
  let total = 0;
  for (const it of visiblePurchaseLines(items)) {
    total += computeLineMoney(it, { priceMode: "planned" }).gross;
  }
  return roundMoney(total);
}

/** Live actual purchase total (actualPrice overlay allowed). */
export function actualPurchaseTotal(items = []) {
  let total = 0;
  for (const it of visiblePurchaseLines(items)) {
    total += computeLineMoney(it, { priceMode: "actual" }).gross;
  }
  return roundMoney(total);
}

/**
 * Overlay live purchase fields onto snapshot without mutating commercial snapshot fields.
 */
export function overlayLivePurchaseFields(snapshotItems = [], liveItems = []) {
  const liveById = new Map((liveItems || []).map((it) => [it.id, it]));
  return (snapshotItems || []).map((snap) => {
    const live = liveById.get(snap.id);
    if (!live) return { ...snap };
    return {
      ...snap,
      status: live.status ?? snap.status,
      actualPrice: live.actualPrice ?? snap.actualPrice,
      clientComment: live.clientComment ?? snap.clientComment,
    };
  });
}
