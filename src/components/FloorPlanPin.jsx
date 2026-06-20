import React, { useState } from "react";
import { photoSrc } from "../lib/api.js";
import FloorPlanViewer from "./FloorPlanViewer.jsx";

/** Плавающая миниатюра или кнопка в тулбаре — клик открывает оверлей на весь экран */
export default function FloorPlanPin({ url, title = "Схема помещения", variant = "pin" }) {
  const [open, setOpen] = useState(false);
  const src = url ? photoSrc(url) : "";

  if (!src) return null;

  const viewer = <FloorPlanViewer url={url} title={title} open={open} onClose={() => setOpen(false)} />;

  if (variant === "button") {
    return (
      <>
        <button
          type="button"
          className="btn btn-sm floor-plan-open-btn"
          onClick={() => setOpen(true)}
          title={`${title} — открыть`}
        >
          📐 {title}
        </button>
        {viewer}
      </>
    );
  }

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
      {viewer}
    </>
  );
}
