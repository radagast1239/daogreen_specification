import React, { useState } from "react";

export default function ClientReplacementModal({ open, itemName, onClose, onSubmit }) {
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
        <h3 style={{ margin: "0 0 8px" }}>Нужна замена</h3>
        <p className="muted" style={{ fontSize: 13, margin: "0 0 16px" }}>{itemName}</p>
        <div className="field">
          <label>Ссылка на товар</label>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
        </div>
        <div className="field">
          <label>Фото (URL)</label>
          <input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://…" />
        </div>
        <div className="field">
          <label>Цена</label>
          <input type="number" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="field">
          <label>Комментарий</label>
          <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          После отправки статус станет «Замена на проверке». Daogreen проверит предложение.
        </p>
        <div className="row" style={{ gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Отправить
          </button>
        </div>
      </form>
    </div>
  );
}
