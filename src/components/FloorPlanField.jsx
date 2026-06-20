import React, { useState } from "react";
import { api, photoSrc } from "../lib/api.js";

/** Загрузка одной схемы помещения (на весь объект, не по стеллажам) */
export default function FloorPlanField({ value, onChange }) {
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

  return (
    <div className="card floor-plan-field" style={{ padding: 16, marginBottom: 14 }}>
      <div className="between wrap" style={{ gap: 12, marginBottom: src ? 12 : 0 }}>
        <div>
          <h4 style={{ margin: 0, fontSize: 14 }}>Схема помещения</h4>
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 0", maxWidth: 520 }}>
            План с трубами, стеллажами и зонами — одна картинка на всю ферму. На шагах «Ферма целиком» и «Охлаждение» появится
            кнопка «Схема» в углу экрана.
          </p>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <label className="btn btn-sm" style={{ cursor: "pointer" }}>
            {uploading ? "Загрузка…" : value ? "Заменить схему" : "Загрузить схему"}
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
        <button type="button" className="floor-plan-field__preview" onClick={() => window.open(src, "_blank")} title="Открыть">
          <img src={src} alt="Схема помещения" />
        </button>
      )}
    </div>
  );
}
