import React from "react";
import { PLANNER_VIEW_MODES } from "../plannerViewModes.js";

export function PlannerModeBar({ activeMode = "2d", onModePick }) {
  return (
    <div className="planner-mode-bar no-print" role="toolbar" aria-label="Фильтр групп листов">
      {PLANNER_VIEW_MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          className={
            "planner-mode-btn"
            + (activeMode === m.id ? " planner-mode-btn--active" : "")
            + (m.disabled ? " planner-mode-btn--disabled" : "")
          }
          disabled={m.disabled}
          onClick={() => !m.disabled && onModePick?.(m)}
          title={m.title}
          aria-pressed={activeMode === m.id}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
