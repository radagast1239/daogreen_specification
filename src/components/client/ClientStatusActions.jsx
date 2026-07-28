import React, { useState } from "react";
import { isBoughtStatus } from "../../lib/itemHelpers.js";
import { t } from "../../../shared/clientI18n.js";

const OTHER_ACTIONS = [
  { id: "have", key: "have" },
  { id: "need_help", key: "needHelp", attention: true },
];

function closedActionLabel(language, status) {
  if (status === "ordered") return t(language, "client.statusAction.ordered.label");
  if (isBoughtStatus(status)) return t(language, "client.statusAction.bought.label");
  return t(language, "client.statusAction.closed.label");
}

function nextClosedStatus(status) {
  if (status === "ordered") return "bought";
  if (isBoughtStatus(status)) return "ordered";
  return "ordered";
}

function closedActionTitle(language, status) {
  if (status === "ordered") return t(language, "client.statusAction.ordered.title");
  if (isBoughtStatus(status)) return t(language, "client.statusAction.bought.title");
  return t(language, "client.statusAction.closed.title");
}

export default function ClientStatusActions({
  status,
  onStatusChange,
  onNeedReplacement,
  disabled = false,
  language = "ru",
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
          title={closedActionTitle(language, current)}
          disabled={disabled || !!pending}
          onClick={runClosed}
        >
          {pending === "ordered" || pending === "bought" ? "…" : closedActionLabel(language, current)}
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
              title={t(language, `client.statusAction.${action.key}.title`)}
              disabled={disabled || !!pending}
              onClick={() => run(action.id)}
            >
              {pending === action.id ? "…" : t(language, `client.statusAction.${action.key}.label`)}
            </button>
          );
        })}
        {onNeedReplacement && (
          <button
            type="button"
            className="btn btn-sm"
            title={t(language, "client.statusAction.replace.title")}
            disabled={disabled || !!pending || current === "replacement_check"}
            onClick={onNeedReplacement}
          >
            {t(language, "client.statusAction.replace.label")}
          </button>
        )}
      </div>
    </div>
  );
}
