import { lineVisibleToClient, isCoolingSpecItem } from "./itemTypes.js";
import { resolveClientSection, isMiscCategory, subsectionsForSection, isSubsectionValid } from "./clientSections.js";
import { normalizePurchaseStatus, PURCHASE_STATUS, isClosedPurchaseStatusId } from "./purchaseStatusRules.js";
import { isFrameBomLine } from "./frameBomProjectItems.js";

export const SPEC_LINE_FILTERS = [
  { id: "", label: "Все" },
  { id: "included", label: "Включённые" },
  { id: "excluded", label: "Исключённые" },
  { id: "client_visible", label: "Показать клиенту" },
  { id: "client_hidden", label: "Скрытые от клиента" },
  { id: "needs_review", label: "На проверке" },
  { id: "no_price", label: "Без цены" },
  { id: "no_link", label: "Без ссылки" },
  { id: "no_photo", label: "Без фото" },
  { id: "no_supplier", label: "Без поставщика" },
  { id: "no_responsible", label: "Без ответственного" },
  { id: "need_help", label: "Нужна помощь" },
  { id: "replacement_check", label: "Замена на проверке" },
  { id: "not_fit", label: "Не подходит" },
  { id: "not_bought", label: "Не куплено" },
  { id: "ordered", label: "Заказано" },
  { id: "purchase_closed", label: "Куплено/доставлено" },
  { id: "frame_bom", label: "Из схемы стеллажа" },
  { id: "no_client_section", label: "Без клиентского раздела" },
  { id: "no_client_subsection", label: "Без клиентского подраздела" },
  { id: "problems", label: "Проблемные" },
];

function builderIncluded(line) {
  return line.included !== false && line.includedInProject !== false;
}

function builderClientVisible(line) {
  if (line.visibleToClient != null) return !!line.visibleToClient && builderIncluded(line);
  return builderIncluded(line);
}

function projectIncluded(it) {
  return it.includedInProject !== false && it.enabled !== false;
}

function hasPhoto(line) {
  return !!(line.imageUrl || line.photoUrl);
}

function clientSubsectionForFilter(line) {
  const resolved = resolveClientSection(line);
  return {
    section: resolved.section,
    subsection: (line.clientSubsection || resolved.subsection || "").trim(),
  };
}

function hasNoClientSection(line) {
  if (isCoolingSpecItem(line)) return false;
  return isMiscCategory(line);
}

function hasNoClientSubsection(line) {
  if (isCoolingSpecItem(line)) return false;
  if (isMiscCategory(line)) return false;
  const { section, subsection } = clientSubsectionForFilter(line);
  const subs = subsectionsForSection(section);
  if (!section || !subs.length) return false;
  return !subsection || !isSubsectionValid(section, subsection);
}

/** @param {"builder"|"project"} mode */
export function matchSpecLineFilter(line, filterId, mode = "builder") {
  if (!filterId) return true;
  const included = mode === "project" ? projectIncluded(line) : builderIncluded(line);
  const clientVisible =
    mode === "project" ? lineVisibleToClient(line) : builderClientVisible(line);

  switch (filterId) {
    case "problems":
      return (
        matchSpecLineFilter(line, "needs_review", mode) ||
        matchSpecLineFilter(line, "no_price", mode) ||
        matchSpecLineFilter(line, "no_link", mode) ||
        matchSpecLineFilter(line, "no_photo", mode) ||
        matchSpecLineFilter(line, "no_supplier", mode) ||
        matchSpecLineFilter(line, "no_responsible", mode) ||
        matchSpecLineFilter(line, "need_help", mode) ||
        matchSpecLineFilter(line, "not_fit", mode) ||
        matchSpecLineFilter(line, "no_client_section", mode) ||
        matchSpecLineFilter(line, "no_client_subsection", mode)
      );
    case "included":
      return included;
    case "excluded":
      return !included;
    case "client_visible":
      return clientVisible;
    case "client_hidden":
    case "not_approved":
      return included && !clientVisible;
    case "needs_review":
      return (
        line.needsApproval ||
        normalizePurchaseStatus(line) === PURCHASE_STATUS.REPLACEMENT_CHECK ||
        line.status === "replacement_check" ||
        (mode === "project" && !line.approved && projectIncluded(line))
      );
    case "no_price":
      return !(Number(line.price) > 0);
    case "no_link":
      return !(line.link || "").trim();
    case "no_photo":
      return !hasPhoto(line);
    case "no_supplier":
      return !(line.supplier || "").trim();
    case "no_responsible": {
      const r = (line.responsible || "").trim().toLowerCase();
      return !r || r === "general" || r === "none";
    }
    case "need_help":
      return normalizePurchaseStatus(line) === PURCHASE_STATUS.NEED_HELP;
    case "replacement_check":
      return normalizePurchaseStatus(line) === PURCHASE_STATUS.REPLACEMENT_CHECK;
    case "not_fit":
      return normalizePurchaseStatus(line) === PURCHASE_STATUS.NOT_FIT;
    case "not_bought":
      return normalizePurchaseStatus(line) === PURCHASE_STATUS.NOT_BOUGHT;
    case "ordered":
      return (
        normalizePurchaseStatus(line) === PURCHASE_STATUS.ORDERED ||
        normalizePurchaseStatus(line) === PURCHASE_STATUS.SEARCHING
      );
    case "purchase_closed":
      return isClosedPurchaseStatusId(normalizePurchaseStatus(line));
    case "frame_bom":
      return isFrameBomLine(line);
    case "no_client_section":
      return hasNoClientSection(line);
    case "no_client_subsection":
      return hasNoClientSubsection(line);
    default:
      return true;
  }
}

export function patchLinesByIds(lines, ids, patch) {
  const set = new Set(ids);
  return lines.map((ln) => (set.has(ln.id) ? { ...ln, ...patch } : ln));
}

export function patchLine(lines, id, patch) {
  return lines.map((ln) => (ln.id === id ? { ...ln, ...patch } : ln));
}
