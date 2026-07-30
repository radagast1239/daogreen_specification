import React, { useEffect, useRef } from "react";
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
  const tabRefs = useRef({});

  useEffect(() => {
    tabRefs.current[active]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [active]);

  const handleKeyDown = (event) => {
    const current = PROJECT_WORKSPACE_VIEWS.indexOf(active);
    let next = null;
    if (event.key === "ArrowRight") next = (current + 1) % PROJECT_WORKSPACE_VIEWS.length;
    if (event.key === "ArrowLeft") next = (current - 1 + PROJECT_WORKSPACE_VIEWS.length) % PROJECT_WORKSPACE_VIEWS.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = PROJECT_WORKSPACE_VIEWS.length - 1;
    if (next == null) return;
    event.preventDefault();
    const id = PROJECT_WORKSPACE_VIEWS[next];
    onChange?.(id);
    requestAnimationFrame(() => tabRefs.current[id]?.focus());
  };

  return (
    <div
      className={`pw-tabs no-print ${className}`.trim()}
      role="tablist"
      aria-label="Режим работы с проектом"
      onKeyDown={handleKeyDown}
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
              tabIndex={selected ? 0 : -1}
              ref={(node) => { tabRefs.current[id] = node; }}
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
