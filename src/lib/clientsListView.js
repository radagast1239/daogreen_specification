import { CLIENT_STATUSES, clientStatusMeta } from "../data/clientStatuses.js";

export function clientBudgetTotal(client) {
  const projects = client?.projects || [];
  return projects.reduce((sum, p) => sum + (p.totals?.budget || 0), 0);
}

export function clientMatchesQuery(client, query) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return true;
  const parts = [
    client?.name,
    client?.city,
    client?.comment,
    ...(client?.projects || []).map((p) => p?.name),
  ];
  const hay = parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

/** Status options present in loaded data (plus «Все статусы»). */
export function clientStatusFilterOptions(clients) {
  const present = new Set((clients || []).map((c) => c.status || "new"));
  const fromData = CLIENT_STATUSES.filter((s) => present.has(s.id));
  // Include unknown ids that appear in data but are not in the catalog.
  for (const id of present) {
    if (!fromData.some((s) => s.id === id)) {
      fromData.push({ id, label: clientStatusMeta(id).label, chip: "neutral" });
    }
  }
  return [{ id: "all", label: "Все статусы" }, ...fromData];
}

/**
 * Filter then sort. Does not mutate input.
 * @param {"default"|"name"|"sum"} sort
 */
export function filterAndSortClients(clients, { query = "", status = "all", sort = "default" } = {}) {
  const filtered = (clients || []).filter((c) => {
    if (status && status !== "all" && (c.status || "new") !== status) return false;
    return clientMatchesQuery(c, query);
  });

  if (sort === "name") {
    return [...filtered].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));
  }
  if (sort === "sum") {
    return [...filtered].sort((a, b) => clientBudgetTotal(b) - clientBudgetTotal(a));
  }
  return filtered;
}

/** Empty-state message after filters; null if list non-empty or still loading empty source. */
export function clientsEmptyMessage({ sourceCount, visibleCount, query, status }) {
  if (sourceCount === 0) return null;
  if (visibleCount > 0) return null;
  const q = String(query || "").trim();
  if (q) return "Клиенты не найдены";
  if (status && status !== "all") return "Нет клиентов с выбранным статусом";
  return "Клиенты не найдены";
}
