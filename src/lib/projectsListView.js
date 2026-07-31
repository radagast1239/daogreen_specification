/** Frontend-only list helpers for Projects / In Progress pages. */

export const PROJECT_SORT_OPTIONS = [
  { id: "default", label: "По умолчанию" },
  { id: "updated", label: "Недавно изменённые" },
  { id: "sum", label: "По сумме: сначала большие" },
  { id: "name", label: "По названию" },
  { id: "attention", label: "Требуют внимания" },
];

function projectUpdatedMs(p) {
  const raw = p?.updatedAt || p?.updated_at || "";
  const t = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

function projectBudget(p) {
  return Number(p?.totals?.budget ?? 0) || 0;
}

function projectItemCount(p) {
  if (Array.isArray(p?.items)) return p.items.length;
  return Number(p?.itemCount) || 0;
}

/** Lower = more attention. Uses existing problem flags / empty-project readiness only. */
export function projectAttentionRank(p, problemIds = new Set()) {
  if (problemIds.has(String(p?.id))) return 0;
  if (projectItemCount(p) === 0) return 1;
  return 2;
}

/**
 * Sort without mutating. Pinned projects stay first for all modes.
 * @param {"default"|"updated"|"sum"|"name"|"attention"} sort
 */
export function sortProjects(list, sort = "default", { pinned = [], problemIds = new Set() } = {}) {
  const pinSet = new Set(pinned);
  const pinRank = (p) => (pinSet.has(p.id) ? 0 : 1);

  return [...(list || [])].sort((a, b) => {
    const pr = pinRank(a) - pinRank(b);
    if (pr !== 0) return pr;

    if (sort === "name") {
      return String(a.name || "").localeCompare(String(b.name || ""), "ru");
    }
    if (sort === "sum") {
      return projectBudget(b) - projectBudget(a);
    }
    if (sort === "updated") {
      return projectUpdatedMs(b) - projectUpdatedMs(a);
    }
    if (sort === "attention") {
      const ar = projectAttentionRank(a, problemIds) - projectAttentionRank(b, problemIds);
      if (ar !== 0) return ar;
      return projectUpdatedMs(b) - projectUpdatedMs(a);
    }
    // default — same secondary key as legacy sortWithPinned
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
}

export function projectsHaveActiveFilters({
  q = "",
  clientF = "",
  projectStatusF = "all",
  dateF = "",
  problemsOnly = false,
} = {}) {
  if (String(q || "").trim()) return true;
  if (clientF) return true;
  if (projectStatusF && projectStatusF !== "all") return true;
  if (dateF) return true;
  if (problemsOnly) return true;
  return false;
}

/**
 * Empty copy after filters. Null when source list is empty or results exist.
 * @param {"active"|"in-progress"} variant
 */
export function projectsFilterEmptyTitle(variant = "active") {
  return variant === "in-progress" ? "Ничего не найдено" : "Проекты не найдены";
}

export function projectsSourceEmptyCopy(variant = "active") {
  if (variant === "in-progress") {
    return {
      title: "Нет проектов в процессе",
      hint: "Создайте новый проект или сохраните черновик в мастере.",
      cta: "Создать проект",
    };
  }
  return {
    title: "Пока нет проектов",
    hint: "Создай первый проект через мастер.",
    cta: "Создать проект",
  };
}
