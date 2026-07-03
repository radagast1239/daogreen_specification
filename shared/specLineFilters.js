import { lineVisibleToClient } from "./itemTypes.js";

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
        matchSpecLineFilter(line, "no_responsible", mode)
      );
    case "included":
      return included;
    case "excluded":
      return !included;
    case "client_visible":
      return clientVisible;
    case "client_hidden":
      return included && !clientVisible;
    case "needs_review":
      return (
        line.needsApproval ||
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
