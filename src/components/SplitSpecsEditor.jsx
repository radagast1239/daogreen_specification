import React from "react";
import {
  blankSplitSpec,
  draftSplitSpecs,
  formatSplitSpecsLabel,
  isSplitSystemName,
  normalizeSplitSpecs,
  splitSpecsClientNote,
  aggregateSplitCoolingKw,
} from "../../shared/splitSpecs.js";

/** Сплит-системы: шт × кВт */
export default function SplitSpecsEditor({
  name,
  value,
  onChange,
  disabled = false,
  compact = false,
}) {
  if (!isSplitSystemName(name)) return null;

  const specs = normalizeSplitSpecs(value);
  const rows = draftSplitSpecs(value);

  const emit = (next) => {
    const draft = draftSplitSpecs(next);
    onChange({
      splitSpecs: draft,
      clientNote: splitSpecsClientNote(draft),
      coolingKw: aggregateSplitCoolingKw(draft),
    });
  };

  const updateRow = (index, patch) => {
    emit(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const addRow = () => emit([...rows, blankSplitSpec()]);
  const removeRow = (index) => {
    const next = rows.filter((_, i) => i !== index);
    emit(next.length ? next : [blankSplitSpec()]);
  };

  if (compact) {
    return (
      <div className="split-specs-editor split-specs-editor--compact" style={{ marginTop: 6 }}>
        <div className="muted" style={{ fontSize: 10, marginBottom: 4 }}>
          Сплит (шт × кВт)
        </div>
        {rows.map((row, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "44px 12px 56px 28px",
              alignItems: "center",
              gap: 4,
              marginBottom: 4,
            }}
          >
            <input
              type="number"
              min={0}
              step={1}
              className="spec-cell-input num"
              placeholder="шт"
              style={{ width: "100%", fontSize: 11 }}
              disabled={disabled}
              value={row.qty}
              onChange={(e) => updateRow(i, { qty: e.target.value })}
            />
            <span className="muted" style={{ fontSize: 10, textAlign: "center" }}>
              ×
            </span>
            <input
              type="number"
              min={0}
              step="any"
              className="spec-cell-input num"
              placeholder="кВт"
              style={{ width: "100%", fontSize: 11 }}
              disabled={disabled}
              value={row.coolingKw}
              onChange={(e) => updateRow(i, { coolingKw: e.target.value })}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ padding: "2px 4px", fontSize: 11 }}
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
          ＋ сплит
        </button>
      </div>
    );
  }

  return (
    <div className="split-specs-editor card" style={{ padding: 12, marginTop: 10 }}>
      <div className="between wrap" style={{ gap: 8, marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Сплит-системы: шт × кВт</strong>
        <button type="button" className="btn btn-sm" disabled={disabled} onClick={addRow}>
          ＋ Добавить
        </button>
      </div>
      <table className="spec" style={{ fontSize: 12 }}>
        <thead>
          <tr>
            <th>Кол-во, шт</th>
            <th>Мощность, кВт</th>
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
                  step={1}
                  className="spec-cell-input num"
                  disabled={disabled}
                  value={row.qty}
                  onChange={(e) => updateRow(i, { qty: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  step="any"
                  className="spec-cell-input num"
                  disabled={disabled}
                  value={row.coolingKw}
                  onChange={(e) => updateRow(i, { coolingKw: e.target.value })}
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
      {formatSplitSpecsLabel(specs) && (
        <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>
          Итого: {formatSplitSpecsLabel(specs)}
        </p>
      )}
    </div>
  );
}
