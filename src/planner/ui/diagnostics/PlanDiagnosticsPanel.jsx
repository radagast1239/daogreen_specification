import React, { useState, useLayoutEffect } from "react";
import "./planDiagnostics.css";
import {
  severityLabel,
  entityTypeLabel,
  formatEntityId,
  summaryText,
  countBySeverity,
  filterDiagnostics,
  groupBySeverity,
  computeDrawerAnchor,
  EMPTY_NOT_RUN,
  EMPTY_NO_MATCH,
  NO_ERRORS_TEXT,
} from "./diagnosticPresentation.js";

/**
 * PHASE 0D — read-only панель результатов validatePlanIntegrity.
 *
 * Ничего не вычисляет и не мутирует: получает готовый result, вызывает колбэки.
 * Не запускает валидатор, не знает о backend, не меняет plan.
 */
export function PlanDiagnosticsPanel({
  result,
  stale = false,
  checking = false,
  filters,
  onFilterToggle,
  onRerun,
  onClose,
  onFocus,
  propertiesOpen = false,
}) {
  const [focusNotes, setFocusNotes] = useState({});
  const [activeKey, setActiveKey] = useState(null);
  // Панель — плавающий drawer. Высота шапки планировщика (topbar + строка листов +
  // фильтры) зависит от layout, поэтому вертикальную полосу берём у реальной
  // рабочей области, а не подбираем фиксированный отступ. Вне планировщика
  // (например, в изолированном harness) остаются CSS-значения по умолчанию.
  const [anchor, setAnchor] = useState(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = document.querySelector(".planner-workspace");
      setAnchor(computeDrawerAnchor(el ? el.getBoundingClientRect() : null, window.innerHeight));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const diagnostics = result?.diagnostics || [];
  const summary = result?.summary;
  const counts = countBySeverity(diagnostics);
  const visible = filterDiagnostics(diagnostics, filters);
  const groups = groupBySeverity(visible);

  const handleShow = (diag, key) => {
    setActiveKey(key);
    const res = onFocus ? onFocus(diag) : null;
    if (res && res.ok === false) {
      setFocusNotes((n) => ({ ...n, [key]: res.message || "Объект нельзя показать на схеме" }));
    } else {
      setFocusNotes((n) => (n[key] ? { ...n, [key]: null } : n));
    }
  };

  const chip = (sev, label) => {
    const on = filters?.[sev] !== false;
    const count = sev === "all" ? counts.total : counts[sev];
    return (
      <button
        type="button"
        className={`plan-diag-chip plan-diag-chip--${sev}${on ? " plan-diag-chip--on" : ""}`}
        aria-pressed={on}
        onClick={() => onFilterToggle && onFilterToggle(sev)}
      >
        {label}{sev !== "all" ? ` · ${count}` : ""}
      </button>
    );
  };

  return (
    <aside
      className={`plan-diag-panel${propertiesOpen ? " plan-diag-panel--with-props" : ""}`}
      style={anchor ? { top: anchor.top, bottom: anchor.bottom } : undefined}
      role="complementary"
      aria-label="Проверка плана"
    >
      <div className="plan-diag-panel__head">
        <div className="plan-diag-panel__title">
          Проверка плана
          {summary && (
            <span className="plan-diag-panel__summary">{summaryText(summary)}</span>
          )}
        </div>
        <div className="plan-diag-panel__head-actions">
          <button type="button" className="plan-diag-btn" onClick={onRerun} disabled={checking} title="Проверить снова">
            {checking ? "Проверка…" : "Проверить снова"}
          </button>
          <button type="button" className="plan-diag-btn plan-diag-btn--icon" onClick={onClose} title="Закрыть" aria-label="Закрыть">✕</button>
        </div>
      </div>

      {stale && (
        <div className="plan-diag-panel__stale" role="status">
          <span>Результаты устарели — план изменён после проверки</span>
          <button type="button" className="plan-diag-btn" onClick={onRerun} disabled={checking}>Проверить снова</button>
        </div>
      )}

      <div className="plan-diag-panel__filters">
        {chip("all", "Все")}
        {chip("error", "Ошибки")}
        {chip("warning", "Предупреждения")}
        {chip("info", "Информация")}
      </div>

      <div className="plan-diag-panel__list">
        {!result ? (
          <div className="plan-diag-panel__empty">{EMPTY_NOT_RUN}</div>
        ) : diagnostics.length === 0 ? (
          <div className="plan-diag-panel__ok">{NO_ERRORS_TEXT}</div>
        ) : visible.length === 0 ? (
          <div className="plan-diag-panel__empty">{EMPTY_NO_MATCH}</div>
        ) : (
          groups.map((group) => (
            <div key={group.severity} className="plan-diag-group">
              <div className="plan-diag-group__head">{group.label} · {group.items.length}</div>
              {group.items.map((diag, i) => {
                const key = `${group.severity}:${diag.code}:${diag.entityId}:${diag.path}:${i}`;
                const focusTarget = onFocus && diag.entityType !== "plan";
                return (
                  <div key={key} className={`plan-diag-item${activeKey === key ? " plan-diag-item--active" : ""}`}>
                    <span className={`plan-diag-dot plan-diag-dot--${diag.severity}`} aria-hidden="true" />
                    <div>
                      <div className="plan-diag-item__msg">
                        <span className="sr-only">{severityLabel(diag.severity)}: </span>
                        {diag.message}
                      </div>
                      <div className="plan-diag-item__meta">
                        {entityTypeLabel(diag.entityType)}
                        {diag.entityId != null ? ` ${formatEntityId(diag.entityId)}` : ""}
                        {" · "}
                        <span className="plan-diag-item__code">{diag.code}</span>
                      </div>
                      {diag.path ? <div className="plan-diag-item__path">{diag.path}</div> : null}
                      {focusTarget && (
                        <div className="plan-diag-item__actions">
                          <button type="button" className="plan-diag-btn" onClick={() => handleShow(diag, key)}>
                            Показать на плане
                          </button>
                        </div>
                      )}
                      {focusNotes[key] ? <div className="plan-diag-item__note">{focusNotes[key]}</div> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

export default PlanDiagnosticsPanel;
