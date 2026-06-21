import React from "react";
import {
  blankBreakerSpec,
  draftBreakerSpecs,
  formatBreakerSpecsLabel,
  isBreakerName,
  normalizeBreakerSpecs,
  breakerSpecsClientNote,
} from "../../shared/breakerSpecs.js";

/** Редактор автоматов: амперы + кол-во шт */
export default function BreakerSpecsEditor({
  name,
  value,
  onChange,
  disabled = false,
  compact = false,
}) {
  if (!isBreakerName(name)) return null;

  const specs = normalizeBreakerSpecs(value);
  const rows = draftBreakerSpecs(value);

  const emit = (next) => {
    const draft = draftBreakerSpecs(next);
    onChange({
      breakerSpecs: draft,
      clientNote: breakerSpecsClientNote(draft),
    });
  };

  const updateRow = (index, patch) => {
    const next = rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    emit(next);
  };

  const addRow = () => emit([...rows, blankBreakerSpec()]);

  const removeRow = (index) => {
    const next = rows.filter((_, i) => i !== index);
    emit(next.length ? next : [blankBreakerSpec()]);
  };

  if (compact) {
    return (
      <div className="breaker-specs-editor breaker-specs-editor--compact" style={{ marginTop: 6 }}>
        <div className="muted" style={{ fontSize: 10, marginBottom: 4 }}>
          Автоматы (А × шт)
        </div>
        {rows.map((row, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "56px 12px 52px 28px",
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
              placeholder="А"
              style={{ width: "100%", fontSize: 11 }}
              disabled={disabled}
              value={row.amps}
              onChange={(e) => updateRow(i, { amps: e.target.value })}
            />
            <span className="muted" style={{ fontSize: 10, textAlign: "center" }}>
              ×
            </span>
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
          ＋ номинал
        </button>
      </div>
    );
  }

  return (
    <div className="breaker-specs-editor card" style={{ padding: 12, marginTop: 10 }}>
      <div className="between wrap" style={{ gap: 8, marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Автоматы по номиналу</strong>
        <button type="button" className="btn btn-sm" disabled={disabled} onClick={addRow}>
          ＋ Добавить
        </button>
      </div>
      <table className="spec" style={{ fontSize: 12 }}>
        <thead>
          <tr>
            <th>Амперы, А</th>
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
                  step={1}
                  className="spec-cell-input num"
                  disabled={disabled}
                  value={row.amps}
                  onChange={(e) => updateRow(i, { amps: e.target.value })}
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
      {formatBreakerSpecsLabel(specs) && (
        <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>
          Итого: {formatBreakerSpecsLabel(specs)}
        </p>
      )}
    </div>
  );
}
