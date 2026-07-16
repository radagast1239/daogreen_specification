/**
 * PHASE 0B — единый признак «можно ли писать planner_plan этого проекта».
 *
 * Backend помечает повреждённый сохранённый план полем
 * `project.plannerPlanState = { status: "corrupt", code }`. Фронт использует
 * этот чистый хелпер как один write-guard: при повреждении запрещены autosave,
 * ручное сохранение и specification sync, чтобы не затереть исходный payload.
 */

export const PLANNER_PLAN_JSON_INVALID = "PLANNER_PLAN_JSON_INVALID";

/** Повреждён ли сохранённый план проекта (диагностический сигнал backend). */
export function isPlannerPlanCorrupt(project) {
  return project?.plannerPlanState?.status === "corrupt";
}

/** Единая точка: разрешена ли запись плана этого проекта. */
export function canPersistPlannerPlan(project) {
  return !isPlannerPlanCorrupt(project);
}

/** Производное состояние персистентности плана для UI/эффектов. */
export function getPlannerPersistenceState(project) {
  if (isPlannerPlanCorrupt(project)) {
    return {
      status: "corrupt",
      canPersist: false,
      code: project?.plannerPlanState?.code || PLANNER_PLAN_JSON_INVALID,
    };
  }
  return { status: "ok", canPersist: true };
}
