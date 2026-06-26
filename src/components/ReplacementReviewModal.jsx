import React from "react";
import { api } from "../lib/api.js";
import { num, money } from "../store/helpers.js";
import { purchasePriorityLabel } from "../../shared/purchasePriority.js";
import { PURCHASE_PRIORITIES } from "../../shared/purchasePriority.js";
import { enrichRoom, actualCoolingFromItem } from "../../shared/roomCoolingCalc.js";
import { roomLabel } from "../lib/roomHelpers.js";

export default function ReplacementReviewModal({ projectId, item, currency, onClose, onDone }) {
  const [link, setLink] = React.useState(item?.replacementLink || item?.link || "");
  const [supplier, setSupplier] = React.useState(item?.supplier || "");
  const [price, setPrice] = React.useState(
    item?.replacementPrice != null ? item.replacementPrice : item?.price ?? ""
  );
  const [adminNote, setAdminNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  if (!item) return null;

  const review = async (action) => {
    setBusy(true);
    try {
      await api.reviewReplacement(projectId, item.id, {
        action,
        link,
        supplier,
        price: price === "" ? undefined : Number(price),
        adminNote: adminNote.trim(),
      });
      onDone?.();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <h3 style={{ margin: "0 0 8px" }}>Замена на проверке</h3>
        <p style={{ fontSize: 14, margin: "0 0 12px" }}>{item.name}</p>
        {item.replacementLink && (
          <p style={{ fontSize: 13 }}>
            <b>Ссылка клиента:</b>{" "}
            <a href={item.replacementLink} target="_blank" rel="noreferrer">
              {item.replacementLink}
            </a>
          </p>
        )}
        {item.replacementPhotoUrl && (
          <p style={{ fontSize: 13 }}>
            <b>Фото:</b>{" "}
            <a href={item.replacementPhotoUrl} target="_blank" rel="noreferrer">
              открыть
            </a>
          </p>
        )}
        {item.replacementPrice != null && (
          <p style={{ fontSize: 13 }}>
            <b>Цена клиента:</b> {money(item.replacementPrice, currency)}
          </p>
        )}
        {item.replacementComment && (
          <p style={{ fontSize: 13 }}>
            <b>Комментарий:</b> {item.replacementComment}
          </p>
        )}
        <div className="field" style={{ marginTop: 12 }}>
          <label>Ссылка в проекте</label>
          <input value={link} onChange={(e) => setLink(e.target.value)} />
        </div>
        <div className="field">
          <label>Поставщик</label>
          <input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </div>
        <div className="field">
          <label>Цена в проекте</label>
          <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="field">
          <label>Комментарий админа</label>
          <textarea rows={2} value={adminNote} onChange={(e) => setAdminNote(e.target.value)} />
        </div>
        <div className="row" style={{ gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => review("accept")}>
            Принять
          </button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => review("reject")}>
            Отклонить
          </button>
          <button type="button" className="btn" style={{ marginLeft: "auto" }} onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

export function PurchasePrioritySelect({ value, onChange, compact }) {
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      style={compact ? { fontSize: 12, padding: "2px 4px" } : undefined}
      title="Приоритет закупки"
    >
      <option value="">— приоритет —</option>
      {PURCHASE_PRIORITIES.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label}
        </option>
      ))}
    </select>
  );
}

export { purchasePriorityLabel, enrichRoom, actualCoolingFromItem, roomLabel, num };
