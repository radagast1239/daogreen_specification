import React from "react";
import {
  PROJECT_WORKFLOW_STATUSES,
  normalizeProjectStatus,
  resolveProjectStatusForSave,
} from "../../shared/projectStatus.js";

/**
 * Компактный select ручного статуса проекта.
 * onChange получает id для записи в DB (Черновик → active).
 */
export default function ProjectStatusControl({
  status,
  onChange,
  disabled = false,
  className = "",
}) {
  const value = normalizeProjectStatus(status);
  const selectValue = PROJECT_WORKFLOW_STATUSES.some((s) => s.id === value)
    ? value
    : "active";

  return (
    <label className={`project-status-control ${className}`.trim()}>
      <span className="project-status-control__label muted">Статус</span>
      <select
        className="project-status-control__select"
        value={selectValue}
        disabled={disabled}
        onChange={(e) => {
          const next = resolveProjectStatusForSave(e.target.value);
          onChange?.(next);
        }}
        aria-label="Статус проекта"
      >
        {PROJECT_WORKFLOW_STATUSES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}
