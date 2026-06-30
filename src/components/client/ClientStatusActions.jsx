import React, { useState } from "react";
import { isBoughtStatus } from "../../lib/itemHelpers.js";

const OTHER_ACTIONS = [
  { id: "have", label: "Уже есть", title: "Уже на объекте — уйдёт из списка закупки" },
  { id: "need_help", label: "Нужна помощь", attention: true, title: "Нужна помощь Daogreen" },
];

function closedActionLabel(status) {
  if (status === "ordered") return "Заказано";
  if (isBoughtStatus(status)) return "Куплено";
  return "Заказано/Куплено";
}

function nextClosedStatus(status) {
  if (status === "ordered") return "bought";
  if (isBoughtStatus(status)) return "ordered";
  return "ordered";
}

function closedActionTitle(status) {
  if (status === "ordered") return "Товар получен — нажмите, чтобы отметить «Куплено»";
  if (isBoughtStatus(status)) return "Нажмите, чтобы вернуть статус «Заказано»";
  return "Оформлен заказ — позиция уйдёт в «Заказано/Куплено»";
}

export default function ClientStatusActions({
  status,
  onStatusChange,
  onNeedReplacement,
  disabled = false,
}) {
  const current = status || "not_bought";
  const [pending, setPending] = useState(null);
  const closedActive = current === "ordered" || isBoughtStatus(current);

  const run = async (next) => {
    if (disabled || pending) return;
    setPending(next);
    try {
      await onStatusChange(next);
    } finally {
      setPending(null);
    }
  };

  const runClosed = async () => {
    if (disabled || pending) return;
    const next = nextClosedStatus(current);
    setPending(next);
    try {
      await onStatusChange(next);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="client-status-actions no-print">
      <div className="client-status-actions__quick">
        <button
          type="button"
          className={
            "btn btn-sm" +
            (closedActive ? " btn-active" : "") +
            (pending === "ordered" || pending === "bought" ? " btn--pending" : "")
          }
          title={closedActionTitle(current)}
          disabled={disabled || !!pending}
          onClick={runClosed}
        >
          {pending === "ordered" || pending === "bought" ? "…" : closedActionLabel(current)}
        </button>
        {OTHER_ACTIONS.map((action) => {
          const active = current === action.id;
          let className = "btn btn-sm";
          if (action.attention && active) className += " btn-attention";
          else if (active) className += " btn-active";
          if (pending === action.id) className += " btn--pending";
          return (
            <button
              key={action.id}
              type="button"
              className={className}
              title={action.title}
              disabled={disabled || !!pending}
              onClick={() => run(action.id)}
            >
              {pending === action.id ? "…" : action.label}
            </button>
          );
        })}
        {onNeedReplacement && (
          <button
            type="button"
            className="btn btn-sm"
            title="Предложить другой товар на замену"
            disabled={disabled || !!pending || current === "replacement_check"}
            onClick={onNeedReplacement}
          >
            Нужна замена
          </button>
        )}
      </div>
    </div>
  );
}
