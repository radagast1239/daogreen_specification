import React, { useEffect } from "react";
import { photoSrc } from "../lib/api.js";

/** Полноэкранный просмотр схемы — Esc или клик по фону закрывает */
export default function FloorPlanViewer({
  url,
  title = "Схема помещения",
  open,
  onClose,
  schemes = null,
  activeIndex = 0,
  onActiveIndexChange,
}) {
  const list = Array.isArray(schemes) && schemes.length ? schemes : null;
  const idx = list
    ? Math.min(Math.max(0, Number(activeIndex) || 0), list.length - 1)
    : 0;
  const active = list ? list[idx] : null;
  const src = photoSrc(active?.url || url);
  const heading = active
    ? `${active.title || title} · ${idx + 1} из ${list.length}`
    : title;
  const canNav = list && list.length > 1 && typeof onActiveIndexChange === "function";

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (!canNav) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onActiveIndexChange((idx - 1 + list.length) % list.length);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onActiveIndexChange((idx + 1) % list.length);
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, canNav, idx, list, onActiveIndexChange]);

  if (!open || !src) return null;

  return (
    <div className="floor-plan-fullscreen" onClick={onClose} role="dialog" aria-modal="true" aria-label={heading}>
      <div className="floor-plan-fullscreen__bar" onClick={(e) => e.stopPropagation()}>
        <div className="floor-plan-fullscreen__title-wrap">
          <strong>{heading}</strong>
          {canNav && (
            <div className="floor-plan-fullscreen__nav">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => onActiveIndexChange((idx - 1 + list.length) % list.length)}
                aria-label="Предыдущая схема"
              >
                ←
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => onActiveIndexChange((idx + 1) % list.length)}
                aria-label="Следующая схема"
              >
                →
              </button>
            </div>
          )}
        </div>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          ✕ Закрыть
        </button>
      </div>
      <div className="floor-plan-fullscreen__body" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={heading} className="floor-plan-fullscreen__img" />
      </div>
      {canNav && (
        <div className="floor-plan-fullscreen__thumbs" onClick={(e) => e.stopPropagation()}>
          {list.map((s, i) => (
            <button
              key={s.key || i}
              type="button"
              className={`floor-plan-fullscreen__thumb${i === idx ? " is-active" : ""}`}
              onClick={() => onActiveIndexChange(i)}
              title={s.title || `Схема ${i + 1}`}
            >
              <img src={photoSrc(s.url)} alt="" />
            </button>
          ))}
        </div>
      )}
      <p className="floor-plan-fullscreen__hint muted">
        Esc или клик по фону — закрыть{canNav ? " · ← → переключение схем" : ""}
      </p>
    </div>
  );
}
