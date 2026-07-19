import React, { useEffect, useRef, useState } from "react";

export function ModulesSearch({ value, onChange, placeholder = "Поиск…" }) {
  return (
    <label className="modules-search">
      <span className="sr-only">Поиск</span>
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function TechDetails({ children, summary = "Техническая информация" }) {
  return (
    <details className="modules-tech">
      <summary>{summary}</summary>
      <div className="modules-tech__body">{children}</div>
    </details>
  );
}

/**
 * Compact ⋯ menu. Items: { id, label, onClick, disabled?, danger? }
 */
export function RowActionsMenu({ items, label = "Действия" }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (!root.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const visible = (items || []).filter(Boolean);
  if (!visible.length) return null;

  return (
    <div className="row-actions" ref={root}>
      <button
        type="button"
        className="btn btn-ghost btn-sm row-actions__toggle"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <div className="row-actions__menu" role="menu">
          {visible.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={
                "row-actions__item" + (item.danger ? " row-actions__item--danger" : "")
              }
              onClick={() => {
                setOpen(false);
                item.onClick?.();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function StickySaveBar({
  dirty,
  saving,
  saved,
  onSave,
  onCancel,
  saveLabel = "Сохранить",
}) {
  if (!dirty && !saved) return null;
  return (
    <div className={"modules-sticky-save" + (dirty ? " modules-sticky-save--dirty" : "")}>
      <span className="modules-sticky-save__status">
        {saved && !dirty
          ? "Сохранено"
          : dirty
            ? "Есть несохранённые изменения"
            : null}
      </span>
      <div className="modules-sticky-save__actions">
        {dirty && (
          <>
            <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={onCancel}>
              Отменить
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={onSave}>
              {saving ? "Сохранение…" : saveLabel}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
