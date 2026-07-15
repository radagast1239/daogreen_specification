import React, { useState } from "react";
import { api, photoSrc } from "../lib/api.js";
import FloorPlanViewer from "./FloorPlanViewer.jsx";
import {
  CLIENT_SCHEME_DEFS,
  defaultClientSchemeVisible,
  filledSchemeSlots,
  patchManualSchemes,
  patchSchemeVisibility,
} from "../lib/clientSchemes.js";

/**
 * Upload / replace / open / remove for the 5 project scheme slots.
 * showClientVisibility — SpecEditor client toggle; false in project builder.
 */
export default function ClientSchemesEditor({
  manualParams,
  onChange,
  showClientVisibility = true,
  title = null,
  intro = null,
}) {
  const mp = manualParams && typeof manualParams === "object" ? manualParams : {};
  const visible = { ...defaultClientSchemeVisible(), ...(mp.clientSchemeVisible || {}) };
  const [viewer, setViewer] = useState(null);
  const [uploading, setUploading] = useState(null);

  const filled = filledSchemeSlots(mp);
  const heading = title ?? (showClientVisibility ? null : "Схемы проекта");
  const description =
    intro ??
    (showClientVisibility
      ? "Отдельные схемы для клиента — только просмотр, без редактирования. Отметьте галочкой, что показывать в клиентской ссылке."
      : "Загрузите до пяти схем прямо в мастере. Каждая пишется в свой слот manualParams и сохраняется с проектом.");

  const upload = async (key, file) => {
    if (!file) return;
    setUploading(key);
    try {
      const { url } = await api.uploadPhoto(file);
      onChange(patchManualSchemes(mp, key, url));
    } catch (e) {
      alert(e.message || "Не удалось загрузить");
    } finally {
      setUploading(null);
    }
  };

  const openSlot = (key) => {
    const idx = filled.findIndex((s) => s.key === key);
    if (idx < 0) return;
    setViewer({ schemes: filled, initialIndex: idx });
  };

  return (
    <div className="client-schemes-editor" style={{ marginBottom: 14 }}>
      {heading && (
        <h4 style={{ margin: "0 0 6px", fontSize: 14 }}>{heading}</h4>
      )}
      <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
        {description}
      </p>
      <div className="client-schemes-grid">
        {CLIENT_SCHEME_DEFS.map((def) => {
          const url = mp[def.key] || "";
          const src = url ? photoSrc(url) : "";
          return (
            <div key={def.key} className="client-scheme-card card" style={{ padding: 12 }}>
              <div className="between wrap" style={{ gap: 8, marginBottom: 8 }}>
                <div>
                  <strong style={{ fontSize: 13 }}>{def.label}</strong>
                  <p className="muted" style={{ fontSize: 11, margin: "2px 0 0" }}>
                    {def.hint}
                  </p>
                </div>
                {showClientVisibility && (
                  <label className="row" style={{ fontSize: 11, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={visible[def.key] !== false}
                      onChange={(e) => onChange(patchSchemeVisibility(mp, def.key, e.target.checked))}
                    />
                    Клиенту
                  </label>
                )}
              </div>
              {src ? (
                <button
                  type="button"
                  className="client-scheme-card__thumb"
                  onClick={() => openSlot(def.key)}
                  title="Открыть"
                >
                  <img src={src} alt={def.label} />
                </button>
              ) : (
                <div className="client-scheme-card__empty muted">Нет файла</div>
              )}
              <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                <label className="btn btn-sm" style={{ cursor: "pointer" }}>
                  {uploading === def.key ? "…" : url ? "Заменить" : "Загрузить"}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    disabled={!!uploading}
                    onChange={(e) => {
                      upload(def.key, e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                {url && (
                  <>
                    <button type="button" className="btn btn-sm" onClick={() => openSlot(def.key)}>
                      Открыть
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => onChange(patchManualSchemes(mp, def.key, ""))}
                    >
                      Убрать
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {viewer && (
        <FloorPlanViewer
          schemes={viewer.schemes}
          initialIndex={viewer.initialIndex}
          open
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}

/** Просмотр схем на клиентской странице */
export function ClientSchemesViewer({ manualParams }) {
  const mp = manualParams && typeof manualParams === "object" ? manualParams : {};
  const visible = { ...defaultClientSchemeVisible(), ...(mp.clientSchemeVisible || {}) };
  const schemes = CLIENT_SCHEME_DEFS.filter((d) => mp[d.key] && visible[d.key] !== false).map((d) => ({
    ...d,
    url: mp[d.key],
    label: d.label,
  }));
  const [viewer, setViewer] = useState(null);

  if (!schemes.length) return null;

  return (
    <div className="client-schemes-viewer card" style={{ padding: 16, marginBottom: 16 }}>
      <strong style={{ fontSize: 14 }}>Схемы и планы</strong>
      <p className="muted" style={{ fontSize: 12, margin: "4px 0 12px" }}>
        Нажмите на схему, чтобы открыть на весь экран.
      </p>
      <div className="client-schemes-viewer__grid">
        {schemes.map((def, i) => {
          const src = photoSrc(def.url);
          if (!src) return null;
          return (
            <button
              key={def.key}
              type="button"
              className="client-scheme-view-btn"
              onClick={() => setViewer({ schemes, initialIndex: i })}
            >
              <img src={src} alt="" />
              <span>{def.label}</span>
            </button>
          );
        })}
      </div>
      {viewer && (
        <FloorPlanViewer
          schemes={viewer.schemes}
          initialIndex={viewer.initialIndex}
          open
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}
