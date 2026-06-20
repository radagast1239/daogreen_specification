import React, { useState } from "react";
import { useStore } from "../store/StoreContext.jsx";
import { api } from "../lib/api.js";
import { seedModules } from "../data/modules.js";
import { useToast } from "./Toast.jsx";

const MODULE_PRESETS = [
  { label: "— авто по имени файла —", value: "" },
  { label: "Общая закупка на ферму", value: "Общая закупка на ферму" },
  { label: "Стеллаж подтопление", value: "Стеллаж подтопление" },
  { label: "Стеллаж проточка", value: "Стеллаж проточка" },
  { label: "Стеллаж аэропоника", value: "Стеллаж аэропоника" },
  ...seedModules.map((m) => ({ label: m.name, value: m.name })),
].filter((v, i, a) => a.findIndex((x) => x.value === v.value) === i);

export default function ImportPanel() {
  const { actions } = useStore();
  const { success, error } = useToast();
  const [file, setFile] = useState(null);
  const [module, setModule] = useState("");
  const [mode, setMode] = useState("merge");
  const [photosOnly, setPhotosOnly] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!file) return;
    setLoading(true);
    setResult(null);
    try {
      if (photosOnly) {
        const r = await api.importExcelPhotos(file, { module: module || undefined });
        setResult({ photosLinked: r.linked, imagesFound: r.imagesFound, unmatched: r.unmatched });
        await actions.refresh();
        success(`Фото привязано: ${r.linked}`);
      } else {
        const r = await actions.importExcel(file, { module: module || undefined, mode });
        setResult(r);
        await actions.refresh();
        success(`Импортировано: ${r.imported} поз.`);
      }
    } catch (e) {
      error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card" style={{ padding: 22 }}>
      <div className="field">
        <label>Файл Excel (.xlsx, .xls)</label>
        <input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      </div>
      <div className="field">
        <label>Модуль (для фото — лучше выбрать вручную или оставить авто)</label>
        <select value={module} onChange={(e) => setModule(e.target.value)}>
          {MODULE_PRESETS.map((m) => (
            <option key={m.value || "auto"} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <label className="row" style={{ fontSize: 13, marginBottom: 12, cursor: "pointer" }}>
        <input type="checkbox" checked={photosOnly} onChange={(e) => setPhotosOnly(e.target.checked)} />
        Только подставить фото к существующим материалам (без импорта строк)
      </label>

      {!photosOnly && (
        <div className="field">
          <label>Режим</label>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="merge">Добавить / обновить</option>
            <option value="replace">Заменить всю базу</option>
          </select>
        </div>
      )}

      <p className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
        Режим «только фото»: модуль определяется по имени файла или выберите вручную. Картинки берутся из колонки «Фото» в Excel.
      </p>

      <button className="btn btn-primary" disabled={!file || loading} onClick={run}>
        {loading ? "Импорт…" : photosOnly ? "Подставить фото" : "Импортировать"}
      </button>

      {result && (
        <div className="panel" style={{ marginTop: 16, padding: 14 }}>
          {photosOnly ? (
            <>
              <strong>Фото привязано:</strong> {result.photosLinked} из {result.imagesFound} в файле
              {result.unmatched?.length > 0 && (
                <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  Не сопоставлено: {result.unmatched.length}
                </p>
              )}
            </>
          ) : (
            <>
              <strong>Импортировано:</strong> {result.imported} поз.
              {result.photosLinked > 0 && (
                <span>
                  {" "}
                  · <strong>Фото:</strong> {result.photosLinked}
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
