import { CATEGORIES, FARM_TYPES, PURCHASE_STATUSES } from "../data/modules.js";
import { MATERIAL_TAGS } from "./materialTags.js";
import { STELLAGE_GROUPS } from "../../shared/stellageComposition.js";
import { parseCategoriesJson } from "./categories.js";
import { parseClientSectionsJson } from "../../shared/clientSections.js";

export const DEFAULT_RESPONSIBLE_ROLES = [
  { id: "plumber", label: "Сантехник" },
  { id: "electrician", label: "Электрик" },
  { id: "installer", label: "Монтажник" },
  { id: "client", label: "Клиент" },
  { id: "purchaser", label: "Закупщик" },
  { id: "consumables", label: "Расходники" },
  { id: "general", label: "Общий" },
];

export const DEFAULT_UNITS = ["шт.", "м", "м²", "м³", "кг", "л", "компл.", "уп."];

export const STATUS_CHIP_OPTIONS = [
  { id: "neutral", label: "Нейтральный" },
  { id: "brand", label: "Бренд" },
  { id: "ok", label: "Готово" },
  { id: "amber", label: "Внимание" },
  { id: "danger", label: "Проблема" },
];

function parseJson(raw, fallback) {
  try {
    const v = raw ? JSON.parse(raw) : fallback;
    return v;
  } catch {
    return fallback;
  }
}

export function resolveTags(settings = {}) {
  const list = parseJson(settings.refTags, null);
  if (Array.isArray(list) && list.length) {
    return [...new Set(list.map((t) => String(t).trim()).filter(Boolean))];
  }
  return [...MATERIAL_TAGS];
}

export function resolveUnits(settings = {}) {
  const list = parseJson(settings.refUnits, null);
  if (Array.isArray(list) && list.length) {
    return [...new Set(list.map((u) => String(u).trim()).filter(Boolean))];
  }
  return [...DEFAULT_UNITS];
}

export function resolvePurchaseStatuses(settings = {}) {
  const list = parseJson(settings.refPurchaseStatuses, null);
  if (Array.isArray(list) && list.length) {
    return list
      .filter((s) => s?.id && s?.label)
      .map((s) => ({
        id: String(s.id),
        label: String(s.label),
        chip: s.chip || "neutral",
        clientVisible: s.clientVisible !== false,
      }));
  }
  return PURCHASE_STATUSES.map((s) => ({ ...s, clientVisible: true }));
}

export function clientPurchaseStatuses(all) {
  return (all || []).filter((s) => s.clientVisible !== false);
}

export function resolveResponsibleRoles(settings = {}) {
  const list = parseJson(settings.refResponsibleRoles, null);
  if (Array.isArray(list) && list.length) {
    return list.filter((r) => r?.id && r?.label).map((r) => ({ id: String(r.id), label: String(r.label) }));
  }
  return [...DEFAULT_RESPONSIBLE_ROLES];
}

export function resolveFarmTypes(settings = {}) {
  const list = parseJson(settings.refFarmTypes, null);
  if (Array.isArray(list) && list.length) {
    return [...new Set(list.map((t) => String(t).trim()).filter(Boolean))];
  }
  return [...FARM_TYPES, "NFT", "микрозелень"];
}

export function resolveStellageGroups(settings = {}) {
  const list = parseJson(settings.refStellageGroups, null);
  if (Array.isArray(list) && list.length) {
    return [...list]
      .filter((g) => g?.id && g?.label)
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((g, i) => ({
        id: String(g.id),
        label: String(g.label),
        order: g.order ?? i + 1,
      }));
  }
  return STELLAGE_GROUPS.map((g) => ({ ...g }));
}

export function groupLabelFrom(groups, id) {
  return groups.find((g) => g.id === id)?.label || id;
}

export function defaultStellageGroupIds(groups) {
  const list = groups?.length ? groups : resolveStellageGroups({});
  return list.filter((g) => g.id !== "opcii").map((g) => g.id);
}

export function resolveClientSections(settings = {}) {
  return parseClientSectionsJson(settings.clientSectionsJson);
}

export function buildReferenceData(settings = {}) {
  return {
    tags: resolveTags(settings),
    units: resolveUnits(settings),
    purchaseStatuses: resolvePurchaseStatuses(settings),
    responsibleRoles: resolveResponsibleRoles(settings),
    farmTypes: resolveFarmTypes(settings),
    stellageGroups: resolveStellageGroups(settings),
    categories: parseCategoriesJson(settings.materialCategories),
    clientSections: resolveClientSections(settings),
  };
}

export function referenceToSettings(ref) {
  return {
    refTags: JSON.stringify(ref.tags || []),
    refUnits: JSON.stringify(ref.units || []),
    refPurchaseStatuses: JSON.stringify(ref.purchaseStatuses || []),
    refResponsibleRoles: JSON.stringify(ref.responsibleRoles || []),
    refFarmTypes: JSON.stringify(ref.farmTypes || []),
    refStellageGroups: JSON.stringify(ref.stellageGroups || []),
    materialCategories: JSON.stringify(ref.categories || []),
    clientSectionsJson: JSON.stringify(
      (ref.clientSections || []).map((s, i) => ({
        id: s.id,
        label: s.label,
        subsections: s.subsections || [],
        hidden: s.hidden === true,
        order: i,
      }))
    ),
  };
}

export function slugId(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_а-яё]/gi, "")
    .slice(0, 32) || `id_${Date.now()}`;
}
