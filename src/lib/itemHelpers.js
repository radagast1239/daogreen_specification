import { DONE_STATUSES, SPECIALIST_MAP } from "../data/modules.js";
import { DEFAULT_RESPONSIBLE_ROLES } from "./responsibleRoles.js";
import { defaultResponsible } from "./responsibleDefaults.js";
import {
  lineContributesToSum,
  lineVisibleToClient,
  isPurchasableLineType,
  resolveItemType,
} from "../../shared/itemTypes.js";

const DONE = new Set(DONE_STATUSES);

function num(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

export const RESPONSIBLE_OPTIONS = DEFAULT_RESPONSIBLE_ROLES;

export function isBoughtStatus(status) {
  return DONE.has(status);
}

/** Заказано или уже получено — убираем из основного списка закупки */
export function isClosedPurchaseStatus(status) {
  return status === "ordered" || isBoughtStatus(status);
}

export function isPurchaseClosed(it) {
  return isClosedPurchaseStatus(it?.status);
}

export { defaultResponsible };

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
  if (!lineContributesToSum(it)) return 0;
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

/** Склеенная строка: все исходные позиции закрыты (заказано / куплено) */
export function isMergedPurchaseClosed(row) {
  return (row?.sourceItems || []).length > 0 && row.sourceItems.every((it) => isPurchaseClosed(it));
}

/** @deprecated используйте isMergedPurchaseClosed */
export function isMergedPurchaseDone(row) {
  return isMergedPurchaseClosed(row);
}

export function splitMergedPurchaseRows(rows) {
  const todo = [];
  const bought = [];
  for (const row of rows || []) {
    (isMergedPurchaseClosed(row) ? bought : todo).push(row);
  }
  return { todo, bought };
}

export function applyMergedPurchaseFilter(rows, filterId) {
  if (filterId === "all") return rows;
  return (rows || []).filter((row) => {
    const items = row.sourceItems || [];
    if (filterId === "todo") return items.some((i) => !isPurchaseClosed(i));
    if (filterId === "bought") return items.every((i) => isPurchaseClosed(i));
    return items.some((i) => i.status === filterId);
  });
}

export function mergeSourcesLabel(sources = []) {
  const mods = [...new Set(sources.map((s) => s.module).filter(Boolean))];
  const detail = sources.map((s) => `${s.module} (${num(s.qty)})`).join(" · ");
  if (mods.length <= 1) return detail;
  const stellage = mods.every((m) => /^стеллаж/i.test(String(m).trim()));
  const noun = stellage ? "стеллажей" : "модулей";
  return `из ${mods.length} ${noun}: ${detail}`;
}

export function summarizeMergedStatus(sourceItems = []) {
  if (!sourceItems.length) return { status: "not_bought", mixed: false };
  const unique = [...new Set(sourceItems.map((i) => i.status))];
  if (unique.length === 1) return { status: unique[0], mixed: false };
  if (sourceItems.every((i) => isPurchaseClosed(i))) return { status: sourceItems[0].status, mixed: false };
  const open = sourceItems.find((i) => !isPurchaseClosed(i));
  return { status: open?.status || "not_bought", mixed: true };
}

export function buildMergedSourceText(row) {
  const unit = row.unit || "шт.";
  const sources = row.sources || [];
  const mods = [...new Set(sources.map((s) => s.module).filter(Boolean))];
  const detail = sources.map((s) => `${s.module || "Раздел"} — ${num(s.qty)} ${unit}`).join("; ");
  if (mods.length <= 1) return detail;
  const stellage = mods.every((m) => /^стеллаж/i.test(String(m).trim()));
  const noun = stellage ? "стеллажей" : "модулей";
  return `из ${mods.length} ${noun}: ${detail}`;
}

export function isDetailPurchaseMode(mode) {
  return mode === "modules";
}

export function isMergedPurchaseMode(mode) {
  return mode !== "modules";
}

export function splitPurchaseItems(items) {
  const todo = [];
  const bought = [];
  for (const it of items || []) {
    (isPurchaseClosed(it) ? bought : todo).push(it);
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
  return (project?.items || []).filter((i) => lineVisibleToClient(i));
}

export function projectBudgetItems(project) {
  return (project?.items || []).filter((i) => lineContributesToSum(i));
}

export function clientPurchaseItems(project) {
  return clientVisibleItems(project).filter((i) => isPurchasableLineType(resolveItemType(i)));
}

export { lineContributesToSum, lineVisibleToClient, resolveItemType, isPurchasableLineType };

export function itemsByResponsible(items, responsibleId) {
  return items.filter((it) => resolveResponsible(it) === responsibleId);
}

export function itemsForSpecialist(items, specialistName, roles = RESPONSIBLE_OPTIONS) {
  const id = roles.find((o) => o.label === specialistName)?.id;
  if (id) return itemsByResponsible(items, id);
  return items.filter((it) => (SPECIALIST_MAP[it.category] || "Клиент") === specialistName);
}
