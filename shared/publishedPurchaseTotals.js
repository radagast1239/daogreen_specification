/** Planned (published snapshot) vs actual purchase totals — do not mix labels. */

import { lineContributesToSum, lineVisibleToClient } from "./itemTypes.js";

function visiblePurchaseLines(items = []) {
  return (items || []).filter((it) => lineVisibleToClient(it) && lineContributesToSum(it));
}

function linePlannedGross(it) {
  const unit = Number(it.price) || 0;
  const net = (Number(it.qty) || 0) * unit;
  return net + net * ((Number(it.vatRate) || 0) / 100);
}

function lineActualGross(it) {
  const unit = it.actualPrice != null && it.actualPrice !== "" ? Number(it.actualPrice) : Number(it.price) || 0;
  const net = (Number(it.qty) || 0) * unit;
  return net + net * ((Number(it.vatRate) || 0) / 100);
}

/** Frozen planned total from published snapshot prices. */
export function publishedPlannedTotal(items = []) {
  let total = 0;
  for (const it of visiblePurchaseLines(items)) total += linePlannedGross(it);
  return Math.round(total);
}

/** Live actual purchase total (actualPrice overlay allowed). */
export function actualPurchaseTotal(items = []) {
  let total = 0;
  for (const it of visiblePurchaseLines(items)) total += lineActualGross(it);
  return Math.round(total);
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
