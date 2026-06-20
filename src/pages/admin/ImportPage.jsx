import React, { useState } from "react";
import { useStore } from "../../store/StoreContext.jsx";
import { PageHeader } from "../../components/Layout.jsx";

export default function ImportPage() {
  const { actions } = useStore();
  const [file, setFile] = useState(null);
  const [module, setModule] = useState("");
  const [mode, setMode] = useState("merge");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const run = async () => {
    if (!file) return;
    setLoading(true);
    setErr("");
    try {
      const r = await actions.importExcel(file, { module: module || undefined, mode });
      setResult(r);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PageHeader title="Импорт Excel" sub="Загрузка спецификаций в базу материалов (твой формат: наименование / ед. / кол-во / цена / ссылка)" />
      <div className="content" style={{ maxWidth: 640 }}>
        <div className="card" style={{ padding: 22 }}>
          <div className="field">
            <label>Файл Excel (.xlsx, .xls)</label>
            <input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
          <div className="field">
            <label>Модуль (если пусто — имя листа)</label>
            <input value={module} onChange={(e) => setModule(e.target.value)} placeholder="Стеллаж проточка" />
          </div>
          <div className="field">
            <label>Режим</label>
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="merge">Добавить / обновить</option>
              <option value="replace">Заменить всю базу</option>
            </select>
          </div>
          {err && <p style={{ color: "var(--danger)" }}>{err}</p>}
          <button className="btn btn-primary" disabled={!file || loading} onClick={run}>
            {loading ? "Импорт…" : "Импортировать"}
          </button>
          {result && (
            <div className="panel" style={{ marginTop: 16, padding: 14 }}>
              <strong>Готово:</strong> {result.imported} позиций
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
