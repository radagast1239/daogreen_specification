/** Сводка клиентской выдачи — те же правила, что PDF / Excel / client link. */

import {
  lineVisibleToClient,
  isPurchasableLineType,
  resolveItemType,
  lineContributesToSum,
} from "./itemTypes.js";
import {
  prepareClientPurchaseItems,
  formatClientLineTotal,
  formatPipeCutsNote,
} from "./clientPurchaseRows.js";
import {
  normalizePurchaseStatus,
  PURCHASE_STATUS,
  isClosedPurchaseStatusId,
} from "./purchaseStatusRules.js";
import { isFrameBomLine, FRAME_BOM_ADMIN_SOURCE_LABEL, countDedupedFrameBomItems } from "./frameBomProjectItems.js";
import { resolveClientSection, getClientSectionLabelMap } from "./clientSections.js";
import { buildClientPurchaseMergedRows } from "./clientPurchaseMerged.js";

function purchasablePool(items) {
  return (items || []).filter((it) => {
    if (it.includedInProject === false || it.enabled === false) return false;
    return isPurchasableLineType(resolveItemType(it));
  });
}

function lineGross(it) {
  const net = (Number(it.qty) || 0) * (Number(it.price) || 0);
  return net + net * ((Number(it.vatRate) || 0) / 100);
}

export function resolveClientDeliverySourceLabel(item) {
  if (item?.frameBom || isFrameBomLine(item)) return FRAME_BOM_ADMIN_SOURCE_LABEL;
  return "Из спецификации";
}

/**
 * @param {object[]} items
 * @param {object[]} [materials]
 * @param {{ stellageConfigs?: object[] }} [options]
 */
export function buildClientPurchaseSummary(items, materials = [], options = {}) {
  const pool = purchasablePool(items);
  const clientItems = prepareClientPurchaseItems(items, materials);
  const mergedRows = buildClientPurchaseMergedRows(clientItems, {
    stellageConfigs: options.stellageConfigs || [],
  });

  let hiddenItems = 0;
  let noPrice = 0;
  let noLink = 0;
  let noSupplier = 0;
  let frameBomItems = 0;
  let purchaseClosed = 0;

  for (const it of pool) {
    if (!lineVisibleToClient(it)) hiddenItems += 1;
    if (!(Number(it.price) > 0)) noPrice += 1;
    if (!(it.link || "").trim()) noLink += 1;
    if (!(it.supplier || "").trim()) noSupplier += 1;
    if (isFrameBomLine(it)) frameBomItems += 1;
  }

  for (const it of clientItems) {
    if (isClosedPurchaseStatusId(normalizePurchaseStatus(it))) purchaseClosed += 1;
  }

  let purchaseTotal = 0;
  let pricedClientRows = 0;
  for (const row of mergedRows) {
    const total = formatClientLineTotal(row);
    if (typeof total === "number" && total > 0) {
      purchaseTotal += total;
      pricedClientRows += 1;
    }
  }

  const sectionLabels = getClientSectionLabelMap();
  const bySection = new Map();
  for (const row of mergedRows) {
    const rep = row.sourceItems?.[0] || row;
    const sec = resolveClientSection(rep);
    const key = sec.section || "other";
    if (!bySection.has(key)) {
      bySection.set(key, {
        sectionId: key,
        label: sectionLabels[key] || sec.label || key,
        count: 0,
        total: 0,
      });
    }
    const bucket = bySection.get(key);
    bucket.count += 1;
    const total = formatClientLineTotal(row);
    if (typeof total === "number" && total > 0) bucket.total += total;
  }

  return {
    totalClientItems: clientItems.length,
    mergedClientRows: mergedRows.length,
    hiddenItems,
    noPrice: clientItems.filter((it) => !(Number(it.price) > 0)).length,
    noLink: clientItems.filter((it) => !(it.link || "").trim()).length,
    noSupplier: clientItems.filter((it) => !(it.supplier || "").trim()).length,
    frameBomItems: countDedupedFrameBomItems(pool.filter((it) => isFrameBomLine(it))),
    purchaseTotal,
    purchaseClosed,
    purchaseTotalItems: clientItems.length,
    pricedClientRows,
    bySection: [...bySection.values()].sort((a, b) => b.total - a.total),
    mergedRows,
    clientItems,
  };
}

/**
 * Строки предпросмотра «Что увидит клиент» — из merged rows (как PDF/Excel).
 * @param {object[]} items
 * @param {object[]} [materials]
 * @param {{ stellageConfigs?: object[] }} [options]
 */
export function buildClientDeliveryPreviewRows(items, materials = [], options = {}) {
  const { mergedRows } = buildClientPurchaseSummary(items, materials, options);
  const sectionLabels = getClientSectionLabelMap();

  return mergedRows.map((row) => {
    const rep = row.sourceItems?.[0] || row;
    const sec = resolveClientSection(rep);
    const pipeNote = row.pipeCuts?.length ? formatPipeCutsNote(row.pipeCuts) : "";
    const note = String(row.clientNote || "").trim();
    let extraNote = "";
    if (pipeNote) extraNote = pipeNote;
    else if (/nft-канал/i.test(note)) extraNote = note.includes("NFT") ? note : "Используется как NFT-канал";

    return {
      mergeKey: row.mergeKey,
      section: sectionLabels[sec.section] || sec.label || sec.section || "—",
      subsection: rep.clientSubsection || sec.subsection || "—",
      name: row.name || rep.name || "—",
      qty: row.qty,
      unit: row.unit || rep.unit || "шт.",
      price: row.price,
      priceLabel: formatClientLineTotal(row) === "" ? "Без цены" : row.price,
      total: formatClientLineTotal(row),
      supplier: (row.supplier || "").trim() || "—",
      status: row.status,
      statusLabel: row.statusLabel || row.statusSummary?.statusLabel || "—",
      sourceLabel: resolveClientDeliverySourceLabel(rep),
      note: extraNote,
      sourceItems: row.sourceItems,
    };
  });
}

/** Закрытые статусы закупки для фильтра. */
export const PURCHASE_CLOSED_FILTER_STATUSES = new Set([
  PURCHASE_STATUS.BOUGHT,
  PURCHASE_STATUS.DELIVERED,
  PURCHASE_STATUS.HAVE,
]);

export function isClientPurchaseTotalRow(row) {
  return lineContributesToSum(row?.sourceItems?.[0] || row);
}
