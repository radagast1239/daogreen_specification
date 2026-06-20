import React, { useState } from "react";
import { useStore } from "../../store/StoreContext.jsx";
import { api } from "../../lib/api.js";
import { PageHeader } from "../../components/Layout.jsx";

export default function ImportPage() {
  const { actions } = useStore();
  const [file, setFile] = useState(null);
  const [module, setModule] = useState("");
  const [mode, setMode] = useState("merge");
  const [photosOnly, setPhotosOnly] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const run = async () => {
    if (!file) return;
    setLoading(true);
    setErr("");
    setResult(null);
    try {
      if (photosOnly) {
        const r = await api.importExcelPhotos(file, { module: module || undefined });
        setResult({ photosLinked: r.linked, imagesFound: r.imagesFound, unmatched: r.unmatched });
        await actions.refresh();
      } else {
        const r = await actions.importExcel(file, { module: module || undefined, mode });
        setResult(r);
        await actions.refresh();
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Импорт Excel"
        sub="Загрузка справочника и извлечение фото из ячеек таблицы в материалы"
      />
      <div className="content">
        <div className="card" style={{ padding: 22 }}>
          <div className="field">
            <label>Файл Excel (.xlsx, .xls)</label>
            <input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
          <div className="field">
            <label>Модуль (если пусто — имя листа)</label>
            <input value={module} onChange={(e) => setModule(e.target.value)} placeholder="Стеллаж проточка" />
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
            При полном импорте картинки из Excel (колонка с фото) автоматически привязываются к строкам по листу и номеру строки.
            Количество из Excel в базу не попадает — только название, цена, ссылка.
          </p>

          {err && <p style={{ color: "var(--danger)" }}>{err}</p>}
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
                      Не сопоставлено: {result.unmatched.length} (проверьте названия и модуль)
                    </p>
                  )}
                </>
              ) : (
                <>
                  <strong>Импортировано:</strong> {result.imported} поз.
                  {result.photosLinked > 0 && (
                    <span> · <strong>Фото:</strong> {result.photosLinked}</span>
                  )}
                </>
              )}
              {result.errors?.length > 0 && (
                <ul style={{ marginTop: 8, fontSize: 13 }}>
                  {result.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
