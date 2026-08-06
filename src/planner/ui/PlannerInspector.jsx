import React, { useEffect, useRef, useState } from "react";
import "./PlannerInspector.css";

/**
 * Изолированная, persistent панель свойств выбранного элемента плана.
 * Только props/callbacks — не импортирует store/actions и не мутирует plan
 * напрямую. Вызывающая сторона решает, что делать с onChange/onCommand.
 *
 * selection: { type: 'wall'|'node'|'door'|'window'|'dimension'|'object'|'room', id } | null
 * entity: данные выбранного элемента (форма зависит от selection.type)
 * warnings: [{ id, message, level: 'warning'|'error' }] | string[]
 * context: { layer, level, scale } — для пустого состояния
 *
 * presentationMode: 'auto' (breakpoint-driven, default) | 'docked' (always a
 *   side panel) | 'sheet' (always a bottom sheet, regardless of viewport)
 * sheetState: controlled bottom-sheet phase — 'closed' | 'peek' | 'half' |
 *   'expanded'. Omit to let the component manage it uncontrolled.
 * onSheetStateChange: notified whenever the phase changes, controlled or not.
 */

const KNOWN_TYPES = new Set(["wall", "node", "door", "window", "dimension", "object", "room"]);
const SHEET_PHASES = ["closed", "peek", "half", "expanded"];
const PRESENTATION_MODES = new Set(["auto", "docked", "sheet"]);

function isValidPhase(v) {
  return SHEET_PHASES.includes(v);
}

function Field({ label, children, readOnly }) {
  return (
    <div className={"dg-insp-field" + (readOnly ? " dg-insp-field--readonly" : "")}>
      <label className="dg-insp-field__label">{label}</label>
      <div className="dg-insp-field__control">{children}</div>
    </div>
  );
}

function NumberField({ label, value, unit, onCommit, readOnly, min, step }) {
  const [draft, setDraft] = useState(value ?? "");
  React.useEffect(() => setDraft(value ?? ""), [value]);

  if (readOnly) {
    return (
      <Field label={label} readOnly>
        <span className="dg-insp-readonly-value">
          {value ?? "—"}
          {unit ? ` ${unit}` : ""}
        </span>
      </Field>
    );
  }

  return (
    <Field label={label}>
      <div className="dg-insp-number">
        <input
          type="number"
          className="dg-insp-input"
          value={draft}
          min={min}
          step={step}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== "" && String(draft) !== String(value) && !Number.isNaN(Number(draft))) {
              onCommit?.(Number(draft));
            } else {
              setDraft(value ?? "");
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setDraft(value ?? "");
              e.currentTarget.blur();
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              if (draft !== "" && !Number.isNaN(Number(draft))) onCommit?.(Number(draft));
              e.currentTarget.blur();
            }
          }}
        />
        {unit ? <span className="dg-insp-unit">{unit}</span> : null}
      </div>
    </Field>
  );
}

function TextField({ label, value, onCommit, readOnly }) {
  const [draft, setDraft] = useState(value ?? "");
  React.useEffect(() => setDraft(value ?? ""), [value]);

  if (readOnly) {
    return (
      <Field label={label} readOnly>
        <span className="dg-insp-readonly-value">{value || "—"}</span>
      </Field>
    );
  }

  return (
    <Field label={label}>
      <input
        type="text"
        className="dg-insp-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onCommit?.(draft);
        }}
      />
    </Field>
  );
}

function SelectField({ label, value, options = [], onCommit, readOnly }) {
  if (readOnly) {
    const opt = options.find((o) => o.value === value);
    return (
      <Field label={label} readOnly>
        <span className="dg-insp-readonly-value">{opt?.label || value || "—"}</span>
      </Field>
    );
  }
  return (
    <Field label={label}>
      <select className="dg-insp-input" value={value ?? ""} onChange={(e) => onCommit?.(e.target.value)}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function CheckField({ label, checked, onCommit, readOnly }) {
  return (
    <Field label={label} readOnly={readOnly}>
      <input
        type="checkbox"
        checked={!!checked}
        disabled={readOnly}
        onChange={(e) => onCommit?.(e.target.checked)}
      />
    </Field>
  );
}

function WarningBanner({ warnings }) {
  const list = (warnings || []).map((w) => (typeof w === "string" ? { message: w, level: "warning" } : w));
  if (!list.length) return null;
  return (
    <div className="dg-insp-warnings" role="status">
      {list.map((w, i) => (
        <div key={w.id || i} className={"dg-insp-warning dg-insp-warning--" + (w.level || "warning")}>
          {w.message}
        </div>
      ))}
    </div>
  );
}

function DeleteButton({ onConfirm, label = "Удалить" }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <div className="dg-insp-delete-confirm">
        <span>Удалить безвозвратно?</span>
        <div className="dg-insp-delete-confirm__actions">
          <button type="button" className="dg-insp-btn dg-insp-btn--danger" onClick={() => { setConfirming(false); onConfirm(); }}>
            Подтвердить
          </button>
          <button type="button" className="dg-insp-btn" onClick={() => setConfirming(false)}>
            Отмена
          </button>
        </div>
      </div>
    );
  }
  return (
    <button type="button" className="dg-insp-btn dg-insp-btn--danger-outline" onClick={() => setConfirming(true)}>
      {label}
    </button>
  );
}

function EmptyState({ context, onFitPlan }) {
  return (
    <div className="dg-insp-empty">
      <div className="dg-insp-empty__title">Ничего не выбрано</div>
      <p className="dg-insp-empty__hint">
        Выберите стену, объект или зону на плане, чтобы увидеть и изменить их свойства.
      </p>
      <div className="dg-insp-section">
        <Field label="Слой" readOnly>
          <span className="dg-insp-readonly-value">{context?.layer || "—"}</span>
        </Field>
        <Field label="Уровень" readOnly>
          <span className="dg-insp-readonly-value">{context?.level ?? "—"}</span>
        </Field>
        <Field label="Масштаб" readOnly>
          <span className="dg-insp-readonly-value">{context?.scale ? `1:${context.scale}` : "—"}</span>
        </Field>
      </div>
      <button type="button" className="dg-insp-btn dg-insp-btn--primary" onClick={() => onFitPlan?.()}>
        Показать весь план
      </button>
    </div>
  );
}

function WallSection({ entity, onChange, onCommand }) {
  const commit = (field) => (value) => onChange?.({ id: entity.id, type: "wall", field, value });
  const lengthReadOnly = entity.lengthEditable === false;
  return (
    <div className="dg-insp-section">
      <NumberField
        label="Длина"
        value={entity.length}
        unit={entity.lengthUnit || "мм"}
        readOnly={lengthReadOnly}
        min={100}
        onCommit={commit("length")}
      />
      {lengthReadOnly && entity.lengthDisabledReason ? (
        <p className="dg-insp-hint" style={{ fontSize: 12, opacity: 0.75, margin: "0 0 8px" }}>
          {entity.lengthDisabledReason}
        </p>
      ) : (
        <p className="dg-insp-hint" style={{ fontSize: 12, opacity: 0.65, margin: "0 0 8px" }}>
          Ввод в мм (например 3000) или в м с единицей (3 м). Enter — применить, Escape — отмена.
        </p>
      )}
      <NumberField label="Толщина" value={entity.thickness} unit="мм" onCommit={commit("thickness")} />
      <NumberField label="Угол" value={entity.angle} unit="°" readOnly onCommit={commit("angle")} />
      <SelectField
        label="Тип"
        value={entity.wallType}
        options={entity.wallTypeOptions || [{ value: entity.wallType, label: entity.wallType || "—" }]}
        onCommit={commit("wallType")}
      />
      <div className="dg-insp-actions">
        <button type="button" className="dg-insp-btn" onClick={() => onCommand?.("split", { id: entity.id })}>
          Разделить
        </button>
        <DeleteButton onConfirm={() => onCommand?.("delete", { id: entity.id, type: "wall" })} />
      </div>
    </div>
  );
}

function NodeSection({ entity, onChange, onCommand }) {
  const commit = (field) => (value) => onChange?.({ id: entity.id, type: "node", field, value });
  return (
    <div className="dg-insp-section">
      <NumberField label="X" value={entity.x} unit="мм" onCommit={commit("x")} />
      <NumberField label="Y" value={entity.y} unit="мм" onCommit={commit("y")} />
      <Field label="Стен в узле" readOnly>
        <span className="dg-insp-readonly-value">{entity.connectedWallCount ?? 0}</span>
      </Field>
      <div className="dg-insp-actions">
        {entity.canMerge ? (
          <button type="button" className="dg-insp-btn" onClick={() => onCommand?.("merge", { id: entity.id })}>
            Объединить
          </button>
        ) : null}
        <DeleteButton onConfirm={() => onCommand?.("delete", { id: entity.id, type: "node" })} />
      </div>
    </div>
  );
}

function OpeningSection({ entity, onChange, onCommand }) {
  const commit = (field) => (value) => onChange?.({ id: entity.id, type: entity.type, field, value });
  return (
    <div className="dg-insp-section">
      <NumberField label="Ширина" value={entity.width} unit="мм" onCommit={commit("width")} />
      <NumberField label="Высота" value={entity.height} unit="мм" onCommit={commit("height")} />
      <NumberField label="Положение" value={entity.position} unit="мм" onCommit={commit("position")} />
      <SelectField
        label="Ориентация"
        value={entity.orientation}
        options={
          entity.orientationOptions || [
            { value: "left", label: "Слева" },
            { value: "right", label: "Справа" },
          ]
        }
        onCommit={commit("orientation")}
      />
      <div className="dg-insp-actions">
        <DeleteButton onConfirm={() => onCommand?.("delete", { id: entity.id, type: entity.type })} />
      </div>
    </div>
  );
}

function DimensionSection({ entity, warnings, onChange, onCommand }) {
  const commit = (field) => (value) => onChange?.({ id: entity.id, type: "dimension", field, value });
  const invalid = entity.invalid || (warnings && warnings.length > 0);
  // Real plan dimensions (see generateWallDimensions.js) carry a `style`
  // object like { importance: "important" }, not a plain string — reduce
  // it to a safe display string here so <option> never receives a raw
  // object as children (that crashed the whole inspector previously).
  const styleLabel =
    typeof entity.style === "string" ? entity.style : entity.style?.importance || "по умолчанию";
  return (
    <div className="dg-insp-section">
      <WarningBanner warnings={warnings} />
      <SelectField
        label="Тип"
        value={entity.dimensionType}
        options={
          entity.dimensionTypeOptions || [
            { value: "linear", label: "Линейный" },
            { value: "diagonal", label: "Диагональный" },
            { value: "angular", label: "Угловой" },
          ]
        }
        onCommit={commit("dimensionType")}
      />
      <TextField label="Подпись" value={entity.label} onCommit={commit("label")} />
      <NumberField label="Отступ" value={entity.offset} unit="мм" onCommit={commit("offset")} />
      <SelectField
        label="Стиль"
        value={styleLabel}
        options={entity.styleOptions || [{ value: styleLabel, label: styleLabel }]}
        onCommit={commit("style")}
      />
      <CheckField label="Видимый" checked={entity.visible !== false} onCommit={commit("visible")} />
      {invalid ? (
        <p className="dg-insp-note">
          Некорректный размер не удаляется автоматически — проверьте геометрию перед удалением.
        </p>
      ) : null}
      <div className="dg-insp-actions">
        <DeleteButton onConfirm={() => onCommand?.("delete", { id: entity.id, type: "dimension" })} />
      </div>
    </div>
  );
}

function ObjectSection({ entity, onChange, onCommand }) {
  const commit = (field) => (value) => onChange?.({ id: entity.id, type: "object", field, value });
  return (
    <div className="dg-insp-section">
      <TextField label="Название" value={entity.name} onCommit={commit("name")} />
      <NumberField label="Позиция X" value={entity.x} unit="мм" onCommit={commit("x")} />
      <NumberField label="Позиция Y" value={entity.y} unit="мм" onCommit={commit("y")} />
      <NumberField label="Поворот" value={entity.rotation} unit="°" onCommit={commit("rotation")} />
      <NumberField label="Ширина" value={entity.width} unit="мм" onCommit={commit("width")} />
      <NumberField label="Глубина" value={entity.depth} unit="мм" onCommit={commit("depth")} />
      {(entity.properties || []).map((prop) => (
        <NumberField
          key={prop.key}
          label={prop.label}
          value={prop.value}
          unit={prop.unit}
          readOnly={prop.readOnly}
          onCommit={(value) => onChange?.({ id: entity.id, type: "object", field: prop.key, value })}
        />
      ))}
      <div className="dg-insp-actions">
        <DeleteButton onConfirm={() => onCommand?.("delete", { id: entity.id, type: "object" })} />
      </div>
    </div>
  );
}

function RoomSection({ entity, onChange, onCommand }) {
  const commit = (field) => (value) => onChange?.({ id: entity.id, type: "room", field, value });
  return (
    <div className="dg-insp-section">
      <TextField label="Имя" value={entity.name} onCommit={commit("name")} />
      <Field label="Площадь" readOnly>
        <span className="dg-insp-readonly-value">{entity.area != null ? `${entity.area} м²` : "—"}</span>
      </Field>
      <SelectField
        label="Тип"
        value={entity.roomType}
        options={entity.roomTypeOptions || [{ value: entity.roomType, label: entity.roomType || "—" }]}
        onCommit={commit("roomType")}
      />
      {(entity.parameters || []).map((p) => (
        <TextField key={p.key} label={p.label} value={p.value} readOnly={p.readOnly} onCommit={(value) => onChange?.({ id: entity.id, type: "room", field: p.key, value })} />
      ))}
      <div className="dg-insp-actions">
        <DeleteButton label="Удалить зону" onConfirm={() => onCommand?.("delete", { id: entity.id, type: "room" })} />
      </div>
    </div>
  );
}

const SECTION_BY_TYPE = {
  wall: WallSection,
  node: NodeSection,
  door: OpeningSection,
  window: OpeningSection,
  dimension: DimensionSection,
  object: ObjectSection,
  room: RoomSection,
};

const TITLE_BY_TYPE = {
  wall: "Стена",
  node: "Узел",
  door: "Дверь",
  window: "Окно",
  dimension: "Размер",
  object: "Объект",
  room: "Помещение / зона",
};

/**
 * PHASE 2D — what a selection change should do to the properties panel.
 *
 * Both panels (the layout, which mounts it, and the inspector, which sizes it)
 * consume this one decision, so "selecting a wall must not open its editor"
 * is stated once and can be tested without a DOM.
 *
 * @returns {"reveal"|"collapse"|"none"}
 */
export function inspectorSelectionTransition({ had, has, autoOpenOnSelect = true }) {
  if (!had === !has) return "none";
  if (!has) return "collapse";
  return autoOpenOnSelect ? "reveal" : "none";
}

export function PlannerInspector({
  selection = null,
  entity = null,
  warnings = [],
  context = {},
  presentationMode = "auto",
  sheetState,
  autoOpenOnSelect = true,
  openRequestId = 0,
  closeRequestId = 0,
  onChange,
  onCommand,
  onClearSelection,
  onFitPlan,
  onSheetStateChange,
}) {
  const safeMode = PRESENTATION_MODES.has(presentationMode) ? presentationMode : "auto";
  const isPhaseControlled = isValidPhase(sheetState);

  // Default open behaviour: peek until something is selected, then half;
  // clearing the selection returns to peek. "expanded" is only ever reached
  // through an explicit user action (never automatically).
  const [phase, setPhase] = useState(() => (selection ? "half" : "peek"));
  const effectivePhase = isPhaseControlled ? sheetState : phase;
  const hadSelectionRef = useRef(!!selection);
  const dragRef = useRef(null);

  function commitPhase(next) {
    if (!isValidPhase(next)) return;
    if (!isPhaseControlled) setPhase(next);
    onSheetStateChange?.(next);
  }

  // PHASE 2D: losing the selection still collapses back to peek, but GAINING
  // one only expands when the caller allows it. For walls it does not: a
  // single click selects, and expanding the editor is a separate intent
  // expressed through openRequestId below.
  useEffect(() => {
    const move = inspectorSelectionTransition({
      had: hadSelectionRef.current,
      has: !!selection,
      autoOpenOnSelect,
    });
    hadSelectionRef.current = !!selection;
    if (move === "collapse") commitPhase("peek");
    else if (move === "reveal") commitPhase("half");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  // Explicit open/close intents (double click / Escape), counted so that
  // repeating the same intent is always observed.
  const prevOpenReqRef = useRef(openRequestId);
  const prevCloseReqRef = useRef(closeRequestId);
  useEffect(() => {
    if (openRequestId === prevOpenReqRef.current) return;
    prevOpenReqRef.current = openRequestId;
    commitPhase("half");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequestId]);
  useEffect(() => {
    if (closeRequestId === prevCloseReqRef.current) return;
    prevCloseReqRef.current = closeRequestId;
    commitPhase("peek");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeRequestId]);

  const isCompact = effectivePhase === "peek" || effectivePhase === "closed";

  function toggleCompact() {
    commitPhase(isCompact ? "half" : "peek");
  }

  function expandFull() {
    commitPhase("expanded");
  }

  function collapseFromExpanded() {
    commitPhase("half");
  }

  // Simple pointer-drag on the handle — no gesture-physics library: crossing
  // a small threshold steps the phase up or down by one level. A tap (no
  // meaningful movement) falls back to the same toggle as the header button.
  function handlePointerDown(e) {
    dragRef.current = { startY: e.clientY, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function handlePointerMove(e) {
    const drag = dragRef.current;
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dy) < 32) return;
    drag.moved = true;
    const idx = SHEET_PHASES.indexOf(effectivePhase);
    if (dy < 0 && idx < SHEET_PHASES.length - 1) commitPhase(SHEET_PHASES[idx + 1]);
    else if (dy > 0 && idx > 0) commitPhase(SHEET_PHASES[idx - 1]);
    drag.startY = e.clientY;
  }

  function handlePointerUp() {
    if (dragRef.current && !dragRef.current.moved) toggleCompact();
    dragRef.current = null;
  }

  const type = selection?.type;

  let body;
  if (!selection || !type) {
    body = <EmptyState context={context} onFitPlan={onFitPlan} />;
  } else if (!KNOWN_TYPES.has(type) || !entity) {
    body = (
      <div className="dg-insp-section">
        <p className="dg-insp-note">
          Не удалось прочитать выбранный элемент. Данные могут быть повреждены или относиться к неизвестному типу.
        </p>
        <button type="button" className="dg-insp-btn" onClick={() => onClearSelection?.()}>
          Снять выделение
        </button>
      </div>
    );
  } else {
    const Section = SECTION_BY_TYPE[type];
    body = <Section entity={entity} warnings={warnings} onChange={onChange} onCommand={onCommand} />;
  }

  const title = selection && KNOWN_TYPES.has(type) && entity ? TITLE_BY_TYPE[type] : "Свойства";
  const modeClass =
    safeMode === "docked" ? " dg-inspector--docked" : safeMode === "sheet" ? " dg-inspector--sheet" : "";

  return (
    <aside
      className={"dg-inspector dg-inspector--" + effectivePhase + modeClass}
      aria-label="Панель свойств"
      data-sheet-state={effectivePhase}
      data-presentation-mode={safeMode}
    >
      <div
        className="dg-inspector__handle"
        role="slider"
        aria-label="Изменить высоту панели свойств"
        aria-valuemin={0}
        aria-valuemax={SHEET_PHASES.length - 1}
        aria-valuenow={SHEET_PHASES.indexOf(effectivePhase)}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") expandFull();
          else if (e.key === "ArrowDown") toggleCompact();
        }}
      />
      <header className="dg-inspector__header">
        <h2 className="dg-inspector__title">{title}</h2>
        <div className="dg-inspector__header-actions">
          <div className="dg-inspector__sheet-controls">
            {effectivePhase === "half" ? (
              <button
                type="button"
                className="dg-inspector__expand-full"
                onClick={expandFull}
                aria-label="Развернуть панель полностью"
              >
                ⤒
              </button>
            ) : null}
            {effectivePhase === "expanded" ? (
              <button
                type="button"
                className="dg-inspector__expand-full"
                onClick={collapseFromExpanded}
                aria-label="Свернуть панель наполовину"
              >
                ⤓
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="dg-inspector__collapse"
            onClick={toggleCompact}
            aria-label={isCompact ? "Развернуть панель" : "Свернуть панель"}
          >
            {isCompact ? "▲" : "▼"}
          </button>
          {selection ? (
            <button
              type="button"
              className="dg-inspector__close"
              onClick={() => onClearSelection?.()}
              aria-label="Закрыть панель свойств"
            >
              ✕
            </button>
          ) : null}
        </div>
      </header>
      <div className="dg-inspector__body">{body}</div>
    </aside>
  );
}

export default PlannerInspector;
