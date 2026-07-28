import React, { useState } from "react";
import { t } from "../../../shared/clientI18n.js";

export default function ClientReplacementModal({ open, itemName, onClose, onSubmit, language = "ru" }) {
  const [link, setLink] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [price, setPrice] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit({
        link: link.trim(),
        photoUrl: photoUrl.trim(),
        price: price === "" ? null : Number(price),
        comment: comment.trim(),
      });
      setLink("");
      setPhotoUrl("");
      setPrice("");
      setComment("");
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal card" onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ maxWidth: 480 }}>
        <h3 style={{ margin: "0 0 8px" }}>{t(language, "client.replacementModal.title")}</h3>
        <p className="muted" style={{ fontSize: 13, margin: "0 0 16px" }}>{itemName}</p>
        <div className="field">
          <label>{t(language, "client.replacementModal.linkLabel")}</label>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
        </div>
        <div className="field">
          <label>{t(language, "client.replacementModal.photoLabel")}</label>
          <input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://…" />
        </div>
        <div className="field">
          <label>{t(language, "client.replacementModal.priceLabel")}</label>
          <input type="number" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="field">
          <label>{t(language, "client.replacementModal.commentLabel")}</label>
          <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          {t(language, "client.replacementModal.hint")}
        </p>
        <div className="row" style={{ gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t(language, "client.common.cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t(language, "client.common.send")}
          </button>
        </div>
      </form>
    </div>
  );
}
