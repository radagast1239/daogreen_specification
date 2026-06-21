import React from "react";
import {
  blankPipeCut,
  draftPipeCuts,
  formatPipeCutsLabel,
  isProfilePipeName,
  normalizePipeCuts,
  pipeCutsClientNote,
} from "../../shared/profilePipeCuts.js";

/** Редактор отрезков профтрубы: длина мм + кол-во шт */
export default function ProfilePipeCutsEditor({
  name,
  value,
  onChange,
  disabled = false,
  compact = false,
}) {
  if (!isProfilePipeName(name)) return null;

  const cuts = normalizePipeCuts(value);
  const rows = draftPipeCuts(value);

  const emit = (next) => {
    const draft = draftPipeCuts(next);
    onChange({
      pipeCuts: draft,
      clientNote: pipeCutsClientNote(draft),
    });
  };

  const updateRow = (index, patch) => {
    const next = rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    emit(next);
  };

  const addRow = () => emit([...rows, blankPipeCut()]);

  const removeRow = (index) => {
    const next = rows.filter((_, i) => i !== index);
    emit(next.length ? next : [blankPipeCut()]);
  };

  if (compact) {
    return (
      <div className="pipe-cuts-editor pipe-cuts-editor--compact" style={{ marginTop: 6 }}>
        <div className="muted" style={{ fontSize: 10, marginBottom: 4 }}>
          Отрезки (мм × шт)
        </div>
        {rows.map((row, i) => (
          <div key={i} className="row" style={{ gap: 4, marginBottom: 4, flexWrap: "nowrap" }}>
            <input
              type="number"
              min={0}
              className="spec-cell-input num"
              placeholder="мм"
              style={{ width: 72, fontSize: 11 }}
              disabled={disabled}
              value={row.lengthMm}
              onChange={(e) => updateRow(i, { lengthMm: e.target.value })}
            />
            <span className="muted" style={{ fontSize: 10 }}>×</span>
            <input
              type="number"
              min={0}
              step={1}
              className="spec-cell-input num"
              placeholder="шт"
              style={{ width: 52, fontSize: 11 }}
              disabled={disabled}
              value={row.qty}
              onChange={(e) => updateRow(i, { qty: e.target.value })}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ padding: "2px 6px", fontSize: 11 }}
              disabled={disabled || rows.length <= 1}
              onClick={() => removeRow(i)}
              title="Удалить строку"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ padding: "2px 8px", fontSize: 10 }}
          disabled={disabled}
          onClick={addRow}
        >
          ＋ отрезок
        </button>
      </div>
    );
  }

  return (
    <div className="pipe-cuts-editor card" style={{ padding: 12, marginTop: 10 }}>
      <div className="between wrap" style={{ gap: 8, marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Отрезки профтрубы</strong>
        <button type="button" className="btn btn-sm" disabled={disabled} onClick={addRow}>
          ＋ Добавить
        </button>
      </div>
      <table className="spec" style={{ fontSize: 12 }}>
        <thead>
          <tr>
            <th>Длина, мм</th>
            <th>Кол-во, шт</th>
            <th style={{ width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>
                <input
                  type="number"
                  min={0}
                  className="spec-cell-input num"
                  disabled={disabled}
                  value={row.lengthMm}
                  onChange={(e) => updateRow(i, { lengthMm: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  step={1}
                  className="spec-cell-input num"
                  disabled={disabled}
                  value={row.qty}
                  onChange={(e) => updateRow(i, { qty: e.target.value })}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={disabled || rows.length <= 1}
                  onClick={() => removeRow(i)}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {formatPipeCutsLabel(cuts) && (
        <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>
          Итого: {formatPipeCutsLabel(cuts)}
        </p>
      )}
    </div>
  );
}
