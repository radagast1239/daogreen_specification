import React, { useEffect, useMemo, useRef, useState } from "react";
import { normalizeMaterialModules } from "../../shared/materialModules.js";

/** Выпадающий список с галочками — несколько модулей / разделов */
export default function MaterialModulesEditor({
  value,
  onChange,
  activeModules = [],
  archivedModules = [],
}) {
  const selected = normalizeMaterialModules(value);
  const activeSelected = selected.filter((m) => activeModules.includes(m));
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const summary = useMemo(() => {
    if (!activeSelected.length) return "— выберите модули —";
    if (activeSelected.length === 1) return activeSelected[0];
    return `${activeSelected.length} модуля выбрано`;
  }, [activeSelected]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = (modName, checked) => {
    const next = checked
      ? normalizeMaterialModules([...selected, modName])
      : selected.filter((x) => x !== modName);
    onChange(next);
  };

  return (
    <div className="field material-modules-editor" ref={rootRef}>
      <label>Модули / разделы</label>
      <p className="muted material-modules-editor__hint">
        Позиция появится в каталоге каждого отмеченного модуля при сборке проекта.
      </p>
      {archivedModules.length > 0 && (
        <p className="muted material-modules-editor__hint">
          В архиве (выберите заново): <strong>{archivedModules.join(", ")}</strong>
        </p>
      )}

      <div className={`material-modules-dropdown${open ? " material-modules-dropdown--open" : ""}`}>
        <button
          type="button"
          className="material-modules-dropdown__trigger"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="material-modules-dropdown__summary">{summary}</span>
          <span className="material-modules-dropdown__chev" aria-hidden>
            ▾
          </span>
        </button>

        {open && (
          <div className="material-modules-dropdown__panel" role="listbox" aria-multiselectable="true">
            {!activeModules.length && (
              <div className="material-modules-dropdown__empty">Нет активных модулей</div>
            )}
            {activeModules.map((modName) => (
              <label key={modName} className="material-modules-dropdown__option">
                <input
                  type="checkbox"
                  checked={selected.includes(modName)}
                  onChange={(e) => toggle(modName, e.target.checked)}
                />
                <span className="material-modules-dropdown__label">{modName}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {activeSelected.length > 0 && (
        <div className="material-modules-editor__chips">
          {activeSelected.map((modName) => (
            <span key={modName} className="chip chip--neutral">
              {modName}
              <button
                type="button"
                className="material-modules-editor__chip-x"
                aria-label={`Убрать ${modName}`}
                onClick={() => toggle(modName, false)}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
