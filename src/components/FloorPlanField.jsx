import React, { useCallback, useState } from "react";
import { api, photoSrc } from "../lib/api.js";
import FloorPlanViewer from "./FloorPlanViewer.jsx";
import { useClipboardImagePaste } from "../lib/useClipboardImagePaste.js";
import { isPdfScheme, SCHEME_FILE_ACCEPT, schemeOpenRel } from "../lib/schemeMedia.js";

/** Загрузка одной схемы помещения (на весь объект, не по стеллажам) */
export default function FloorPlanField({
  value,
  onChange,
  title = "Схема помещения",
  onTitleChange,
  mimeType = "image/*",
}) {
  const [uploading, setUploading] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const pdf = isPdfScheme(mimeType, value);
  const src = value && !pdf ? photoSrc(value) : "";
  const href = value ? photoSrc(value) : "";

  const uploadFile = useCallback(
    async (file) => {
      if (!file || uploading) return;
      setUploading(true);
      try {
        const result = await api.uploadProjectScheme(file);
        onChange(result.url, {
          mimeType: result.mimeType || file.type || "image/*",
          title: title || undefined,
        });
      } catch (err) {
        alert(err.message || "Не удалось загрузить");
      } finally {
        setUploading(false);
      }
    },
    [onChange, title, uploading]
  );

  const { pasteZoneProps } = useClipboardImagePaste({
    disabled: uploading,
    onImage: (file) => uploadFile(file),
  });

  const onFileInput = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await uploadFile(file);
  };

  return (
    <div
      className="card floor-plan-field"
      style={{ padding: 16, marginBottom: 14 }}
      {...pasteZoneProps}
    >
      <div className="between wrap" style={{ gap: 12, marginBottom: value ? 12 : 0 }}>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <h4 style={{ margin: 0, fontSize: 14 }}>Схема помещения</h4>
          {typeof onTitleChange === "function" ? (
            <input
              className="spec-cell-input"
              value={title}
              aria-label="Название схемы помещения"
              onChange={(e) => onTitleChange(e.target.value)}
              style={{ marginTop: 6, width: "100%", maxWidth: 420, fontWeight: 600, fontSize: 13 }}
            />
          ) : null}
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 0", maxWidth: 640 }}>
            План с трубами, стеллажами и зонами — общая схема объекта. Загрузите файл или вставьте скриншот
            Ctrl+V. Дополнительные схемы — в блоке «Схемы для клиента».
          </p>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <label className="btn btn-sm" style={{ cursor: "pointer" }}>
            {uploading ? "Загрузка…" : value ? "Заменить схему" : "Загрузить схему"}
            <input
              type="file"
              accept={SCHEME_FILE_ACCEPT}
              hidden
              disabled={uploading}
              onChange={onFileInput}
            />
          </label>
          {value && (
            <>
              {pdf ? (
                <a className="btn btn-sm" href={href} target="_blank" rel={schemeOpenRel()}>
                  Открыть PDF
                </a>
              ) : (
                <button type="button" className="btn btn-sm" onClick={() => setViewerOpen(true)}>
                  Открыть схему
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange("")}>
                Убрать
              </button>
            </>
          )}
        </div>
      </div>
      {pdf && href ? (
        <div className="floor-plan-field__pdf card" style={{ padding: 14, borderStyle: "dashed" }}>
          <div className="between wrap" style={{ gap: 8 }}>
            <div>
              <strong>{title || "Схема помещения"}</strong>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>PDF · не отображается как изображение</p>
            </div>
            <a className="btn btn-sm" href={href} target="_blank" rel={schemeOpenRel()}>
              Открыть PDF
            </a>
          </div>
        </div>
      ) : null}
      {src && (
        <button
          type="button"
          className="floor-plan-field__preview"
          onClick={() => setViewerOpen(true)}
          title="Открыть схему на весь экран"
        >
          <img src={src} alt={title || "Схема помещения"} />
          <span className="floor-plan-field__preview-hint">Нажмите, чтобы развернуть</span>
        </button>
      )}
      {!pdf && (
        <FloorPlanViewer
          url={value}
          title={title}
          open={viewerOpen}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </div>
  );
}
