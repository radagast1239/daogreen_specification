import React from "react";
import { normalizeMaterialModules } from "../../shared/materialModules.js";

/** Чекбоксы: несколько модулей / разделов */
export default function MaterialModulesEditor({
  value,
  onChange,
  activeModules = [],
  archivedModules = [],
}) {
  const selected = normalizeMaterialModules(value);

  const toggle = (modName, checked) => {
    const next = checked
      ? normalizeMaterialModules([...selected, modName])
      : selected.filter((x) => x !== modName);
    onChange(next);
  };

  return (
    <div className="field material-modules-editor">
      <label>Модули / разделы</label>
      <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
        Позиция появится в каталоге каждого отмеченного модуля при сборке проекта.
      </p>
      {archivedModules.length > 0 && (
        <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
          В архиве (снимите галочку):{" "}
          <strong>{archivedModules.join(", ")}</strong>
        </p>
      )}
      <div
        className="card"
        style={{
          padding: "10px 12px",
          maxHeight: 220,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {activeModules.map((modName) => (
          <label key={modName} className="row" style={{ gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={selected.includes(modName)}
              onChange={(e) => toggle(modName, e.target.checked)}
            />
            <span>{modName}</span>
          </label>
        ))}
        {!activeModules.length && (
          <span className="muted" style={{ fontSize: 12 }}>Нет активных модулей</span>
        )}
      </div>
      {selected.length > 0 && (
        <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>
          Выбрано: {selected.filter((m) => activeModules.includes(m)).join(", ") || "—"}
        </p>
      )}
    </div>
  );
}
