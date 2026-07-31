import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

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

const MENU_VIEWPORT_PAD = 8;

/** Keep absolutely positioned menu fully inside the viewport (default CSS: right:0). */
export function placeRowActionsMenu(menuEl, { pad = MENU_VIEWPORT_PAD, viewportWidth } = {}) {
  if (!menuEl || typeof menuEl.getBoundingClientRect !== "function") return null;
  const vw =
    typeof viewportWidth === "number"
      ? viewportWidth
      : typeof window !== "undefined"
        ? window.innerWidth
        : 0;
  if (!vw) return null;

  menuEl.style.left = "";
  menuEl.style.right = "0px";
  menuEl.style.transform = "";
  menuEl.style.maxWidth = `${Math.max(0, vw - pad * 2)}px`;

  let rect = menuEl.getBoundingClientRect();
  let shiftX = 0;
  if (rect.left < pad) shiftX += pad - rect.left;
  if (rect.right + shiftX > vw - pad) shiftX -= rect.right + shiftX - (vw - pad);

  if (shiftX !== 0) {
    menuEl.style.transform = `translateX(${shiftX}px)`;
    rect = menuEl.getBoundingClientRect();
  }

  return { left: rect.left, right: rect.right, width: rect.width, viewportWidth: vw, shiftX };
}

/**
 * Compact ⋯ menu.
 * Items: { id, label, onClick, disabled?, danger?, separator?, children? }
 * children: nested actions (e.g. copy variants) under a parent label.
 */
export function RowActionsMenu({ items, label = "Действия" }) {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const root = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setExpandedId(null);
      return undefined;
    }
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

  useLayoutEffect(() => {
    if (!open) return undefined;
    const menu = menuRef.current;
    if (!menu) return undefined;

    const place = () => placeRowActionsMenu(menu);
    place();
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      menu.style.left = "";
      menu.style.right = "";
      menu.style.transform = "";
      menu.style.maxWidth = "";
    };
  }, [open, expandedId]);

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
        <div className="row-actions__menu" role="menu" ref={menuRef}>
          {visible.map((item, index) => {
            if (item.separator) {
              return (
                <div
                  key={item.id || `sep-${index}`}
                  className="row-actions__sep"
                  role="separator"
                />
              );
            }
            const nested = (item.children || []).filter(Boolean);
            if (nested.length) {
              const expanded = expandedId === item.id;
              return (
                <div key={item.id} className="row-actions__group">
                  <button
                    type="button"
                    role="menuitem"
                    className="row-actions__item row-actions__item--parent"
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : item.id)}
                  >
                    <span>{item.label}</span>
                    <span className="row-actions__chevron" aria-hidden>
                      {expanded ? "▾" : "▸"}
                    </span>
                  </button>
                  {expanded &&
                    nested.map((child) => (
                      <button
                        key={child.id}
                        type="button"
                        role="menuitem"
                        disabled={child.disabled}
                        className={
                          "row-actions__item row-actions__item--nested" +
                          (child.danger ? " row-actions__item--danger" : "")
                        }
                        onClick={() => {
                          setOpen(false);
                          child.onClick?.();
                        }}
                      >
                        {child.label}
                      </button>
                    ))}
                </div>
              );
            }
            return (
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
            );
          })}
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
