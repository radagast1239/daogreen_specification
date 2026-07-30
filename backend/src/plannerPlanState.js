/**
 * PHASE 0B — детерминированный разбор сохранённого planner_plan и защита от
 * тихой потери данных при повреждённом JSON.
 *
 * Чистые функции без побочных эффектов и без зависимости от БД — отдельно
 * тестируемые. Не логируют и не возвращают сырой payload.
 */

export const PLANNER_PLAN_JSON_INVALID = "PLANNER_PLAN_JSON_INVALID";

/**
 * Разобрать сырое значение колонки projects.planner_plan.
 *
 *   { status: "empty",   plan: null }                — нет плана (null/пусто/"{}")
 *   { status: "ok",      plan: <object> }            — валидный непустой план
 *   { status: "corrupt", plan: null, code: ... }     — JSON не парсится (потеря данных!)
 *
 * `null`/`undefined`/пустая строка/пустой объект — это отсутствие плана, НЕ повреждение.
 * Малформный JSON — повреждение. Валидный JSON, но не непустой object/array,
 * трактуется как "empty" (совместимо с прежним `Object.keys(plan).length`).
 */
export function parsePlannerPlan(rawValue) {
  if (rawValue == null) return { status: "empty", plan: null };
  const str = typeof rawValue === "string" ? rawValue.trim() : rawValue;
  if (str === "" || str === "{}") return { status: "empty", plan: null };

  let parsed;
  try {
    parsed = typeof str === "string" ? JSON.parse(str) : str;
  } catch {
    return { status: "corrupt", plan: null, code: PLANNER_PLAN_JSON_INVALID };
  }

  if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
    return { status: "ok", plan: parsed };
  }
  return { status: "empty", plan: null };
}

/**
 * Свести колонку planner_plan и legacy manual_params.floorPlan к полям проекта.
 * Минимальный контракт: поле `plannerPlanState` добавляется ТОЛЬКО при повреждении,
 * чтобы не менять форму каждого ответа API.
 *
 *   corrupt → { plan: null, plannerPlanState: { status: "corrupt", code } }
 *   иначе   → { plan: <object|null> }   (floorPlan-fallback как раньше)
 */
export function resolveProjectPlanFields(rawPlannerPlan, floorPlan = null) {
  const parsed = parsePlannerPlan(rawPlannerPlan);
  if (parsed.status === "corrupt") {
    return {
      plan: null,
      plannerPlanState: { status: "corrupt", code: parsed.code },
    };
  }
  let plan = parsed.plan;
  if ((!plan || !Object.keys(plan).length) && floorPlan) plan = floorPlan;
  plan = plan && Object.keys(plan).length ? plan : null;
  return { plan };
}

/**
 * Нужно ли СОХРАНИТЬ существующие байты planner_plan при апдейте проекта.
 * true → не перезаписывать колонку (защита повреждённого payload от затирания
 * пустым `{}` при апдейте метаданных, где patch.plan не передан).
 */
export function shouldPreserveStoredPlan(storedRawPlannerPlan, patch = {}) {
  const state = parsePlannerPlan(storedRawPlannerPlan);
  if (state.status !== "corrupt") return false;
  // Явно переданный новый план (например, будущее восстановление) не блокируем.
  const incoming = patch ? patch.plan : undefined;
  return incoming == null;
}
