import React from "react";

export function PlannerZoomControl({
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomSlider,
  onFit,
  onReset,
}) {
  const pct = Math.round(zoom * 100);

  return (
    <div className="planner-zoom-control planner-zoom-control--compact no-print" role="group" aria-label="Масштаб">
      <button type="button" className="planner-zoom-btn" onClick={onZoomOut} title="Уменьшить" aria-label="Уменьшить">
        −
      </button>
      <button
        type="button"
        className="planner-zoom-pct"
        title="Масштаб — клик для 100%"
        onClick={() => onZoomSlider?.(1)}
      >
        {pct}%
      </button>
      <button type="button" className="planner-zoom-btn" onClick={onZoomIn} title="Увеличить" aria-label="Увеличить">
        +
      </button>
      <button type="button" className="planner-zoom-btn planner-zoom-btn--fit" onClick={onFit} title="Показать весь план">
        Fit
      </button>
      <button type="button" className="planner-zoom-btn" onClick={onReset || (() => onZoomSlider?.(0.25))} title="Сброс масштаба">
        Reset
      </button>
    </div>
  );
}
