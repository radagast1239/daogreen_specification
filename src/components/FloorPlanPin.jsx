import React, { useEffect, useState } from "react";
import { photoSrc } from "../lib/api.js";

/** Плавающая миниатюра схемы — клик открывает на весь экран */
export default function FloorPlanPin({ url, title = "Схема помещения" }) {
  const [open, setOpen] = useState(false);
  const src = url ? photoSrc(url) : "";

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!src) return null;

  return (
    <>
      <button
        type="button"
        className="floor-plan-pin no-print"
        onClick={() => setOpen(true)}
        title={`${title} — открыть`}
        aria-label={title}
      >
        <img src={src} alt="" className="floor-plan-pin__img" />
        <span className="floor-plan-pin__label">Схема</span>
      </button>

      {open && (
        <div className="floor-plan-fullscreen" onClick={() => setOpen(false)} role="dialog" aria-modal="true">
          <div className="floor-plan-fullscreen__bar" onClick={(e) => e.stopPropagation()}>
            <strong>{title}</strong>
            <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
              ✕ Закрыть
            </button>
          </div>
          <div className="floor-plan-fullscreen__body" onClick={(e) => e.stopPropagation()}>
            <img src={src} alt={title} className="floor-plan-fullscreen__img" />
          </div>
          <p className="floor-plan-fullscreen__hint muted">Esc или клик по фону — закрыть</p>
        </div>
      )}
    </>
  );
}
