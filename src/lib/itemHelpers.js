import { DONE_STATUSES, SPECIALIST_MAP } from "../data/modules.js";
import { DEFAULT_RESPONSIBLE_ROLES } from "./referenceData.js";

export const RESPONSIBLE_OPTIONS = DEFAULT_RESPONSIBLE_ROLES;

const CATEGORY_TO_RESPONSIBLE = {
  "Полив и сантехника": "plumber",
  "Электрика и свет": "electrician",
  "Каркас и крепёж": "installer",
  "Климат и вентиляция": "installer",
  Расходники: "consumables",
  "Работы и доставка": "client",
  Прочее: "general",
};

export function defaultResponsible(category, mat = {}) {
  if (mat.isConsumable || category === "Расходники") return "consumables";
  return CATEGORY_TO_RESPONSIBLE[category] || "general";
}

export function resolveResponsible(it) {
  if (it.responsible) return it.responsible;
  return defaultResponsible(it.category, it);
}

/** URL фото */
export function itemImageUrl(it) {
  const u = it?.imageUrl || it?.photoUrl || "";
  if (!u) return "";
  if (u.startsWith("http")) return u;
  const api = import.meta.env.VITE_API_URL || "";
  return `${api}${u.startsWith("/") ? u : "/" + u}`;
}

export const VAT_RATES = [0, 5, 20];

export function lineNet(it) {
  return (Number(it.qty) || 0) * (Number(it.price) || 0);
}

export function lineVat(it) {
  return lineNet(it) * ((Number(it.vatRate) || 0) / 100);
}

export function lineGross(it) {
  return lineNet(it) + lineVat(it);
}

export function isPurchaseDone(it) {
  return DONE_STATUSES.includes(it?.status);
}

/** Склеенная строка закупки: в «куплено», если все исходные позиции куплены */
export function isMergedPurchaseDone(row) {
  return (row?.sourceItems || []).length > 0 && row.sourceItems.every((it) => isPurchaseDone(it));
}

export function splitMergedPurchaseRows(rows) {
  const todo = [];
  const bought = [];
  for (const row of rows || []) {
    (isMergedPurchaseDone(row) ? bought : todo).push(row);
  }
  return { todo, bought };
}

export function applyMergedPurchaseFilter(rows, filterId) {
  if (filterId === "all") return rows;
  return (rows || []).filter((row) => {
    const items = row.sourceItems || [];
    if (filterId === "todo") return items.some((i) => !isPurchaseDone(i) && i.status !== "ordered");
    if (filterId === "bought") return items.every((i) => isPurchaseDone(i));
    return items.some((i) => i.status === filterId);
  });
}

import { num } from "../store/helpers.js";

export function mergeSourcesLabel(sources = []) {
  const mods = [...new Set(sources.map((s) => s.module).filter(Boolean))];
  const detail = sources.map((s) => `${s.module} (${num(s.qty)})`).join(" · ");
  if (mods.length <= 1) return detail;
  const stellage = mods.every((m) => /^стеллаж/i.test(String(m).trim()));
  const noun = stellage ? "стеллажей" : "модулей";
  return `из ${mods.length} ${noun}: ${detail}`;
}

export function splitPurchaseItems(items) {
  const todo = [];
  const bought = [];
  for (const it of items || []) {
    (isPurchaseDone(it) ? bought : todo).push(it);
  }
  return { todo, bought };
}

export const DEFAULT_MANUAL_PARAMS = {
  waterLineLength: "",
  drainLineLength: "",
  toSewer: "",
  toWater: "",
  toPanel: "",
  cableLength: "",
  exhaust: "",
  ventilationCapacity: "",
  coolingPower: "",
  heatingPower: "",
  tankVolume: "",
  zoneCount: "",
  irrigationPumps: "",
  drainPumps: "",
  layoutNotes: "",
  notes: "",
  floorPlanUrl: "",
  schemePipesUrl: "",
  schemeStellagesUrl: "",
  schemeTechnicalUrl: "",
  schemeElectricalUrl: "",
  consumablesCartUrl: "",
};

export function clientVisibleItems(project) {
  return (project?.items || []).filter((i) => i.approved && i.visible && i.enabled !== false);
}

export function itemsByResponsible(items, responsibleId) {
  return items.filter((it) => resolveResponsible(it) === responsibleId);
}

export function itemsForSpecialist(items, specialistName, roles = RESPONSIBLE_OPTIONS) {
  const id = roles.find((o) => o.label === specialistName)?.id;
  if (id) return itemsByResponsible(items, id);
  return items.filter((it) => (SPECIALIST_MAP[it.category] || "Клиент") === specialistName);
}
