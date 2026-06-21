import React from "react";
import {
  blankFlowSpec,
  draftFlowSpecs,
  formatFlowSpecsLabel,
  isFlowSpecName,
  isPumpName,
  normalizeFlowSpecs,
  flowSpecsClientNote,
  aggregateFlowM3,
  primaryFlowLink,
} from "../../shared/flowSpecs.js";

/** Вытяжка / насос: шт × м³/ч + ссылка */
export default function FlowSpecsEditor({
  name,
  value,
  onChange,
  disabled = false,
  compact = false,
}) {
  if (!isFlowSpecName(name)) return null;

  const specs = normalizeFlowSpecs(value);
  const rows = draftFlowSpecs(value);
  const pump = isPumpName(name);
  const title = pump ? "Насосы" : "Вытяжка";

  const emit = (next) => {
    const draft = draftFlowSpecs(next);
    onChange({
      flowSpecs: draft,
      clientNote: flowSpecsClientNote(draft, name),
      exhaustM3: aggregateFlowM3(draft),
      link: primaryFlowLink(draft),
    });
  };

  const updateRow = (index, patch) => {
    emit(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const addRow = () => emit([...rows, blankFlowSpec()]);
  const removeRow = (index) => {
    const next = rows.filter((_, i) => i !== index);
    emit(next.length ? next : [blankFlowSpec()]);
  };

  if (compact) {
    return (
      <div className="flow-specs-editor flow-specs-editor--compact" style={{ marginTop: 6 }}>
        <div className="muted" style={{ fontSize: 10, marginBottom: 4 }}>
          {title} (шт × м³/ч)
        </div>
        {rows.map((row, i) => (
          <div key={i} style={{ marginBottom: 6 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "44px 12px 56px 28px",
                alignItems: "center",
                gap: 4,
                marginBottom: 3,
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
                placeholder="м³/ч"
                style={{ width: "100%", fontSize: 11 }}
                disabled={disabled}
                value={row.m3h}
                onChange={(e) => updateRow(i, { m3h: e.target.value })}
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
            <input
              type="url"
              className="spec-cell-input"
              placeholder="ссылка"
              style={{ width: "100%", fontSize: 11 }}
              disabled={disabled}
              value={row.link}
              onChange={(e) => updateRow(i, { link: e.target.value })}
            />
          </div>
        ))}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ padding: "2px 8px", fontSize: 10 }}
          disabled={disabled}
          onClick={addRow}
        >
          ＋ позиция
        </button>
      </div>
    );
  }

  return (
    <div className="flow-specs-editor card" style={{ padding: 12, marginTop: 10 }}>
      <div className="between wrap" style={{ gap: 8, marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>{title}: шт × м³/ч</strong>
        <button type="button" className="btn btn-sm" disabled={disabled} onClick={addRow}>
          ＋ Добавить
        </button>
      </div>
      <table className="spec" style={{ fontSize: 12 }}>
        <thead>
          <tr>
            <th>Кол-во, шт</th>
            <th>м³/ч</th>
            <th>Ссылка</th>
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
                  value={row.m3h}
                  onChange={(e) => updateRow(i, { m3h: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="url"
                  className="spec-cell-input"
                  disabled={disabled}
                  value={row.link}
                  onChange={(e) => updateRow(i, { link: e.target.value })}
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
      {formatFlowSpecsLabel(specs, name) && (
        <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>
          Итого: {formatFlowSpecsLabel(specs, name)}
        </p>
      )}
    </div>
  );
}
