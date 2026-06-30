import React from "react";
import {
  DEFAULT_VISUAL,
  VISUAL_PRESETS,
  normalizeVisualPrefs,
} from "../plannerVisualSettings.js";

const SLIDERS = [
  {
    section: "Сетка",
    items: [
      { key: "gridOpacity", label: "Яркость сетки", min: 0.2, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: "gridStrokeMul", label: "Толщина линий сетки", min: 0.6, max: 2.2, step: 0.05, fmt: (v) => `×${v.toFixed(2)}` },
    ],
  },
  {
    section: "Размерные линии",
    items: [
      { key: "dimScale", label: "Масштаб (текст и линии)", min: 0.7, max: 2, step: 0.05, fmt: (v) => `×${v.toFixed(2)}` },
      { key: "dimOffsetMul", label: "Вынос от объекта", min: 0.6, max: 2.2, step: 0.05, fmt: (v) => `×${v.toFixed(2)}` },
      { key: "dimOpacity", label: "Яркость размеров", min: 0.4, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    ],
  },
  {
    section: "Стены",
    items: [
      { key: "wallHatchSpacing", label: "Шаг штриховки, мм", min: 40, max: 100, step: 2, fmt: (v) => `${Math.round(v)} мм` },
      { key: "wallHatchOpacity", label: "Яркость штриховки", min: 0.15, max: 0.75, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
      { key: "wallStrokeMul", label: "Толщина контура", min: 0.7, max: 1.5, step: 0.03, fmt: (v) => `×${v.toFixed(2)}` },
    ],
  },
  {
    section: "Подписи",
    items: [
      { key: "labelScale", label: "Масштаб подписей", min: 0.8, max: 1.6, step: 0.05, fmt: (v) => `×${v.toFixed(2)}` },
    ],
  },
];

export function PlannerVisualSettingsModal({ open, display, onPatch, onClose }) {
  if (!open) return null;

  const vis = normalizeVisualPrefs(display);

  const setKey = (key, value) => {
    onPatch?.({ [key]: value });
  };

  return (
    <div className="planner-visual-modal" role="dialog" aria-modal="true" aria-label="Настройки отображения">
      <button type="button" className="planner-visual-modal__backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="planner-visual-modal__panel">
        <div className="planner-visual-modal__head">
          <div>
            <div className="planner-visual-modal__title">Настройки отображения</div>
            <div className="planner-visual-modal__sub">Сетка, размеры, стены и подписи — сохраняются автоматически</div>
          </div>
          <button type="button" className="planner-visual-modal__close" onClick={onClose}>×</button>
        </div>

        <div className="planner-visual-modal__presets">
          {VISUAL_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="planner-btn"
              onClick={() => onPatch?.(p.values)}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            className="planner-btn"
            onClick={() => onPatch?.({ ...DEFAULT_VISUAL })}
          >
            Сброс
          </button>
        </div>

        <div className="planner-visual-modal__body">
          {SLIDERS.map(({ section, items }) => (
            <section key={section} className="planner-visual-modal__section">
              <div className="planner-visual-modal__section-title">{section}</div>
              {items.map(({ key, label, min, max, step, fmt }) => (
                <div key={key} className="planner-visual-slider">
                  <div className="planner-visual-slider__row">
                    <label htmlFor={`vis-${key}`}>{label}</label>
                    <span className="planner-visual-slider__val">{fmt(vis[key])}</span>
                  </div>
                  <input
                    id={`vis-${key}`}
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={vis[key]}
                    onChange={(e) => setKey(key, +e.target.value)}
                  />
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
