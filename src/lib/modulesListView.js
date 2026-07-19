/** Pure helpers for Modules / directories list UI (Phase 1C). */

export function matchesQuery(text, query) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return true;
  return String(text || "")
    .toLowerCase()
    .includes(q);
}

export function filterByQuery(items, query, getText) {
  const q = String(query || "").trim();
  if (!q) return items || [];
  return (items || []).filter((item) => matchesQuery(getText(item), q));
}

export function emptySearchMessage(query, visibleCount) {
  const q = String(query || "").trim();
  if (!q || visibleCount > 0) return null;
  return "Ничего не найдено";
}
