/**
 * PHASE 0D — чистая презентационная логика диагностической панели.
 *
 * Без React, без мутаций. Форматирование, русские подписи, фильтрация,
 * группировка и определение устаревания результата. `message` уже приходит
 * из validatePlanIntegrity — здесь его не дублируем.
 */

export const SEVERITY_ORDER = ["error", "warning", "info"];

export const SEVERITY_LABELS = {
  error: "Ошибка",
  warning: "Предупреждение",
  info: "Информация",
};

export const SEVERITY_LABELS_PLURAL = {
  error: "Ошибки",
  warning: "Предупреждения",
  info: "Информация",
};

export const ENTITY_TYPE_LABELS = {
  plan: "План",
  node: "Узел",
  wall: "Стена",
  opening: "Проём",
  item: "Объект",
  dimension: "Размер",
  room: "Помещение",
  route: "Трасса",
  link: "Связь",
};

export const EMPTY_NOT_RUN = "Запустите проверку, чтобы найти структурные проблемы плана";
export const EMPTY_NO_MATCH = "По выбранному фильтру проблем нет";
export const NO_ERRORS_TEXT = "Критических нарушений структуры не найдено";
export const STALE_TEXT = "Результаты устарели — выполните проверку повторно";

export function severityLabel(severity) {
  return SEVERITY_LABELS[severity] || severity || "";
}

export function entityTypeLabel(entityType) {
  return ENTITY_TYPE_LABELS[entityType] || entityType || "Объект";
}

/** Короткое техническое представление id (для длинных uid). */
export function formatEntityId(entityId) {
  if (entityId == null) return "—";
  const s = String(entityId);
  if (s.length <= 16) return s;
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

/** Счётчики по severity из массива diagnostics. */
export function countBySeverity(diagnostics = []) {
  const counts = { error: 0, warning: 0, info: 0, total: 0 };
  for (const d of diagnostics) {
    if (d && counts[d.severity] !== undefined) counts[d.severity] += 1;
    counts.total += 1;
  }
  return counts;
}

/** Краткая строка-резюме, напр. "0 ошибок · 2 предупреждения". */
export function summaryText(summary) {
  if (!summary) return "";
  const parts = [`${summary.errors} ${pluralRu(summary.errors, "ошибка", "ошибки", "ошибок")}`];
  if (summary.warnings) parts.push(`${summary.warnings} ${pluralRu(summary.warnings, "предупреждение", "предупреждения", "предупреждений")}`);
  if (summary.info) parts.push(`${summary.info} ${pluralRu(summary.info, "заметка", "заметки", "заметок")}`);
  return parts.join(" · ");
}

function pluralRu(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/**
 * Отфильтровать diagnostics по включённым severity. Не мутирует вход.
 * @param {object[]} diagnostics
 * @param {{error?:boolean,warning?:boolean,info?:boolean}} filters
 */
export function filterDiagnostics(diagnostics = [], filters = {}) {
  return diagnostics.filter((d) => d && filters[d.severity] !== false);
}

/**
 * Сгруппировать diagnostics по severity в порядке error→warning→info.
 * Внутри группы порядок сохраняется (validator уже отсортировал).
 * @returns {{severity:string, label:string, items:object[]}[]}
 */
export function groupBySeverity(diagnostics = []) {
  const groups = [];
  for (const severity of SEVERITY_ORDER) {
    const items = diagnostics.filter((d) => d && d.severity === severity);
    if (items.length) {
      groups.push({ severity, label: SEVERITY_LABELS_PLURAL[severity], items });
    }
  }
  return groups;
}

/**
 * Устарел ли результат проверки относительно текущего плана.
 * Определяется по идентичности ссылки на объект плана (меняется при правке данных,
 * но НЕ при изменении viewport/selection).
 */
export function isDiagnosticsStale(checkedPlanRef, currentPlanRef) {
  if (!checkedPlanRef) return false;
  return checkedPlanRef !== currentPlanRef;
}

/**
 * Вертикальная привязка плавающего drawer к рабочей области планировщика.
 * Высота шапки (topbar + строка листов + фильтры) зависит от layout, поэтому
 * фиксированный отступ ненадёжен — полосу берём у реального workspace.
 *
 * @param {{top:number,bottom:number}|null} workspaceRect  getBoundingClientRect() рабочей области
 * @param {number} viewportHeight  window.innerHeight
 * @param {number} [pad=8]         отступ от краёв рабочей области
 * @returns {{top:number,bottom:number}|null}  null → использовать CSS по умолчанию
 */
export function computeDrawerAnchor(workspaceRect, viewportHeight, pad = 8) {
  if (!workspaceRect) return null;
  const { top, bottom } = workspaceRect;
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || !Number.isFinite(viewportHeight)) return null;
  return {
    top: Math.round(top + pad),
    bottom: Math.max(pad, Math.round(viewportHeight - bottom + pad)),
  };
}

/**
 * PHASE 0G — объединяет result validatePlanIntegrity с доп. session-only
 * diagnostics (напр. room detection failure) в тот же result-shape, который
 * ожидает панель. Не создаёт вторую панель — переиспользует существующую.
 * Чистая функция, не мутирует входы.
 * @param {{valid,summary,diagnostics}|null} result
 * @param {object[]} extraDiagnostics — уже готовые diagnostic-объекты
 */
export function mergeDiagnosticsResult(result, extraDiagnostics = []) {
  if (!extraDiagnostics.length) return result;
  const base = result || { valid: true, summary: { errors: 0, warnings: 0, info: 0, total: 0 }, diagnostics: [] };
  const summary = {
    errors: base.summary?.errors || 0,
    warnings: base.summary?.warnings || 0,
    info: base.summary?.info || 0,
    total: base.summary?.total || 0,
  };
  for (const d of extraDiagnostics) {
    if (d.severity === "error") summary.errors += 1;
    else if (d.severity === "warning") summary.warnings += 1;
    else if (d.severity === "info") summary.info += 1;
    summary.total += 1;
  }
  return {
    valid: summary.errors === 0,
    summary,
    diagnostics: [...extraDiagnostics, ...(base.diagnostics || [])],
  };
}

/** Заголовок кнопки/результата по summary. */
export function resultHeadline(summary) {
  if (!summary) return "";
  if (summary.errors === 0) return NO_ERRORS_TEXT;
  return `${summary.errors} ${pluralRu(summary.errors, "критическая ошибка", "критические ошибки", "критических ошибок")}`;
}
