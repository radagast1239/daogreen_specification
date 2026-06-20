import { SPECIALIST_MAP } from "../data/modules.js";

export const RESPONSIBLE_OPTIONS = [
  { id: "plumber", label: "Сантехник" },
  { id: "electrician", label: "Электрик" },
  { id: "installer", label: "Монтажник" },
  { id: "client", label: "Клиент" },
  { id: "purchaser", label: "Закупщик" },
  { id: "consumables", label: "Расходники" },
  { id: "general", label: "Общий" },
];

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
};

export function clientVisibleItems(project) {
  return (project?.items || []).filter((i) => i.approved && i.visible && i.enabled !== false);
}

export function itemsByResponsible(items, responsibleId) {
  return items.filter((it) => resolveResponsible(it) === responsibleId);
}

export function itemsForSpecialist(items, specialistName) {
  const id = RESPONSIBLE_OPTIONS.find((o) => o.label === specialistName)?.id;
  if (id) return itemsByResponsible(items, id);
  return items.filter((it) => (SPECIALIST_MAP[it.category] || "Клиент") === specialistName);
}
