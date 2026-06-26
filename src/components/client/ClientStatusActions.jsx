import React, { useState } from "react";

const QUICK_ACTIONS = [
  {
    id: "ordered",
    label: "Заказано",
    title: "Оформлен заказ, ждём доставку — смотрите во вкладке «Заказано»",
  },
  {
    id: "bought",
    label: "Куплено",
    title: "Товар получен — уйдёт из списка закупки",
  },
  { id: "have", label: "Уже есть", title: "Уже на объекте — уйдёт из списка закупки" },
  { id: "need_help", label: "Нужна помощь", attention: true, title: "Нужна помощь Daogreen" },
];

export default function ClientStatusActions({
  status,
  onStatusChange,
  onNeedReplacement,
  disabled = false,
}) {
  const current = status || "not_bought";
  const [pending, setPending] = useState(null);

  const run = async (next) => {
    if (disabled || pending) return;
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
        {QUICK_ACTIONS.map((action) => {
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
