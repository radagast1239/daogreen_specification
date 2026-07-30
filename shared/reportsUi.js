/**
 * Reports R4 — presentation-only helpers (no data / calculation changes).
 */

export const REPORT_TAB_SHORT_LABELS = Object.freeze({
  overview: "Сводка",
  issues: "Проблемы",
  purchases: "Закупка",
  publications: "Публикации",
  "material-drift": "База",
  sections: "Разделы",
  rooms: "Помещения",
});

/** Important zero metrics stay visible. */
const KEEP_ZERO_KPI = new Set([
  "unpublished",
  "withChanges",
  "needsAttention",
  "receivedSum",
  "notOrderedSum",
  "activeProjects",
]);

/**
 * @param {{ id?: string, value: unknown, keepZero?: boolean, important?: boolean }} card
 */
export function shouldShowReportKpi(card) {
  if (!card) return false;
  if (card.important || card.keepZero) return true;
  if (card.id && KEEP_ZERO_KPI.has(card.id)) return true;
  const v = card.value;
  if (v == null || v === "") return false;
  if (typeof v === "number" && v === 0 && !card.keepZero) return false;
  if (v === "0" || v === "0 ₽" || v === "0₽") return false;
  return true;
}

export function countIssuesByLevel(issues = []) {
  const out = { error: 0, warning: 0, info: 0 };
  for (const it of issues || []) {
    const lvl = it.level || "info";
    if (out[lvl] != null) out[lvl] += 1;
    else out.info += 1;
  }
  return out;
}

/**
 * Hide informational issues by default when errors/warnings exist.
 * Data itself is never deleted — caller keeps full list.
 */
export function filterIssuesForDisplay(issues = [], { showInfo = false } = {}) {
  const list = issues || [];
  const counts = countIssuesByLevel(list);
  if (showInfo) return list;
  if (counts.error + counts.warning === 0) return list;
  return list.filter((it) => it.level !== "info");
}

export function publicationDiffChips(row) {
  if (!row?.hasPublished) return [];
  const chips = [];
  if (row.addedCount > 0) chips.push({ id: "added", label: `Добавлено ${row.addedCount}`, tone: "ok" });
  if (row.removedCount > 0) chips.push({ id: "removed", label: `Удалено ${row.removedCount}`, tone: "warn" });
  if (row.changedCount > 0) chips.push({ id: "changed", label: `Изменено ${row.changedCount}`, tone: "amber" });
  return chips;
}

export function syncStatusTone(syncStatus) {
  if (syncStatus === "changes") return "warn";
  if (syncStatus === "current") return "ok";
  if (syncStatus === "unpublished") return "neutral";
  return "neutral";
}

export function driftTypeTone(typeId) {
  if (typeId === "lost_material") return "danger";
  if (typeId === "manual_price" || typeId === "name_override") return "info";
  if (typeId === "supplier_changed") return "info";
  if (typeId === "catalog_price_diff" || typeId === "catalog_name_diff") return "amber";
  return "neutral";
}

export function isLargePriceDelta(projectPrice, basePrice) {
  if (basePrice == null) return false;
  const a = Number(projectPrice) || 0;
  const b = Number(basePrice) || 0;
  if (a === b) return false;
  const abs = Math.abs(a - b);
  if (abs >= 5000) return true;
  const base = Math.max(Math.abs(b), 1);
  return abs / base >= 0.5;
}

/** Fully received / already-owned purchase group → default collapsed. */
export function isPurchaseGroupFullyReceived(group) {
  const items = group?.items || [];
  if (!items.length) return false;
  const done = new Set(["delivered", "bought", "have", "received"]);
  return items.every((it) => done.has(String(it.status || it.statusId || "").toLowerCase()));
}

export function defaultPurchaseGroupOpen(group) {
  if (!group) return true;
  if (group.supplier === "Поставщик не указан" || group.supplier === "—") return true;
  if (isPurchaseGroupFullyReceived(group)) return false;
  return true;
}

/** Presentation sort: named rooms first, NO_ROOM last. Does not mutate source. */
export function sortRoomsForDisplay(rows = [], noRoomLabel = "Помещение не указано") {
  return [...(rows || [])].sort((a, b) => {
    const aNo = a.roomLabel === noRoomLabel || a.isNoRoom;
    const bNo = b.roomLabel === noRoomLabel || b.isNoRoom;
    if (aNo !== bNo) return aNo ? 1 : -1;
    return 0;
  });
}

export function countNoRoomItems(rows = [], noRoomLabel = "Помещение не указано") {
  return (rows || [])
    .filter((r) => r.roomLabel === noRoomLabel || r.isNoRoom)
    .reduce((s, r) => s + (Number(r.itemCount) || 0), 0);
}

export function filtersAreActive(values = {}) {
  return Object.values(values).some((v) => {
    if (typeof v === "boolean") return v === true && false; // ignore bare booleans unless meaningful
    return v != null && String(v).trim() !== "";
  });
}

export function reportFiltersActive(parts = []) {
  return parts.some((v) => v != null && String(v).trim() !== "");
}

export function issueLevelTone(level) {
  if (level === "error") return "danger";
  if (level === "warning") return "warn";
  return "neutral";
}
