import React, { useCallback, useState } from "react";
import { api, photoSrc } from "../lib/api.js";
import { getClipboardImageFile } from "../lib/clipboardPhoto.js";

/** Фото стеллажа — превью + загрузка + вставка из буфера */
export default function StellagePhotoField({
  value,
  onChange,
  label = "Фото стеллажа",
  hint = "Показывается в мастере проекта и в списке пресетов.",
  compact = false,
}) {
  const [uploading, setUploading] = useState(false);
  const src = value ? photoSrc(value) : "";

  const uploadFile = useCallback(
    async (file) => {
      if (!file) return;
      setUploading(true);
      try {
        const { url } = await api.uploadPhoto(file);
        onChange(url);
      } catch (err) {
        alert(err.message || "Не удалось загрузить");
      } finally {
        setUploading(false);
      }
    },
    [onChange]
  );

  const onPaste = useCallback(
    (e) => {
      const file = getClipboardImageFile(e);
      if (!file) return;
      e.preventDefault();
      uploadFile(file);
    },
    [uploadFile]
  );

  const onFileInput = async (e) => {
    await uploadFile(e.target.files?.[0]);
    e.target.value = "";
  };

  const pasteHint = "Ctrl+V — скрин из буфера";

  if (compact) {
    return (
      <div
        className="stellage-photo-field stellage-photo-field--compact photo-paste-target"
        tabIndex={0}
        onPaste={onPaste}
        title={pasteHint}
      >
        {src ? (
          <img src={src} alt="" className="stellage-photo-field__thumb" />
        ) : (
          <div className="stellage-photo-field__empty">?</div>
        )}
        <div className="stellage-photo-field__actions">
          <label className="btn btn-sm" style={{ cursor: "pointer" }}>
            {uploading ? "…" : src ? "Заменить" : "Фото"}
            <input type="file" accept="image/*" hidden disabled={uploading} onChange={onFileInput} />
          </label>
          <span className="muted" style={{ fontSize: 10 }}>Ctrl+V</span>
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
    <div
      className="stellage-photo-field card photo-paste-target"
      tabIndex={0}
      onPaste={onPaste}
      style={{ padding: 14, marginBottom: 12, outline: "none" }}
    >
      <div className="between wrap" style={{ gap: 10 }}>
        <div>
          <strong style={{ fontSize: 14 }}>{label}</strong>
          {hint && <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>{hint}</p>}
          <p className="muted" style={{ fontSize: 11, margin: "4px 0 0" }}>{pasteHint} (Win+Shift+S)</p>
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          <label className="btn btn-sm" style={{ cursor: "pointer" }}>
            {uploading ? "Загрузка…" : value ? "Заменить" : "Загрузить фото"}
            <input type="file" accept="image/*" hidden disabled={uploading} onChange={onFileInput} />
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
