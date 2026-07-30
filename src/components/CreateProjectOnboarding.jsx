import React from "react";

/**
 * Compact post-create next-step banner. Dismissed manually or when work starts.
 */
export default function CreateProjectOnboarding({ visible, onDismiss }) {
  if (!visible) return null;
  return (
    <div
      className="card"
      style={{
        padding: 14,
        marginBottom: 14,
        borderColor: "var(--brand)",
        background: "var(--brand-tint)",
      }}
    >
      <div className="between" style={{ gap: 12, alignItems: "flex-start" }}>
        <div>
          <strong>Проект создан.</strong>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Следующий шаг:
            <br />— добавить стеллажи
            <br />— добавить общую закупку
            <br />— заполнить спецификацию
          </div>
        </div>
        <button type="button" className="btn btn-sm" onClick={onDismiss}>
          Закрыть
        </button>
      </div>
    </div>
  );
}
