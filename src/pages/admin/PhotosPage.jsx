import React, { useState } from "react";
import { useStore } from "../../store/StoreContext.jsx";
import { api } from "../../lib/api.js";
import { PageHeader } from "../../components/Layout.jsx";

export default function PhotosPage() {
  const { state, actions } = useStore();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const withPhoto = state.materials.filter((m) => m.imageUrl || m.photoUrl).length;
  const stellage = state.materials.filter((m) => m.module?.startsWith("Стеллаж"));

  const upload = async () => {
    if (!files.length) return;
    setLoading(true);
    setErr("");
    setResult(null);
    try {
      const data = await api.bulkPhotos(files);
      setResult(data);
      await actions.refresh();
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
      await actions.refresh();
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
        sub={`${withPhoto} из ${state.materials.length} с фото · стеллажи: ${stellage.length} поз.`}
      />
      <div className="content" style={{ maxWidth: 720 }}>
        <div className="card" style={{ padding: 22 }}>
          <h3 style={{ margin: "0 0 12px" }}>Как называть файлы</h3>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
            Имя файла = <code>m001.jpg</code> (ID материала из базы) или транслит названия детали.
            Поддерживаются jpg, png, webp.
          </p>
          <p className="muted" style={{ fontSize: 13 }}>
            Положите файлы в папку <code>daogreen-spec/materials-photos/</code> и нажмите «Сканировать папку» —
            при старте API они тоже подхватываются автоматически.
          </p>
        </div>

        <div className="card" style={{ padding: 22, marginTop: 16 }}>
          <h3 style={{ margin: "0 0 12px" }}>Загрузить с компьютера</h3>
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
            <button className="btn" disabled={loading} onClick={importFolder}>
              Сканировать папку materials-photos/
            </button>
          </div>
        </div>

        {err && <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 12 }}>{err}</p>}

        {result && (
          <div className="card" style={{ padding: 22, marginTop: 16 }}>
            <h3 style={{ margin: "0 0 8px" }}>Результат</h3>
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
    </>
  );
}
