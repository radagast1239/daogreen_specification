import React from "react";
import "./PlannerViewportControls.css";

export function PlannerViewportControls({ zoom = 1, onZoomOut, onZoomIn, onFit, onReset, className = "" }) {
  return (
    <div className={`planner-viewport-controls no-print ${className}`.trim()} role="group" aria-label="Масштаб плана">
      <button type="button" onClick={onZoomOut} title="Уменьшить масштаб" aria-label="Уменьшить масштаб">−</button>
      <output aria-label="Текущий масштаб">{Math.round(zoom * 100)}%</output>
      <button type="button" onClick={onZoomIn} title="Увеличить масштаб" aria-label="Увеличить масштаб">+</button>
      <button type="button" onClick={onFit} title="Показать весь план" aria-label="Показать весь план">Fit</button>
      <button type="button" onClick={onReset} title="Сбросить вид" aria-label="Сбросить вид">Reset</button>
    </div>
  );
}
