import React, { useState } from "react";
import {
  SNAP_STEPS,
  SNAP_ROUND_OPTIONS,
  ARROW_STEP_OPTIONS,
  COORD_UNITS,
  GRID_FINE_STEP,
  GRID_MINOR_STEP,
  GRID_MEDIUM_STEP,
  GRID_MAJOR_STEP,
  GRID_XL_STEP,
} from "../gridSettings.js";

const HIGHLIGHT_TOGGLES = [
  { key: "highlightRacks", label: "Стеллажи" },
  { key: "highlightSockets", label: "Розетки" },
  { key: "highlightFurniture", label: "Мебель" },
  { key: "highlightErrors", label: "Ошибки" },
  { key: "showStateIcons", label: "Статусы" },
];

const LAYER_TOGGLES = [
  { key: "dimInactive", label: "Приглушать слои" },
  { key: "highlightActive", label: "Активный ярче" },
  { key: "showZoneFlow", label: "Типы зон" },
  { key: "showZoneAreas", label: "Площади помещений" },
  { key: "showZoneFill", label: "Заливка помещений" },
  { key: "roomWhiteFill", label: "Белый пол" },
  { key: "zoneContoursOnly", label: "Только контуры" },
];

export function PlannerBottomBar({
  zoom,
  display,
  unit = "mm",
  onUnitChange,
  onZoomPreset,
  onToggle,
  onSetDisplay,
  onFit,
  onFitLayer,
  onCenter,
  onClearSheet,
  activeLayerName,
  onUndo,
  onRedo,
  onDelete,
  onCopy,
  onGroup,
  onMeasure,
  onLabel,
  onComment,
  onExportPdf,
  footerLeft,
}) {
  const [showDisplay, setShowDisplay] = useState(false);
  const [showGridPop, setShowGridPop] = useState(false);
  const pct = Math.round(zoom * 100);
  const snapStep = display.snapStep ?? display.gridStep ?? 50;

  return (
    <div className="planner-bottom-bar no-print">
      <div className="planner-bottom-bar__group planner-bottom-bar__group--left">
        {footerLeft}
      </div>

      <div className="planner-bottom-bar__group planner-bottom-bar__group--center">
        <span className="planner-bottom-sheet">{activeLayerName}</span>
        <div className="planner-bottom-units">
          {COORD_UNITS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={"planner-bottom-btn planner-bottom-btn--sm" + ((unit || display.coordUnit || "mm") === id ? " planner-bottom-btn--on" : "")}
              onClick={() => onUnitChange?.(id) || onSetDisplay({ coordUnit: id })}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="planner-bottom-btn" onClick={onUndo} title="Отменить (Ctrl+Z)">↶</button>
        <button type="button" className="planner-bottom-btn" onClick={onRedo} title="Повторить (Ctrl+Y)">↷</button>
        <button type="button" className="planner-bottom-btn" onClick={onDelete} title="Удалить (Del)">⌫</button>
        <button type="button" className="planner-bottom-btn" onClick={onCopy} title="Копировать (Ctrl+C)">⧉</button>
        <button type="button" className="planner-bottom-btn" onClick={onGroup} title="Группировать (Ctrl+G)">⊞</button>
        <button type="button" className="planner-bottom-btn" onClick={onMeasure} title="Размер">⊢</button>
        <button type="button" className="planner-bottom-btn" onClick={onLabel} title="Подпись">T</button>
        <button type="button" className="planner-bottom-btn" onClick={onComment} title="Комментарий">💬</button>
        <button
          type="button"
          className={"planner-bottom-btn" + (display.showGrid !== false ? " planner-bottom-btn--on" : "")}
          onClick={() => setShowGridPop((s) => !s)}
          title="Сетка"
        >
          #
        </button>
        {showGridPop && (
          <div className="planner-display-pop planner-display-pop--wide planner-display-pop--up">
            <div className="planner-display-pop__section">Сетка</div>
            <Toggle label="Показывать сетку" on={display.showGrid !== false} onClick={() => onToggle("showGrid")} />
            <Toggle label={`Тонкая (${GRID_FINE_STEP} мм)`} on={display.showFineGrid !== false} onClick={() => onToggle("showFineGrid")} />
            <Toggle label={`Мелкая (${GRID_MINOR_STEP} мм)`} on={display.showMinorGrid !== false} onClick={() => onToggle("showMinorGrid")} />
            <Toggle label={`Средняя (${GRID_MEDIUM_STEP} мм)`} on={display.showMediumGrid !== false} onClick={() => onToggle("showMediumGrid")} />
            <Toggle label={`Крупная (${GRID_MAJOR_STEP} / ${GRID_XL_STEP} мм)`} on={display.showMajorGrid !== false} onClick={() => onToggle("showMajorGrid")} />
            <div className="planner-display-pop__section">Магнит</div>
            <Toggle label="Привязка к сетке" on={display.snapGrid !== false} onClick={() => onToggle("snapGrid")} />
            <Toggle label="К стенам" on={display.snapWalls !== false} onClick={() => onToggle("snapWalls")} />
            <Toggle label="К объектам" on={display.snapObjects !== false} onClick={() => onToggle("snapObjects")} />
            <Toggle label="Углы 0/45/90" on={display.snapAngles !== false} onClick={() => onToggle("snapAngles")} />
            <Toggle label="Направляющие" on={display.snapGuides !== false} onClick={() => onToggle("snapGuides")} />
            <Toggle label="Только внутри помещений" on={!!display.onlyInsideRooms} onClick={() => onToggle("onlyInsideRooms")} />
            <div className="planner-display-pop__hint">Шаг сетки (мм)</div>
            {SNAP_STEPS.map((step) => (
              <button
                key={step}
                type="button"
                className={"planner-bottom-btn" + (snapStep === step ? " planner-bottom-btn--on" : "")}
                onClick={() => onSetDisplay({ snapStep: step, gridStep: step })}
              >
                {step}
              </button>
            ))}
            <div className="planner-display-pop__section">Шаг стрелок (мм)</div>
            {ARROW_STEP_OPTIONS.map((step) => (
              <button
                key={`arr-${step}`}
                type="button"
                className={"planner-bottom-btn" + ((display.arrowStepMm ?? 10) === step ? " planner-bottom-btn--on" : "")}
                onClick={() => onSetDisplay({ arrowStepMm: step })}
                title={`Базовый шаг перемещения: ${step} мм`}
              >
                {step}
              </button>
            ))}
          </div>
        )}
        <Toggle label="Магниты" on={display.snapOn} onClick={() => onToggle("snapOn")} />
        <Toggle label="Подписи" on={display.showLabels} onClick={() => onToggle("showLabels")} />
        <Toggle label="Размеры" on={display.showDims} onClick={() => onToggle("showDims")} />
        <Toggle label="Подсказки" on={display.showHints} onClick={() => onToggle("showHints")} />
        <button type="button" className="planner-bottom-btn" onClick={onCenter} title="Центрировать">⊙</button>
        <button
          type="button"
          className={"planner-bottom-btn" + (showDisplay ? " planner-bottom-btn--on" : "")}
          onClick={() => setShowDisplay((s) => !s)}
        >
          Отображение ▾
        </button>
        {showDisplay && (
          <div className="planner-display-pop planner-display-pop--up">
            <div className="planner-display-pop__section">Подсветка</div>
            {HIGHLIGHT_TOGGLES.map(({ key, label }) => (
              <Toggle key={key} label={label} on={display[key]} onClick={() => onToggle(key)} />
            ))}
            <div className="planner-display-pop__section">Слои</div>
            {LAYER_TOGGLES.map(({ key, label }) => (
              <Toggle key={key} label={label} on={display[key]} onClick={() => onToggle(key)} />
            ))}
            <Toggle label="Дуги дверей" on={display.showDoorArcs !== false} onClick={() => onToggle("showDoorArcs")} />
            <Toggle label="Только проёмы" on={!!display.doorOpeningsOnly} onClick={() => onToggle("doorOpeningsOnly")} />
            <Toggle label="Сервисные зоны" on={display.showServiceZones} onClick={() => onToggle("showServiceZones")} />
            <Toggle label="Порты" on={display.showPorts} onClick={() => onToggle("showPorts")} />
            <Toggle label="Связи" on={display.showLinks} onClick={() => onToggle("showLinks")} />
            <div className="planner-display-pop__section">Размеры</div>
            <Toggle label="Габариты" on={display.showObjectDims !== false} onClick={() => onToggle("showObjectDims")} />
            <Toggle label="Отступы" on={display.showClearanceDims !== false} onClick={() => onToggle("showClearanceDims")} />
            <div className="planner-display-pop__section">PDF</div>
            <Toggle label="Сетка в монтажном PDF" on={!!display.pdfGridInstall} onClick={() => onToggle("pdfGridInstall")} />
            <Toggle label="Сетка в тех. листах PDF" on={!!display.pdfGridTechnical} onClick={() => onToggle("pdfGridTechnical")} />
            <Toggle label="Только крупная сетка в PDF" on={display.pdfGridMajorOnly !== false} onClick={() => onToggle("pdfGridMajorOnly")} />
          </div>
        )}
        {onExportPdf && (
          <button type="button" className="planner-bottom-btn planner-bottom-btn--accent" onClick={onExportPdf}>
            PDF
          </button>
        )}
      </div>

      <div className="planner-bottom-bar__group planner-bottom-bar__group--right">
        <button type="button" className="planner-bottom-btn" onClick={onFit} title="Вместить план">⊡</button>
        <button type="button" className="planner-bottom-btn" onClick={onFitLayer} title="Вместить слой">⊡+</button>
        <button type="button" className="planner-bottom-btn planner-bottom-btn--danger" onClick={onClearSheet} title="Очистить лист">✕</button>
        <input
          type="range"
          className="planner-bottom-slider"
          min={1}
          max={300}
          value={pct}
          onChange={(e) => onZoomPreset(+e.target.value / 100)}
          title="Масштаб"
        />
        <span className="planner-bottom-zoom">{pct}%</span>
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
