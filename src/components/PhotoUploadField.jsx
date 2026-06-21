import React, { useCallback, useEffect, useState } from "react";
import { api, photoSrc } from "../lib/api.js";
import { getClipboardImageFile } from "../lib/clipboardPhoto.js";

const PASTE_HINT = "Ctrl+V — вставить скрин из буфера (Win+Shift+S)";

/** Загрузка фото: файл, вставка из буфера, URL */
export default function PhotoUploadField({
  value,
  onChange,
  label = "Фото",
  pasteAnywhere = false,
  compact = false,
  showUrlInput = true,
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
        alert(err.message || "Не удалось загрузить фото");
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

  useEffect(() => {
    if (!pasteAnywhere) return;
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [pasteAnywhere, onPaste]);

  const onFileInput = async (e) => {
    await uploadFile(e.target.files?.[0]);
    e.target.value = "";
  };

  if (compact) {
    return (
      <div
        className="photo-upload-field photo-upload-field--compact photo-paste-target"
        tabIndex={0}
        onPaste={onPaste}
        title={PASTE_HINT}
      >
        {src ? (
          <img src={src} alt="" className="thumb-img" />
        ) : (
          <div className="thumb" style={{ fontSize: 22 }}>
            ?
          </div>
        )}
        <div className="row" style={{ gap: 4, marginTop: 4, flexWrap: "wrap" }}>
          <label className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: "2px 6px", cursor: "pointer" }}>
            {uploading ? "…" : "📷 файл"}
            <input type="file" accept="image/*" hidden disabled={uploading} onChange={onFileInput} />
          </label>
          <span className="muted" style={{ fontSize: 10 }}>Ctrl+V</span>
        </div>
      </div>
    );
  }

  return (
    <div className="field photo-upload-field">
      <label>{label}</label>
      {showUrlInput && (
        <input
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="URL или загрузите / вставьте из буфера"
        />
      )}
      <div
        className="photo-paste-target card"
        tabIndex={0}
        onPaste={onPaste}
        style={{
          marginTop: 8,
          padding: 12,
          outline: "none",
          border: "1px dashed var(--border, #c5d9d3)",
        }}
      >
        <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
          <label className="btn btn-sm" style={{ cursor: "pointer" }}>
            {uploading ? "Загрузка…" : "Выбрать файл"}
            <input type="file" accept="image/*" hidden disabled={uploading} onChange={onFileInput} />
          </label>
          <span className="muted" style={{ fontSize: 12 }}>{PASTE_HINT}</span>
          {pasteAnywhere && (
            <span className="muted" style={{ fontSize: 11 }}>— работает по всему окну</span>
          )}
        </div>
        {src && (
          <img
            src={src}
            alt=""
            className="thumb-img"
            style={{ marginTop: 10, maxHeight: 160, objectFit: "contain" }}
          />
        )}
      </div>
    </div>
  );
}
