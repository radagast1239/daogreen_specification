import React from "react";
import { LAYERS } from "../catalog.js";

export function LayerTabs({ active, vis, onPick, onToggleVis }) {
  return (
    <div className="planner-layers no-print">
      {LAYERS.map((l) => {
        const isActive = active === l.id;
        const isVis = vis[l.id] !== false;
        return (
          <div
            key={l.id}
            role="tab"
            tabIndex={0}
            className={
              "planner-layer-tab" +
              (isActive ? " planner-layer-tab--active" : "") +
              (!isVis ? " planner-layer-tab--hidden" : "")
            }
            onClick={() => onPick(l.id)}
            onKeyDown={(e) => e.key === "Enter" && onPick(l.id)}
            title={l.sheet}
          >
            <span
              role="button"
              tabIndex={0}
              className="planner-layer-tab__eye"
              onClick={(e) => {
                e.stopPropagation();
                onToggleVis(l.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.stopPropagation();
                  onToggleVis(l.id);
                }
              }}
              aria-label={isVis ? "Скрыть слой" : "Показать слой"}
            >
              {isVis ? "◉" : "○"}
            </span>
            <span className="planner-layer-tab__dot" style={{ background: l.color }} />
            {l.name}
          </div>
        );
      })}
    </div>
  );
}
