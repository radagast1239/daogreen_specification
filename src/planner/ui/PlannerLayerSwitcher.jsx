import React from "react";

/** Visual layer groups mapped onto existing planner sheets (phase 1 shell only). */
export const VISUAL_LAYERS = [
  { id: "architecture", label: "Архитектура", sheetId: "base_plan", color: "#2f3431" },
  { id: "racks", label: "Стеллажи", sheetId: "racks", color: "#116355" },
  { id: "water", label: "Вода", sheetId: "irrigation", color: "#1f6f8b" },
  { id: "power", label: "Электрика", sheetId: "electrical", color: "#a5371f" },
  { id: "climate", label: "Климат", sheetId: "climate", color: "#5b7c9d" },
  { id: "automation", label: "Автоматика", sheetId: "equipment", color: "#6b7d74" },
  { id: "zones", label: "Зоны", sheetId: "farm_zones", color: "#b9741d" },
];

export function visualLayerIdForSheet(sheetId) {
  const hit = VISUAL_LAYERS.find((l) => l.sheetId === sheetId);
  if (hit) return hit.id;
  if (sheetId === "partitions" || sheetId === "walls") return "architecture";
  return "architecture";
}

export function PlannerLayerSwitcher({ activeSheetId, onPick }) {
  const activeVisual = visualLayerIdForSheet(activeSheetId);
  return (
    <div className="planner-layer-switcher no-print" role="tablist" aria-label="Слои плана">
      {VISUAL_LAYERS.map((l) => {
        const active = activeVisual === l.id;
        return (
          <button
            key={l.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={"planner-layer-chip" + (active ? " is-active" : "")}
            onClick={() => onPick?.(l.sheetId)}
            title={l.label}
          >
            <span className="planner-layer-chip__dot" style={{ background: l.color }} />
            {l.label}
          </button>
        );
      })}
    </div>
  );
}
