/** Роли ответственного — общая логика front + back */

export const DEFAULT_RESPONSIBLE_ROLES = [
  { id: "plumber", label: "Сантехник" },
  { id: "electrician", label: "Электрик" },
  { id: "installer", label: "Монтажник" },
  { id: "climate", label: "Климат" },
  { id: "client", label: "Клиент" },
  { id: "purchaser", label: "Закупщик" },
  { id: "consumables", label: "Расходники" },
  { id: "general", label: "Общий" },
];

/**
 * Сохранённые роли из settings + недостающие встроенные (в т.ч. climate).
 * Пользовательские роли сохраняются; дубликаты по id отбрасываются.
 */
export function mergeResponsibleRoles(saved, defaults = DEFAULT_RESPONSIBLE_ROLES) {
  const seen = new Set();
  const out = [];
  for (const r of saved || []) {
    if (!r?.id || !r?.label || seen.has(r.id)) continue;
    seen.add(String(r.id));
    out.push({ id: String(r.id), label: String(r.label) });
  }
  for (const r of defaults) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ ...r });
  }
  return out;
}
