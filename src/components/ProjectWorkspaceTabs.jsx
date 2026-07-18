import React from "react";
import {
  PROJECT_WORKSPACE_VIEWS,
  PROJECT_WORKSPACE_VIEW_LABELS,
  normalizeProjectWorkspaceView,
} from "../lib/projectWorkspaceView.js";
import "../styles/project-workspace.css";

/**
 * Persistent project workspace mode tabs (design / spec / publish).
 */
export default function ProjectWorkspaceTabs({
  value,
  onChange,
  className = "",
}) {
  const active = normalizeProjectWorkspaceView(value);

  return (
    <div
      className={`pw-tabs no-print ${className}`.trim()}
      role="tablist"
      aria-label="Режим работы с проектом"
    >
      <div className="pw-tabs__scroll">
        {PROJECT_WORKSPACE_VIEWS.map((id) => {
          const selected = active === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`pw-tab-${id}`}
              aria-selected={selected}
              className={`pw-tabs__btn${selected ? " is-active" : ""}`}
              data-workspace-view={id}
              onClick={() => {
                if (id === active) return;
                onChange?.(id);
              }}
            >
              {PROJECT_WORKSPACE_VIEW_LABELS[id]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
