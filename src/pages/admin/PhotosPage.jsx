import React, { useState } from "react";
import { useStore } from "../../store/StoreContext.jsx";
import { api } from "../../lib/api.js";
import { PageHeader } from "../../components/Layout.jsx";
import MaterialsSubnav from "../../components/MaterialsSubnav.jsx";
import {
  formatPhotoPageSubtitle,
  formatUnlinkedCardValue,
  materialPhotoCounts,
  resolveUnlinkedPhotoCount,
} from "../../lib/photoStatistics.js";

export default function PhotosPage() {
  const { state, actions } = useStore();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const { withPhoto, withoutPhoto } = materialPhotoCounts(state.materials);
  const unlinkedCount = resolveUnlinkedPhotoCount(result);
  const unlinkedCardValue = formatUnlinkedCardValue(unlinkedCount);

  const upload = async () => {
    if (!files.length) return;
    setLoading(true);
    setErr("");
    setResult(null);
    try {
      const data = await api.bulkPhotos(files);
      setResult(data);
      await actions.refreshMaterials();
      setFiles([]);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const importFolder = async () => {
    setLoading(true);
    setErr("");
    setResult(null);
    try {
      const data = await api.importPhotosFolder();
      setResult(data);
      await actions.refreshMaterials();
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Фото материалов"
        sub={formatPhotoPageSubtitle({ withPhoto, withoutPhoto, unlinkedCount })}
        back={{ to: "/materials", label: "Материалы" }}
      />
      <div className="content">
        <MaterialsSubnav />
        <div className="photos-page-layout">
          <div className="photos-stat-row">
            <div className="photos-stat">
              <div className="photos-stat__v num">{withPhoto}</div>
              <div className="photos-stat__k">С фото</div>
            </div>
            <div className="photos-stat">
              <div className="photos-stat__v num">{withoutPhoto}</div>
              <div className="photos-stat__k">Без фото</div>
            </div>
            <div className="photos-stat">
              <div className={`photos-stat__v${unlinkedCount == null ? "" : " num"}`}>{unlinkedCardValue}</div>
              <div className="photos-stat__k">Не привязано</div>
            </div>
          </div>

          <div className="card photos-upload-card">
            <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Загрузить фото</h3>
            <p className="muted" style={{ fontSize: 13, margin: "0 0 12px", lineHeight: 1.45 }}>
              Назовите файл по ID материала или названию материала.
            </p>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
            {files.length > 0 && (
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                Выбрано файлов: {files.length}
              </p>
            )}
            <div className="row" style={{ marginTop: 14, gap: 8 }}>
              <button className="btn btn-primary" disabled={!files.length || loading} onClick={upload}>
                {loading ? "Загрузка…" : "Загрузить и привязать"}
              </button>
            </div>

            <details className="photos-naming-details">
              <summary>Как называть файлы</summary>
              <ul className="muted" style={{ fontSize: 12, margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.55 }}>
                <li>
                  <code>m001.jpg</code> — по ID материала
                </li>
                <li>название материала — по совпадению названия</li>
                <li>поддерживаются jpg, png, webp</li>
              </ul>
            </details>
          </div>

          <details className="card photos-tech-block">
            <summary>
              <strong>Технический импорт из папки</strong>
            </summary>
            <p className="muted" style={{ fontSize: 13, margin: "10px 0 12px", lineHeight: 1.45 }}>
              Используется для массовой загрузки файлов, заранее размещённых на сервере.
            </p>
            <button className="btn" disabled={loading} onClick={importFolder}>
              Сканировать папку materials-photos/
            </button>
            <details style={{ marginTop: 12 }}>
              <summary className="muted" style={{ fontSize: 12, cursor: "pointer" }}>
                Техническая инструкция
              </summary>
              <p className="muted" style={{ fontSize: 12, margin: "8px 0 0", lineHeight: 1.5 }}>
                Положите файлы в папку <code>materials-photos/</code> на сервере. При старте API они тоже
                могут подхватываться автоматически.
              </p>
            </details>
          </details>

          {err && <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 12 }}>{err}</p>}

          {result && (
            <div className="card" style={{ padding: 18, marginTop: 16 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Результат</h3>
              <p className="muted" style={{ fontSize: 13 }}>
                Привязано: <b>{result.matched?.length || 0}</b> из {result.total || 0}
              </p>
              {result.matched?.length > 0 && (
                <ul style={{ fontSize: 12, marginTop: 8, paddingLeft: 18 }}>
                  {result.matched.slice(0, 20).map((r) => (
                    <li key={r.materialId}>
                      {r.materialId} — {r.name}
                    </li>
                  ))}
                  {result.matched.length > 20 && (
                    <li className="muted">…и ещё {result.matched.length - 20}</li>
                  )}
                </ul>
              )}
              {result.unmatched?.length > 0 && (
                <>
                  <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
                    Не распознано ({result.unmatched.length}):
                  </p>
                  <p style={{ fontSize: 11, wordBreak: "break-all" }}>{result.unmatched.join(", ")}</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
