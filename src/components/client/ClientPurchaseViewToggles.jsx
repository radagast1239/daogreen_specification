import React from "react";
import { t } from "../../../shared/clientI18n.js";

export default function ClientPurchaseViewToggles({ layout, compact, onLayoutChange, onCompactChange, language = "ru" }) {
  return (
    <div className="client-view-toggles no-print">
      <div className="client-view-toggles__group" role="group" aria-label={t(language, "client.viewToggle.layoutAria")}>
        <button
          type="button"
          className={`btn btn-sm${layout === "cards" ? " btn-primary" : ""}`}
          onClick={() => onLayoutChange("cards")}
        >
          {t(language, "client.viewToggle.cards")}
        </button>
        <button
          type="button"
          className={`btn btn-sm${layout === "table" ? " btn-primary" : ""}`}
          onClick={() => onLayoutChange("table")}
        >
          {t(language, "client.viewToggle.table")}
        </button>
      </div>
      <div className="client-view-toggles__group" role="group" aria-label={t(language, "client.viewToggle.densityAria")}>
        <button
          type="button"
          className={`btn btn-sm${!compact ? " btn-primary" : ""}`}
          onClick={() => onCompactChange(false)}
        >
          {t(language, "client.viewToggle.normal")}
        </button>
        <button
          type="button"
          className={`btn btn-sm${compact ? " btn-primary" : ""}`}
          onClick={() => onCompactChange(true)}
        >
          {t(language, "client.viewToggle.compact")}
        </button>
      </div>
    </div>
  );
}
