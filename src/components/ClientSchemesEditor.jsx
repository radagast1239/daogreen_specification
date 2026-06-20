import React, { useState } from "react";
import { api, photoSrc } from "../lib/api.js";
import FloorPlanViewer from "./FloorPlanViewer.jsx";
import {
  CLIENT_SCHEME_DEFS,
  defaultClientSchemeVisible,
  patchManualSchemes,
  patchSchemeVisibility,
} from "../lib/clientSchemes.js";

/** Загрузка схем для клиента (трубы, стеллажи, помещения…) */
export default function ClientSchemesEditor({ manualParams, onChange }) {
  const mp = manualParams && typeof manualParams === "object" ? manualParams : {};
  const visible = { ...defaultClientSchemeVisible(), ...(mp.clientSchemeVisible || {}) };
  const [viewer, setViewer] = useState(null);
  const [uploading, setUploading] = useState(null);

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

  return (
    <div className="client-schemes-editor">
      <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
        Отдельные схемы для клиента — только просмотр, без редактирования. Отметьте галочкой, что показывать в
        клиентской ссылке.
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
                  <p className="muted" style={{ fontSize: 11, margin: "2px 0 0" }}>{def.hint}</p>
                </div>
                <label className="row" style={{ fontSize: 11, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={visible[def.key] !== false}
                    onChange={(e) => onChange(patchSchemeVisibility(mp, def.key, e.target.checked))}
                  />
                  Клиенту
                </label>
              </div>
              {src ? (
                <button type="button" className="client-scheme-card__thumb" onClick={() => setViewer({ url, title: def.label })}>
                  <img src={src} alt="" />
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
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(patchManualSchemes(mp, def.key, ""))}>
                    Убрать
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {viewer && (
        <FloorPlanViewer url={viewer.url} title={viewer.title} open onClose={() => setViewer(null)} />
      )}
    </div>
  );
}

/** Просмотр схем на клиентской странице */
export function ClientSchemesViewer({ manualParams }) {
  const mp = manualParams && typeof manualParams === "object" ? manualParams : {};
  const visible = { ...defaultClientSchemeVisible(), ...(mp.clientSchemeVisible || {}) };
  const schemes = CLIENT_SCHEME_DEFS.filter((d) => mp[d.key] && visible[d.key] !== false);
  const [viewer, setViewer] = useState(null);

  if (!schemes.length) return null;

  return (
    <div className="client-schemes-viewer card" style={{ padding: 16, marginBottom: 16 }}>
      <strong style={{ fontSize: 14 }}>Схемы и планы</strong>
      <p className="muted" style={{ fontSize: 12, margin: "4px 0 12px" }}>
        Нажмите на схему, чтобы открыть на весь экран.
      </p>
      <div className="client-schemes-viewer__grid">
        {schemes.map((def) => {
          const src = photoSrc(mp[def.key]);
          if (!src) return null;
          return (
            <button
              key={def.key}
              type="button"
              className="client-scheme-view-btn"
              onClick={() => setViewer({ url: mp[def.key], title: def.label })}
            >
              <img src={src} alt="" />
              <span>{def.label}</span>
            </button>
          );
        })}
      </div>
      {viewer && (
        <FloorPlanViewer url={viewer.url} title={viewer.title} open onClose={() => setViewer(null)} />
      )}
    </div>
  );
}
