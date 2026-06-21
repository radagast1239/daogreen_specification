import React, { useMemo, useState } from "react";
import { useStore } from "../store/StoreContext.jsx";
import { api } from "../lib/api.js";
import { useToast } from "./Toast.jsx";

const MODES = [
  {
    id: "full",
    title: "Материалы + фото",
    desc: "Импорт строк из Excel. Картинки из колонки «Фото» подставятся автоматически.",
  },
  {
    id: "photos",
    title: "Только фото",
    desc: "Не меняет цены и названия — только привязывает картинки к уже существующим материалам.",
  },
];

function StatCard({ label, value, tone = "default" }) {
  return (
    <div className={`import-stat import-stat--${tone}`}>
      <div className="import-stat__v num">{value}</div>
      <div className="import-stat__k">{label}</div>
    </div>
  );
}

export default function ExcelImportPanel() {
  const { state, actions } = useStore();
  const { success, error } = useToast();
  const [mode, setMode] = useState("full");
  const [file, setFile] = useState(null);
  const [module, setModule] = useState("");
  const [mergeMode, setMergeMode] = useState("merge");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const modulePresets = useMemo(
    () => [
      { label: "— авто по имени файла —", value: "" },
      ...state.modules
        .filter((mod) => mod.active !== false)
        .map((mod) => ({ label: mod.name, value: mod.name })),
    ],
    [state.modules]
  );

  const run = async () => {
    if (!file) return;
    setLoading(true);
    setResult(null);
    try {
      if (mode === "photos") {
        const r = await api.importExcelPhotos(file, { module: module || undefined });
        setResult({ type: "photos", ...r });
        await actions.refresh();
        success(`Фото привязано: ${r.linked}`);
      } else {
        const r = await actions.importExcel(file, { module: module || undefined, mode: mergeMode });
        setResult({ type: "full", ...r });
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
    <div className="excel-import">
      <div className="import-mode-grid">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`import-mode-card${mode === m.id ? " import-mode-card--active" : ""}`}
            onClick={() => {
              setMode(m.id);
              setResult(null);
            }}
          >
            <strong>{m.title}</strong>
            <span className="muted">{m.desc}</span>
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <div className="import-steps">
          <div className="import-step">
            <span className="import-step__n">1</span>
            <div className="field" style={{ flex: 1, margin: 0 }}>
              <label>Файл Excel (.xlsx)</label>
              <input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              {file && (
                <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
                  Выбран: <strong>{file.name}</strong> ({Math.round(file.size / 1024)} КБ)
                </p>
              )}
            </div>
          </div>

          <div className="import-step">
            <span className="import-step__n">2</span>
            <div className="field" style={{ flex: 1, margin: 0 }}>
              <label>Модуль материалов</label>
              <select value={module} onChange={(e) => setModule(e.target.value)}>
                {modulePresets.map((m) => (
                  <option key={m.value || "auto"} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <p className="muted" style={{ fontSize: 11, margin: "6px 0 0" }}>
                Для фото: модуль можно определить по имени файла (проточка, подтопление…) или выбрать вручную.
              </p>
            </div>
          </div>

          {mode === "full" && (
            <div className="import-step">
              <span className="import-step__n">3</span>
              <div className="field" style={{ flex: 1, margin: 0 }}>
                <label>Если позиция уже есть в базе</label>
                <select value={mergeMode} onChange={(e) => setMergeMode(e.target.value)}>
                  <option value="merge">Обновить / добавить (безопасно)</option>
                  <option value="replace">Заменить всю базу (осторожно)</option>
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="import-hint panel" style={{ marginTop: 16, padding: 12 }}>
          <strong style={{ fontSize: 13 }}>Как устроен Excel</strong>
          <ul className="muted" style={{ fontSize: 12, margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.55 }}>
            <li>Колонка <strong>Фото</strong> — встроенные картинки в ячейках (не URL).</li>
            <li>Название материала должно совпадать с базой (режим «только фото»).</li>
            <li>Формат .xlsx надёжнее .xls для извлечения изображений.</li>
          </ul>
        </div>

        <button type="button" className="btn btn-primary" style={{ marginTop: 16 }} disabled={!file || loading} onClick={run}>
          {loading ? "Импорт…" : mode === "photos" ? "Подставить фото из Excel" : "Импортировать материалы"}
        </button>
      </div>

      {result && (
        <div className="card" style={{ padding: 20, marginTop: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 16 }}>Результат</h3>
          {result.type === "photos" ? (
            <>
              <div className="import-stat-grid">
                <StatCard label="Картинок в файле" value={result.imagesFound ?? 0} />
                <StatCard label="Привязано к материалам" value={result.linked ?? result.photosLinked ?? 0} tone="ok" />
                <StatCard label="Не сопоставлено" value={result.unmatched?.length ?? 0} tone={result.unmatched?.length ? "warn" : "default"} />
              </div>
              {result.unmatched?.length > 0 && (
                <details style={{ marginTop: 14 }}>
                  <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                    Список несопоставленных ({result.unmatched.length})
                  </summary>
                  <ul style={{ fontSize: 12, marginTop: 8, maxHeight: 200, overflow: "auto" }}>
                    {result.unmatched.slice(0, 50).map((row, i) => (
                      <li key={i}>
                        {typeof row === "string" ? row : `${row.name || "—"}${row.module ? ` · ${row.module}` : ""}`}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          ) : (
            <>
              <div className="import-stat-grid">
                <StatCard label="Импортировано поз." value={result.imported ?? 0} tone="ok" />
                <StatCard label="Фото из Excel" value={result.photosLinked ?? 0} />
              </div>
              {result.errors?.length > 0 && (
                <ul style={{ marginTop: 12, fontSize: 13, color: "var(--danger)" }}>
                  {result.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
