import React, { useEffect, useRef, useState } from "react";
import { photoSrc } from "../lib/api.js";
import { isPdfScheme, schemeOpenRel } from "../lib/schemeMedia.js";

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
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const list = Array.isArray(schemes) && schemes.length ? schemes : null;
  const idx = list
    ? Math.min(Math.max(0, Number(activeIndex) || 0), list.length - 1)
    : 0;
  const active = list ? list[idx] : null;
  const activeUrl = active?.accessUrl || active?.url || url;
  const pdf = isPdfScheme(active || { mimeType: "", url: activeUrl }, activeUrl);
  const src = !pdf ? photoSrc(activeUrl) : "";
  const href = photoSrc(activeUrl);
  const heading = active
    ? `${active.title || title} · ${idx + 1} из ${list.length}`
    : title;
  const canNav = list && list.length > 1 && typeof onActiveIndexChange === "function";

  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [idx, open]);

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

  if (!open || !href) return null;

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
          {!pdf && (
            <div className="floor-plan-fullscreen__nav" aria-label="Масштаб">
              <button type="button" className="btn btn-sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>−</button>
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" className="btn btn-sm" onClick={() => setZoom((z) => Math.min(5, z + 0.25))}>+</button>
              <button type="button" className="btn btn-sm" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}>Сбросить</button>
            </div>
          )}
        </div>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          ✕ Закрыть
        </button>
      </div>
      <div
        className="floor-plan-fullscreen__body"
        onClick={(e) => e.stopPropagation()}
        onWheel={pdf ? undefined : (e) => { e.preventDefault(); setZoom((z) => Math.min(5, Math.max(0.5, z + (e.deltaY < 0 ? 0.2 : -0.2)))); }}
        onPointerDown={pdf ? undefined : (e) => { dragRef.current = { clientX: e.clientX, clientY: e.clientY, originX: offset.x, originY: offset.y }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={pdf ? undefined : (e) => { if (!dragRef.current) return; setOffset({ x: dragRef.current.originX + e.clientX - dragRef.current.clientX, y: dragRef.current.originY + e.clientY - dragRef.current.clientY }); }}
        onPointerUp={pdf ? undefined : () => { dragRef.current = null; }}
      >
        {pdf ? (
          <div style={{ textAlign: "center", padding: 40 }}>
            <p style={{ marginBottom: 16 }}><strong>PDF</strong> — {heading}</p>
            <a className="btn" href={href} target="_blank" rel={schemeOpenRel()}>
              Открыть PDF
            </a>
          </div>
        ) : (
          <img src={src} alt={heading} className="floor-plan-fullscreen__img" draggable="false" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }} />
        )}
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
              {isPdfScheme(s) ? (
                <span style={{ display: "grid", placeItems: "center", width: "100%", height: "100%", fontSize: 11, fontWeight: 700 }}>PDF</span>
              ) : (
                <img src={photoSrc(s.accessUrl || s.url)} alt="" />
              )}
            </button>
          ))}
        </div>
      )}
      <p className="floor-plan-fullscreen__hint muted">
        Esc или клик по фону — закрыть{pdf ? "" : " · колесо — масштаб · перетаскивание — перемещение"}{canNav ? " · ← → переключение схем" : ""}
      </p>
    </div>
  );
}
