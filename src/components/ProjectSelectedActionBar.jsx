import React from "react";
import { SELECTED_ACTION_BAR_ACTIONS, shouldShowSelectedActionBar } from "../../shared/projectWorkspaceUi.js";

export default function ProjectSelectedActionBar({
  selectedCount = 0,
  onShowClient,
  onHideClient,
  onRefreshPrices,
  onClearSelection,
}) {
  if (!shouldShowSelectedActionBar(selectedCount)) return null;

  const handlers = {
    show_client: onShowClient,
    hide_client: onHideClient,
    refresh_prices: onRefreshPrices,
    clear_selection: onClearSelection,
  };

  return (
    <div className="spec-selected-bar row wrap no-print" style={{ gap: 8 }} role="status">
      <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
        Выбрано: <strong className="num">{selectedCount}</strong>
      </span>
      {SELECTED_ACTION_BAR_ACTIONS.map((action) => (
        <button
          key={action.key}
          type="button"
          className={`btn btn-sm${action.key === "show_client" ? " btn-primary" : action.key === "clear_selection" ? " btn-ghost" : ""}`}
          onClick={handlers[action.key]}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
