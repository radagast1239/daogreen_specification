import React, { useEffect, useMemo, useRef, useState } from "react";
import { photoSrc } from "../lib/api.js";
import FloorPlanViewer from "./FloorPlanViewer.jsx";
import { findSchemeIndexByKey } from "../lib/clientSchemes.js";

/**
 * Плавающая миниатюра или кнопка — открывает схему.
 * При нескольких схемах: selector → viewer, сессионный выбор без записи в проект.
 */
export default function FloorPlanPin({
  url,
  schemes: schemesProp,
  title = "Схема помещения",
  variant = "pin",
}) {
  const schemes = useMemo(() => {
    if (Array.isArray(schemesProp) && schemesProp.length) {
      return schemesProp.filter((s) => s?.url);
    }
    if (url) return [{ key: "floorPlanUrl", url, title, label: title }];
    return [];
  }, [schemesProp, url, title]);

  const [selectorOpen, setSelectorOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [activeKey, setActiveKey] = useState(() => schemes[0]?.key || "");
  const rootRef = useRef(null);

  useEffect(() => {
    if (!schemes.length) return;
    if (!schemes.some((s) => s.key === activeKey)) {
      setActiveKey(schemes[0].key);
    }
  }, [schemes, activeKey]);

  useEffect(() => {
    if (!selectorOpen) return;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setSelectorOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [selectorOpen]);

  if (!schemes.length) return null;

  const activeIndex = findSchemeIndexByKey(schemes, activeKey);
  const active = schemes[activeIndex] || schemes[0];
  const src = photoSrc(active.url);
  const multi = schemes.length > 1;
  const pinLabel = multi ? "Схемы" : "Схема";

  const openActiveViewer = (key = active.key) => {
    setActiveKey(key);
    setSelectorOpen(false);
    setViewerOpen(true);
  };

  const onPinClick = () => {
    if (!multi) {
      openActiveViewer(active.key);
      return;
    }
    setSelectorOpen((v) => !v);
  };

  const viewer = (
    <FloorPlanViewer
      url={active.url}
      title={active.title || title}
      open={viewerOpen}
      onClose={() => setViewerOpen(false)}
      schemes={multi ? schemes : null}
      activeIndex={activeIndex}
      onActiveIndexChange={(next) => {
        const i = typeof next === "function" ? next(activeIndex) : next;
        const s = schemes[i];
        if (s) setActiveKey(s.key);
      }}
    />
  );

  const selector = multi && selectorOpen ? (
    <div className="floor-plan-pin__selector" role="menu" aria-label="Выбор схемы">
      {schemes.map((s, i) => (
        <button
          key={s.key || i}
          type="button"
          className={`floor-plan-pin__option${s.key === active.key ? " is-active" : ""}`}
          role="menuitem"
          onClick={() => openActiveViewer(s.key)}
        >
          <img src={photoSrc(s.url)} alt="" className="floor-plan-pin__option-img" />
          <span className="floor-plan-pin__option-meta">
            <strong>{s.title || `Схема ${i + 1}`}</strong>
            <span className="muted">
              {i + 1} из {schemes.length}
            </span>
          </span>
        </button>
      ))}
    </div>
  ) : null;

  if (variant === "button") {
    return (
      <div className="floor-plan-open-wrap" ref={rootRef}>
        <button
          type="button"
          className="btn btn-sm floor-plan-open-btn"
          onClick={onPinClick}
          title={multi ? "Выбрать схему" : `${active.title || title} — открыть`}
        >
          📐 {multi ? "Схемы" : active.title || title}
        </button>
        {selector}
        {viewer}
      </div>
    );
  }

  return (
    <div className="floor-plan-pin-wrap no-print" ref={rootRef}>
      <button
        type="button"
        className="floor-plan-pin"
        onClick={onPinClick}
        title={multi ? "Выбрать схему" : `${active.title || title} — открыть`}
        aria-label={pinLabel}
        aria-expanded={multi ? selectorOpen : undefined}
      >
        <img src={src} alt="" className="floor-plan-pin__img" />
        <span className="floor-plan-pin__label">{pinLabel}</span>
        {multi && <span className="floor-plan-pin__badge">{schemes.length}</span>}
      </button>
      {selector}
      {viewer}
    </div>
  );
}
