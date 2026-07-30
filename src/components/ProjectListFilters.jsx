import React from "react";
import { PROJECT_STATUS_LIST_FILTERS } from "../../shared/projectStatus.js";

export default function ProjectListFilters({ value = "all", onChange, className = "" }) {
  return (
    <div className={`project-list-filters ${className}`.trim()} role="tablist" aria-label="Фильтр по статусу проекта">
      {PROJECT_STATUS_LIST_FILTERS.map((f) => {
        const active = value === f.id;
        return (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`btn btn-sm project-list-filters__chip${active ? " btn-primary" : ""}`}
            onClick={() => onChange?.(f.id)}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
