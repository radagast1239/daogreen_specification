import React from "react";

export default function ClientPurchaseViewToggles({ layout, compact, onLayoutChange, onCompactChange }) {
  return (
    <div className="client-view-toggles no-print">
      <div className="client-view-toggles__group" role="group" aria-label="Вид списка">
        <button
          type="button"
          className={`btn btn-sm${layout === "cards" ? " btn-primary" : ""}`}
          onClick={() => onLayoutChange("cards")}
        >
          Карточки
        </button>
        <button
          type="button"
          className={`btn btn-sm${layout === "table" ? " btn-primary" : ""}`}
          onClick={() => onLayoutChange("table")}
        >
          Таблица
        </button>
      </div>
      <div className="client-view-toggles__group" role="group" aria-label="Плотность">
        <button
          type="button"
          className={`btn btn-sm${!compact ? " btn-primary" : ""}`}
          onClick={() => onCompactChange(false)}
        >
          Обычный
        </button>
        <button
          type="button"
          className={`btn btn-sm${compact ? " btn-primary" : ""}`}
          onClick={() => onCompactChange(true)}
        >
          Компактный (без фото)
        </button>
      </div>
    </div>
  );
}
