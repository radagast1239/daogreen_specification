import React from "react";
import { PURCHASE_STATUSES } from "../../data/modules.js";

/** Порядок статусов в выпадающем списке для клиента */
export const CLIENT_STATUS_DROPDOWN_IDS = [
  "not_bought",
  "searching",
  "ordered",
  "bought",
  "delivered",
  "have",
  "need_help",
  "replacement_check",
  "not_fit",
];

const QUICK_ACTIONS = [
  { id: "ordered", label: "Заказал" },
  { id: "bought", label: "Купил", primary: true },
  { id: "need_help", label: "Нужна помощь", attention: true },
];

function statusLabel(statuses, id) {
  return statuses.find((s) => s.id === id)?.label || id;
}

export default function ClientStatusActions({
  status,
  onStatusChange,
  purchaseStatuses = PURCHASE_STATUSES,
}) {
  const current = status || "not_bought";
  const dropdownIds = CLIENT_STATUS_DROPDOWN_IDS.filter((id) =>
    purchaseStatuses.some((s) => s.id === id && s.clientVisible !== false)
  );

  return (
    <div className="client-status-actions no-print">
      <div className="client-status-actions__quick">
        {QUICK_ACTIONS.map((action) => {
          const active = current === action.id;
          let className = "btn btn-sm";
          if (action.primary) className += active ? " btn-primary" : "";
          else if (action.attention && active) className += " btn-attention";
          else if (active) className += " btn-active";
          return (
            <button
              key={action.id}
              type="button"
              className={className}
              onClick={() => onStatusChange(action.id)}
            >
              {action.label}
            </button>
          );
        })}
      </div>
      <label className="client-status-actions__more">
        <span className="muted">Другой статус</span>
        <select value={current} onChange={(e) => onStatusChange(e.target.value)}>
          {dropdownIds.map((id) => (
            <option key={id} value={id}>
              {statusLabel(purchaseStatuses, id)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
