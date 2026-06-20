import React, { useEffect } from "react";
import { photoSrc } from "../lib/api.js";

/** Полноэкранный просмотр схемы — Esc или клик по фону закрывает */
export default function FloorPlanViewer({ url, title = "Схема помещения", open, onClose }) {
  const src = url ? photoSrc(url) : "";

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !src) return null;

  return (
    <div className="floor-plan-fullscreen" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="floor-plan-fullscreen__bar" onClick={(e) => e.stopPropagation()}>
        <strong>{title}</strong>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          ✕ Закрыть
        </button>
      </div>
      <div className="floor-plan-fullscreen__body" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={title} className="floor-plan-fullscreen__img" />
      </div>
      <p className="floor-plan-fullscreen__hint muted">Esc или клик по фону — закрыть</p>
    </div>
  );
}
