import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  normalizeMaterialFarmSections,
  resolveMaterialFarmSections,
} from "../../shared/materialFarmSections.js";

export default function MaterialFarmSectionsEditor({ value, onChange, farmSections = [] }) {
  const selected = resolveMaterialFarmSections(value);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const labelById = useMemo(
    () => Object.fromEntries(farmSections.map((s) => [s.id, s.name])),
    [farmSections]
  );

  const summary = useMemo(() => {
    if (!selected.length) return "— не в шаблонах разделов —";
    if (selected.length === 1) return labelById[selected[0]] || selected[0];
    return `${selected.length} раздела`;
  }, [selected, labelById]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = (sectionId, checked) => {
    const next = checked
      ? normalizeMaterialFarmSections([...selected, sectionId])
      : selected.filter((x) => x !== sectionId);
    onChange(next);
  };

  return (
    <div className="field material-modules-editor" ref={rootRef}>
      <label>Разделы фермы</label>
      <p className="muted material-modules-editor__hint">
        Позиция автоматически попадёт в шаблоны выбранных разделов при сборке проекта. Список разделов — в{" "}
        <a href="/modules">Модули и шаблоны</a>.
      </p>

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
            {!farmSections.length && (
              <div className="material-modules-dropdown__empty">Нет разделов — настройте в «Модули и шаблоны»</div>
            )}
            {farmSections.map((sec) => (
              <label key={sec.id} className="material-modules-dropdown__option">
                <input
                  type="checkbox"
                  checked={selected.includes(sec.id)}
                  onChange={(e) => toggle(sec.id, e.target.checked)}
                />
                <span className="material-modules-dropdown__label">{sec.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="material-modules-editor__chips">
          {selected.map((sectionId) => (
            <span key={sectionId} className="chip chip--neutral">
              {labelById[sectionId] || sectionId}
              <button
                type="button"
                className="material-modules-editor__chip-x"
                aria-label={`Убрать ${labelById[sectionId] || sectionId}`}
                onClick={() => toggle(sectionId, false)}
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
