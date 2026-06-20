import React, { useState } from "react";
import { api, photoSrc } from "../lib/api.js";

/** Фото стеллажа — превью + загрузка */
export default function StellagePhotoField({
  value,
  onChange,
  label = "Фото стеллажа",
  hint = "Показывается в мастере проекта и в списке пресетов.",
  compact = false,
}) {
  const [uploading, setUploading] = useState(false);
  const src = value ? photoSrc(value) : "";

  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await api.uploadPhoto(file);
      onChange(url);
    } catch (err) {
      alert(err.message || "Не удалось загрузить");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  if (compact) {
    return (
      <div className="stellage-photo-field stellage-photo-field--compact">
        {src ? (
          <img src={src} alt="" className="stellage-photo-field__thumb" />
        ) : (
          <div className="stellage-photo-field__empty">?</div>
        )}
        <div className="stellage-photo-field__actions">
          <label className="btn btn-sm" style={{ cursor: "pointer" }}>
            {uploading ? "…" : src ? "Заменить" : "Фото"}
            <input type="file" accept="image/*" hidden disabled={uploading} onChange={upload} />
          </label>
          {src && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange("")}>
              ✕
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="stellage-photo-field card" style={{ padding: 14, marginBottom: 12 }}>
      <div className="between wrap" style={{ gap: 10 }}>
        <div>
          <strong style={{ fontSize: 14 }}>{label}</strong>
          {hint && <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>{hint}</p>}
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          <label className="btn btn-sm" style={{ cursor: "pointer" }}>
            {uploading ? "Загрузка…" : value ? "Заменить" : "Загрузить фото"}
            <input type="file" accept="image/*" hidden disabled={uploading} onChange={upload} />
          </label>
          {value && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange("")}>
              Убрать
            </button>
          )}
        </div>
      </div>
      {src && (
        <button type="button" className="stellage-photo-field__preview" onClick={() => window.open(src, "_blank")}>
          <img src={src} alt="" />
        </button>
      )}
    </div>
  );
}

export function StellagePhotoThumb({ url, size = 56 }) {
  const src = url ? photoSrc(url) : "";
  if (!src) return <div className="stellage-photo-thumb stellage-photo-thumb--empty" style={{ width: size, height: size }} />;
  return <img src={src} alt="" className="stellage-photo-thumb" style={{ width: size, height: size }} />;
}
