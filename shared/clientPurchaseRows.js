import { lineVisibleToClient, isPurchasableLineType, resolveItemType, isCoolingSpecItem } from "./itemTypes.js";
import { enrichProjectItemFromMaterial, isFrameBomLine } from "./frameBomProjectItems.js";
import { structuredClientNote } from "./structuredClientNote.js";
import { pipeCutsClientNote, normalizePipeCuts } from "./profilePipeCuts.js";
import {
  formatClientPurchaseStatusLine,
  getPurchaseStatusLabel,
  normalizePurchaseStatus,
} from "./purchaseStatusRules.js";

export const NFT_CHANNEL_CLIENT_NOTE = "Используется как NFT-канал в схеме стеллажа.";
export const CLIENT_PRICE_TBD = "цена уточняется";
export const CLIENT_PRICE_MISSING = "Без цены";

/** Поля, которые не должны попадать в клиентскую ссылку / PDF / Excel. */
export const CLIENT_ITEM_TECH_FIELDS = [
  "source",
  "sourceType",
  "source_type",
  "sourceKey",
  "source_key",
  "sourceObjectIds",
  "source_object_ids",
  "internalNote",
  "techNote",
  "materialId",
  "drawingId",
  "moduleRackKey",
  "sourceRackKey",
  "source_rack_key",
  "sourceFrameDrawingId",
];

function hasNftChannelNote(text) {
  return /nft-канал/i.test(String(text || ""));
}

/** Клиентская заметка: pipeCuts, NFT-канал, structuredClientNote. */
export function resolveClientItemNote(item) {
  const structured = structuredClientNote(item);
  if (structured) return structured;

  const client = String(item?.clientNote || "").trim();
  if (client) return client;

  const tech = String(item?.techNote || "").trim();
  if (hasNftChannelNote(tech)) {
    return tech.includes(NFT_CHANNEL_CLIENT_NOTE) ? NFT_CHANNEL_CLIENT_NOTE : tech;
  }
  return "";
}

/** Подтянуть snapshot материала и заполнить clientNote для клиента. */
export function enrichClientPurchaseItem(item, materials = []) {
  const base = materials?.length ? enrichProjectItemFromMaterial(item, materials) : { ...item };
  const note = resolveClientItemNote(base);
  if (!note) return base;
  return {
    ...base,
    clientNote: note,
    comment: note,
  };
}

export function stripClientTechnicalFields(item) {
  const out = { ...item };
  for (const key of CLIENT_ITEM_TECH_FIELDS) {
    delete out[key];
  }
  return out;
}

export function prepareClientPurchaseItem(item, materials = []) {
  const frameBom = isFrameBomLine(item);
  const base = stripClientTechnicalFields(enrichClientPurchaseItem(item, materials));
  const status = normalizePurchaseStatus(base);
  return {
    ...base,
    frameBom,
    status,
    purchaseStatus: status,
    statusLabel: getPurchaseStatusLabel(status),
  };
}

export function filterClientPurchaseItems(items) {
  return (items || []).filter((it) => {
    if (!lineVisibleToClient(it)) return false;
    return isPurchasableLineType(resolveItemType(it));
  });
}

export function prepareClientPurchaseItems(items, materials = []) {
  return filterClientPurchaseItems(items).map((it) => prepareClientPurchaseItem(it, materials));
}

/** Человекочитаемый статус для merged row / Excel / UI. */
export function resolveClientPurchaseStatusLabel(rowOrItem) {
  const sum = rowOrItem?.statusSummary;
  if (sum && typeof sum === "object") {
    if (sum.mixed && sum.statusSummary) return sum.statusSummary;
    if (sum.statusLabel) return sum.statusLabel;
  }
  return getPurchaseStatusLabel(rowOrItem?.status ?? rowOrItem);
}

/** Строка «Наименование» для клиентского PDF (имя + примечание + статус, без техполей). */
export function buildClientPdfRowLabel(row) {
  const rep = row?.sourceItems?.[0] || row;
  const name = String(row?.name || rep?.name || "").trim();
  const note = String(row?.clientNote || resolveClientItemNote(rep) || "").trim();
  const statusLine = formatClientPurchaseStatusLine(row);
  const parts = [name];
  if (note && !name.includes(note)) parts.push(note);
  if (statusLine) parts.push(statusLine);
  if (!parts.filter(Boolean).length) return "—";
  return parts.join("\n");
}

export function clientPdfRowHasTechnicalFields(row) {
  const blob = JSON.stringify(row || {});
  return /frame_bom|sourceKey|source_key|drawingId|moduleRackKey/i.test(blob);
}

export function clientRowHasTechnicalFields(row) {
  return clientPdfRowHasTechnicalFields(row);
}

/** Сплит-система без заполненной цены. */
export function isClientCoolingPriceUnset(row) {
  const rep = row?.sourceItems?.[0] || row;
  if (!isCoolingSpecItem(rep)) return false;
  return !(Number(row?.price) > 0) && !(Number(row?.sumVat) > 0);
}

/** Есть ли у строки цена за единицу (не путать с бесплатным price=0 в базе без snapshot). */
export function hasClientUnitPrice(row) {
  return Number(row?.price) > 0;
}

/**
 * Цена за единицу для клиентской выдачи.
 * @returns {number|string} число или «Без цены» / «цена уточняется»
 */
export function formatClientUnitPrice(row) {
  if (isClientCoolingPriceUnset(row)) return CLIENT_PRICE_TBD;
  if (!hasClientUnitPrice(row)) return CLIENT_PRICE_MISSING;
  return Number(row.price);
}

/**
 * Сумма строки для клиентской выдачи.
 * @returns {number|string} округлённая сумма, пустая строка или «цена уточняется»
 */
export function formatClientLineTotal(row) {
  if (isClientCoolingPriceUnset(row)) return CLIENT_PRICE_TBD;
  if (!hasClientUnitPrice(row)) return "";
  const sumVat = Number(row.sumVat);
  if (Number.isFinite(sumVat) && sumVat > 0) return Math.round(sumVat);
  const qty = Number(row.qty) || 0;
  const price = Number(row.price) || 0;
  const vat = Number(row.vatRate) || 0;
  const net = qty * price;
  return Math.round(net + net * (vat / 100));
}

export function formatPipeCutsNote(pipeCuts) {
  return pipeCutsClientNote(normalizePipeCuts(pipeCuts));
}

/** Объединить уникальные клиентские примечания из нескольких sourceItems. */
export function mergeClientItemNotes(sourceItems = []) {
  const notes = [];
  const seen = new Set();
  for (const it of sourceItems) {
    const n = String(resolveClientItemNote(it) || "").trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    notes.push(n);
  }
  return notes.join("; ");
}
