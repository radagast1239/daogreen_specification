import React, { useState } from "react";

const ZOOM_PRESETS = [0.25, 0.5, 1, 2];

const HIGHLIGHT_TOGGLES = [
  { key: "highlightRacks", label: "Стеллажи" },
  { key: "highlightSockets", label: "Розетки" },
  { key: "highlightFurniture", label: "Мебель" },
  { key: "highlightErrors", label: "Ошибки" },
];

export function PlannerBottomBar({
  zoom,
  display,
  onZoomPreset,
  onZoomSlider,
  onToggle,
  onFit,
  onCenter,
  onClearSheet,
  activeLayerName,
}) {
  const [showDisplay, setShowDisplay] = useState(false);
  const pct = Math.round(zoom * 100);

  return (
    <div className="planner-bottom-bar no-print">
      <div className="planner-bottom-bar__group">
        <span className="planner-bottom-bar__label">Масштаб</span>
        {ZOOM_PRESETS.map((z) => (
          <button
            key={z}
            type="button"
            className={"planner-bottom-btn" + (Math.abs(zoom - z) < 0.02 ? " planner-bottom-btn--on" : "")}
            onClick={() => onZoomPreset(z)}
          >
            {z * 100}%
          </button>
        ))}
        <input
          type="range"
          className="planner-bottom-slider"
          min={1}
          max={300}
          value={pct}
          onChange={(e) => onZoomSlider(+e.target.value / 100)}
          title="Масштаб"
        />
        <span className="planner-bottom-zoom">{pct}%</span>
      </div>

      <div className="planner-bottom-bar__group">
        <Toggle label="Сетка" on={display.showGrid} onClick={() => onToggle("showGrid")} />
        <Toggle label="Размеры" on={display.showDims} onClick={() => onToggle("showDims")} />
        <Toggle label="Магниты" on={display.snapOn} onClick={() => onToggle("snapOn")} />
        <Toggle label="Подсказки" on={display.showHints} onClick={() => onToggle("showHints")} />
        <Toggle label="Подписи" on={display.showLabels} onClick={() => onToggle("showLabels")} />
        <Toggle label="Скрыть неактив." on={display.hideInactive} onClick={() => onToggle("hideInactive")} />
        <Toggle label="Только в помещ." on={display.onlyInsideRooms} onClick={() => onToggle("onlyInsideRooms")} />
        <button
          type="button"
          className={"planner-bottom-btn" + (showDisplay ? " planner-bottom-btn--on" : "")}
          onClick={() => setShowDisplay((s) => !s)}
        >
          Подсветка ▾
        </button>
        {showDisplay && (
          <div className="planner-display-pop">
            {HIGHLIGHT_TOGGLES.map(({ key, label }) => (
              <Toggle key={key} label={label} on={display[key]} onClick={() => onToggle(key)} />
            ))}
          </div>
        )}
      </div>

      <div className="planner-bottom-bar__group planner-bottom-bar__group--right">
        <span className="planner-bottom-sheet">{activeLayerName}</span>
        <button type="button" className="planner-bottom-btn" onClick={onCenter} title="Центрировать (F)">
          Центрировать
        </button>
        <button type="button" className="planner-bottom-btn" onClick={onFit} title="В размер">
          В размер
        </button>
        <button type="button" className="planner-bottom-btn planner-bottom-btn--danger" onClick={onClearSheet} title="Очистить объекты листа">
          Очистить лист
        </button>
      </div>
    </div>
  );
}

function Toggle({ label, on, onClick }) {
  return (
    <button
      type="button"
      className={"planner-bottom-btn" + (on ? " planner-bottom-btn--on" : "")}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
