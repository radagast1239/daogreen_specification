import React from "react";

export function SheetFiltersBar({ filters, activeFilterId, onPick }) {
  if (!filters?.length) return null;

  return (
    <div className="planner-filters-bar no-print">
      {filters.map((f) => (
        <button
          key={f.id}
          type="button"
          className={"planner-filter-chip" + (activeFilterId === f.id ? " planner-filter-chip--active" : "")}
          onClick={() => onPick(f.id)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
