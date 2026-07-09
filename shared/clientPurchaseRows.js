import { lineVisibleToClient, isPurchasableLineType, resolveItemType } from "./itemTypes.js";
import { enrichProjectItemFromMaterial } from "./frameBomProjectItems.js";
import { structuredClientNote } from "./structuredClientNote.js";

export const NFT_CHANNEL_CLIENT_NOTE = "Используется как NFT-канал в схеме стеллажа.";

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
  return stripClientTechnicalFields(enrichClientPurchaseItem(item, materials));
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

/** Строка «Наименование» для клиентского PDF (имя + примечание, без техполей). */
export function buildClientPdfRowLabel(row) {
  const rep = row?.sourceItems?.[0] || row;
  const name = String(row?.name || rep?.name || "").trim();
  const note = String(row?.clientNote || resolveClientItemNote(rep) || "").trim();
  if (!note || name.includes(note)) return name || "—";
  return [name, note].filter(Boolean).join("\n");
}

export function clientPdfRowHasTechnicalFields(row) {
  const blob = JSON.stringify(row || {});
  return /frame_bom|sourceKey|source_key|drawingId|moduleRackKey/i.test(blob);
}
