/**
 * PHASE 2F1-LIVE3 — compact RemPlanner-style floating wall editor.
 * Length + thickness + height + material. Screen-space overlay.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  formatLiveLength,
  parseLengthInput,
  placeFloatingEditorScreen,
} from "./core/walls/liveWallMeasurements.js";
import { WALL_MATERIALS } from "./catalog.js";
import "./wallFloatingLengthEditor.css";

function displayDraftFromMm(mm, forceMm = false) {
  if (!Number.isFinite(mm) || mm <= 0) return "";
  if (forceMm || mm < 1000) return String(Math.round(mm));
  return (mm / 1000).toFixed(3);
}

function unitFromMm(mm, forceMm = false) {
  if (forceMm) return "мм";
  return Number.isFinite(mm) && mm >= 1000 ? "м" : "мм";
}

const MATERIAL_OPTIONS = Object.values(WALL_MATERIALS).map((m) => ({
  id: m.id,
  label: m.label,
}));

export function WallFloatingLengthEditor({
  open = false,
  anchorWorld = null,
  view = null,
  getSvgRect = null,
  lengthMm = null,
  readOnly = false,
  disabledReason = null,
  angleDeg = null,
  thkMm = null,
  heightMm = null,
  materialId = null,
  mode = "select",
  bareAsMm = false,
  showExtendedFields = true,
  onApplyLength = null,
  onPreviewLength = null,
  onChangeThickness = null,
  onChangeHeight = null,
  onChangeMaterial = null,
  onCancel = null,
  onClose = null,
  onOpenProperties = null,
  focusRequest = 0,
  inputRef = null,
  seedText = null,
}) {
  const localRef = useRef(null);
  const ref = inputRef || localRef;
  const [draft, setDraft] = useState("");
  const [unit, setUnit] = useState("мм");
  const [error, setError] = useState(null);
  const [pos, setPos] = useState(null);
  const committedMmRef = useRef(lengthMm);
  const typingRef = useRef(false);

  useEffect(() => {
    if (!open) {
      typingRef.current = false;
      return;
    }
    committedMmRef.current = lengthMm;
    if (seedText != null && seedText !== "") {
      setDraft(String(seedText));
      setUnit(bareAsMm || mode === "draw" ? "мм" : unitFromMm(lengthMm, bareAsMm));
      typingRef.current = true;
      return;
    }
    if (!typingRef.current) {
      setDraft(displayDraftFromMm(lengthMm, bareAsMm || mode === "draw"));
      setUnit(unitFromMm(lengthMm, bareAsMm || mode === "draw"));
    }
    setError(null);
  }, [open, lengthMm, mode, bareAsMm, seedText]);

  useLayoutEffect(() => {
    if (!open || !anchorWorld || !view || !getSvgRect) {
      setPos(null);
      return;
    }
    const place = () => {
      const rect = getSvgRect();
      setPos(placeFloatingEditorScreen({
        anchorWorld,
        view,
        svgRect: rect,
        width: showExtendedFields ? 220 : 200,
        height: showExtendedFields ? 148 : 78,
      }));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, anchorWorld?.x, anchorWorld?.y, view?.panX, view?.panY, view?.zoom, getSvgRect, showExtendedFields, error, disabledReason]);

  useEffect(() => {
    if (!open || !focusRequest) return;
    const el = ref.current;
    if (!el || disabledReason) return;
    el.focus();
    el.select?.();
  }, [focusRequest, open, disabledReason, ref]);

  if (!open || !pos) return null;
  if (!(lengthMm > 0) && !disabledReason && !draft) return null;

  const disabled = !!disabledReason;

  const parseDraft = (text) => {
    const raw = (bareAsMm || mode === "draw" || unit === "мм")
      && text && !/[ммmм]/i.test(text)
      ? `${text} мм`
      : (unit === "м" && text && !/[ммmм]/i.test(text) ? `${text} м` : text);
    return parseLengthInput(raw, { bareAsMm: bareAsMm || mode === "draw" });
  };

  const commitDraft = () => {
    if (disabled && mode === "select") return;
    const parsed = parseDraft(draft);
    if (!parsed.ok || !(parsed.mm >= 100)) {
      setError(parsed.reason === "non_positive" || (parsed.ok && parsed.mm < 100)
        ? "Длина должна быть ≥ 100 мм"
        : "Некорректная длина");
      onPreviewLength?.(null, draft);
      return;
    }
    setError(null);
    typingRef.current = false;
    onApplyLength?.(parsed.mm);
  };

  const onChange = (e) => {
    const v = e.target.value;
    typingRef.current = true;
    setDraft(v);
    setError(null);
    if (!v.trim()) {
      onPreviewLength?.(null, v);
      return;
    }
    const parsed = parseDraft(v);
    if (parsed.ok && parsed.mm >= 50) onPreviewLength?.(parsed.mm, v);
    else onPreviewLength?.(null, v);
  };

  const node = (
    <div
      className="dg-wall-float-editor"
      data-ui="wall-floating-length"
      data-mode={mode}
      style={{ left: pos.left, top: pos.top, width: pos.width }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="dg-wall-float-editor__row">
        <span className="dg-wall-float-editor__label">Длина</span>
        <input
          ref={ref}
          className="dg-wall-float-editor__input"
          type="text"
          inputMode="decimal"
          value={draft}
          disabled={disabled && mode === "select"}
          readOnly={readOnly}
          aria-label="Длина стены"
          onChange={onChange}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              typingRef.current = false;
              setDraft(displayDraftFromMm(committedMmRef.current, bareAsMm || mode === "draw"));
              setError(null);
              onCancel?.();
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              commitDraft();
            }
          }}
        />
        <span className="dg-wall-float-editor__unit">{unit}</span>
        {onOpenProperties && (
          <button
            type="button"
            className="dg-wall-float-editor__gear"
            title="Все свойства"
            aria-label="Все свойства"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenProperties();
            }}
          >
            ⚙
          </button>
        )}
        {onClose && mode === "select" && (
          <button
            type="button"
            className="dg-wall-float-editor__close"
            title="Закрыть"
            aria-label="Закрыть редактор"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
          >
            ×
          </button>
        )}
      </div>

      {showExtendedFields && mode === "select" && (
        <div className="dg-wall-float-editor__fields">
          <label className="dg-wall-float-editor__field">
            <span>Толщ.</span>
            <input
              type="number"
              min={50}
              step={10}
              value={thkMm ?? ""}
              disabled={disabled}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 50) onChangeThickness?.(n);
              }}
            />
            <span className="dg-wall-float-editor__unit">мм</span>
          </label>
          <label className="dg-wall-float-editor__field">
            <span>Высота</span>
            <input
              type="number"
              min={100}
              step={50}
              value={heightMm ?? ""}
              disabled={disabled}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 100) onChangeHeight?.(n);
              }}
            />
            <span className="dg-wall-float-editor__unit">мм</span>
          </label>
          <label className="dg-wall-float-editor__field dg-wall-float-editor__field--wide">
            <span>Матер.</span>
            <select
              value={materialId || ""}
              disabled={disabled}
              onChange={(e) => onChangeMaterial?.(e.target.value)}
            >
              {MATERIAL_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="dg-wall-float-editor__meta">
        {Number.isFinite(angleDeg) && <span>угол {angleDeg.toFixed(1)}°</span>}
        {mode === "draw" && Number.isFinite(lengthMm) && (
          <span className="dg-wall-float-editor__hint">{formatLiveLength(lengthMm)}</span>
        )}
        {disabledReason && <span className="dg-wall-float-editor__lock">{disabledReason}</span>}
      </div>
      {error && !disabledReason && (
        <div className="dg-wall-float-editor__error" role="alert">{error}</div>
      )}
      {mode === "select" && (
        <button
          type="button"
          className="dg-wall-float-editor__all"
          onClick={(e) => {
            e.preventDefault();
            onOpenProperties?.();
          }}
        >
          Все свойства
        </button>
      )}
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(node, document.body);
}

export default WallFloatingLengthEditor;
