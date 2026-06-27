import React from "react";

export function PlannerZoomControl({
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomSlider,
  onFit,
  onCenter,
  onPan,
}) {
  const pct = Math.round(zoom * 100);

  return (
    <div className="planner-zoom-control no-print">
      <button type="button" className="planner-zoom-btn" onClick={() => onPan?.("up")} title="Сместить вверх" aria-label="Вверх">
        ↑
      </button>
      <div className="planner-zoom-control__row">
        <button type="button" className="planner-zoom-btn" onClick={() => onPan?.("left")} title="Сместить влево" aria-label="Влево">
          ←
        </button>
        <button type="button" className="planner-zoom-btn planner-zoom-btn--fit" onClick={onCenter} title="Центрировать">
          ⊙
        </button>
        <button type="button" className="planner-zoom-btn" onClick={() => onPan?.("right")} title="Сместить вправо" aria-label="Вправо">
          →
        </button>
      </div>
      <button type="button" className="planner-zoom-btn" onClick={() => onPan?.("down")} title="Сместить вниз" aria-label="Вниз">
        ↓
      </button>
      <div className="planner-zoom-control__zoom">
        <button type="button" className="planner-zoom-btn" onClick={onZoomOut} title="Уменьшить">−</button>
        <input
          type="range"
          className="planner-zoom-slider"
          min={1}
          max={300}
          value={pct}
          onChange={(e) => onZoomSlider(+e.target.value / 100)}
          title="Масштаб"
        />
        <button type="button" className="planner-zoom-btn" onClick={onZoomIn} title="Увеличить">+</button>
      </div>
      <span className="planner-zoom-pct">{pct}%</span>
      <button type="button" className="planner-zoom-btn planner-zoom-btn--fit" onClick={onFit} title="Вместить план">
        ⊡
      </button>
    </div>
  );
}
