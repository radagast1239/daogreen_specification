import React, { useState } from "react";
import {
  SNAP_STEPS,
  SNAP_ROUND_OPTIONS,
  ARROW_STEP_OPTIONS,
  COORD_UNITS,
  GRID_MINOR_STEP,
  GRID_MEDIUM_STEP,
  GRID_MAJOR_STEP,
} from "../gridSettings.js";
import { DIMENSION_DISPLAY_MODES } from "../core/dimensions/display.js";

const DIMENSION_MODE_LABELS = {
  mm: "мм",
  cm: "см",
  m: "м",
  remplanner_cm: "Rem CM",
};

const HIGHLIGHT_TOGGLES = [
  { key: "highlightRacks", label: "Стеллажи" },
  { key: "highlightSockets", label: "Розетки" },
  { key: "highlightFurniture", label: "Мебель" },
  { key: "highlightErrors", label: "Ошибки" },
  { key: "showStateIcons", label: "Статусы" },
];

const LAYER_TOGGLES = [
  { key: "dimInactive", label: "Серые фоновые слои" },
  { key: "highlightActive", label: "Активный ярче" },
  { key: "showZoneAreas", label: "Площади помещений" },
  { key: "roomWhiteFill", label: "Белый пол" },
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
  eraseMode = false,
  onDelete,
  onCopy,
  onGroup,
  onMeasure,
  onLabel,
  onComment,
  onExportPdf,
  onOpenVisualSettings,
  onOpenMaterialPresets,
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
              className={"planner-bottom-btn planner-bottom-btn--sm" + ((display.coordUnit || unit || "mm") === id ? " planner-bottom-btn--on" : "")}
              onClick={() => (onUnitChange ? onUnitChange(id) : onSetDisplay?.({ coordUnit: id }))}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="planner-bottom-btn" onClick={onUndo} title="Отменить (Ctrl+Z)">↶</button>
        <button type="button" className="planner-bottom-btn" onClick={onRedo} title="Повторить (Ctrl+Y)">↷</button>
        <button
          type="button"
          className={"planner-bottom-btn" + (eraseMode ? " planner-bottom-btn--on" : "")}
          onClick={onDelete}
          title="Удалить выделенное (Del) или режим удаления по клику"
        >
          ⌫
        </button>
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
            <Toggle label={`Мелкая (${GRID_MINOR_STEP} мм)`} on={display.showMinorGrid !== false} onClick={() => onToggle("showMinorGrid")} />
            <Toggle label={`Средняя (${GRID_MEDIUM_STEP} мм)`} on={display.showMediumGrid !== false} onClick={() => onToggle("showMediumGrid")} />
            <Toggle label={`Крупная (${GRID_MAJOR_STEP} мм)`} on={display.showMajorGrid !== false} onClick={() => onToggle("showMajorGrid")} />
            <Toggle label="Оси X/Y" on={!!display.showAxes} onClick={() => onToggle("showAxes")} />
            <div className="planner-display-pop__section">Магнит</div>
            <Toggle label="Привязка к сетке" on={display.snapGrid !== false} onClick={() => onToggle("snapGrid")} />
            <Toggle label="К стенам" on={display.snapWalls !== false} onClick={() => onToggle("snapWalls")} />
            <Toggle label="К объектам" on={display.snapObjects !== false} onClick={() => onToggle("snapObjects")} />
            <Toggle label="Углы 0/45/90" on={display.snapAngles !== false} onClick={() => onToggle("snapAngles")} />
            <Toggle label="Направляющие" on={display.snapGuides !== false} onClick={() => onToggle("snapGuides")} />
            <Toggle label="Только внутри помещений" on={!!display.onlyInsideRooms} onClick={() => onToggle("onlyInsideRooms")} />
            <div className="planner-display-pop__hint">Шаг привязки (мм) · Alt — без магнита</div>
            {SNAP_STEPS.map((step) => (
              <button
                key={step}
                type="button"
                className={"planner-bottom-btn" + (snapStep === step ? " planner-bottom-btn--on" : "")}
                onClick={() => onSetDisplay({ snapStep: step })}
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
        {onOpenVisualSettings && (
          <button
            type="button"
            className="planner-bottom-btn"
            onClick={onOpenVisualSettings}
            title="Настройки отображения: сетка, размеры, стены, подписи"
          >
            ◐
          </button>
        )}
        {onOpenMaterialPresets && (
          <button
            type="button"
            className="planner-bottom-btn"
            onClick={onOpenMaterialPresets}
            title="Типовые размеры материалов: ёмкости, стеллажи, насосы и др."
          >
            мм
          </button>
        )}
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
            <Toggle label="Линейки" on={display.showRulers !== false} onClick={() => onToggle("showRulers")} />
            <Toggle label="Чистовые цепочки" on={display.showWallChainFinishing !== false} onClick={() => onToggle("showWallChainFinishing")} />
            <Toggle label="Габаритные цепочки" on={display.showWallChainGross !== false} onClick={() => onToggle("showWallChainGross")} />
            <Toggle label="Отступы" on={display.showClearanceDims !== false} onClick={() => onToggle("showClearanceDims")} />
            <div className="planner-display-pop__hint">Формат размерных подписей</div>
            {DIMENSION_DISPLAY_MODES.map((mode) => (
              <button
                key={`dim-mode-${mode}`}
                type="button"
                className={"planner-bottom-btn" + ((display.dimensionDisplayMode || "remplanner_cm") === mode ? " planner-bottom-btn--on" : "")}
                onClick={() => onSetDisplay({ dimensionDisplayMode: mode })}
              >
                {DIMENSION_MODE_LABELS[mode] || mode}
              </button>
            ))}
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
