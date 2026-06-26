import React from "react";

export function CanvasControls({
  zoom,
  snapOn,
  showDims,
  showGrid,
  onZoomIn,
  onZoomOut,
  onToggleSnap,
  onToggleDims,
  onToggleGrid,
  onFit,
}) {
  return (
    <div className="planner-float-controls no-print">
      <button type="button" className="planner-float-btn" onClick={onZoomOut} title="Уменьшить">−</button>
      <span className="planner-float-zoom">{Math.round(zoom * 100)}%</span>
      <button type="button" className="planner-float-btn" onClick={onZoomIn} title="Увеличить">+</button>
      <button
        type="button"
        className={"planner-float-btn" + (showGrid ? " planner-float-btn--on" : "")}
        onClick={onToggleGrid}
        title="Сетка"
      >
        #
      </button>
      <button
        type="button"
        className={"planner-float-btn" + (snapOn ? " planner-float-btn--on" : "")}
        onClick={onToggleSnap}
        title="Магнит"
      >
        ⊕
      </button>
      <button
        type="button"
        className={"planner-float-btn" + (showDims ? " planner-float-btn--on" : "")}
        onClick={onToggleDims}
        title="Размеры"
      >
        ⊢
      </button>
      <button type="button" className="planner-float-btn" onClick={onFit} title="В размер">
        ⊡
      </button>
    </div>
  );
}
