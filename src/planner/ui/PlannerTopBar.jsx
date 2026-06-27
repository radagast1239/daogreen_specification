import React, { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { PDF_MODES } from "../exportPdf.js";

export function PlannerTopBar({
  mode = "project",
  title,
  saved,
  busy,
  onPdf,
  onSync,
  onExportJson,
  onImportJson,
  onRename,
  projectId,
}) {
  const [open, setOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const ref = useRef(null);
  const pdfRef = useRef(null);
  const importRef = useRef(null);
  const standalone = mode === "standalone";

  useEffect(() => {
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
      if (pdfRef.current && !pdfRef.current.contains(e.target)) setPdfOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);

  const handleRename = () => {
    const name = prompt("Название плана:", title || "Новый план");
    if (name != null && onRename) onRename(name);
  };

  return (
    <header className="planner-topbar no-print">
      <div className="planner-topbar__brand">
        <span className="planner-topbar__logo">Daogreen Planner</span>
        <span className="planner-topbar__project">
          {standalone ? (
            <>Черновик: <b>{title}</b></>
          ) : (
            <>Проект: <b>{title}</b></>
          )}
        </span>
      </div>
      <div className="planner-topbar__actions">
        <span className={"planner-status" + (saved ? " planner-status--ok" : "")}>
          {saved ? "Сохранено" : "Сохранение…"}
        </span>
        {standalone && (
          <>
            <button type="button" className="planner-btn planner-btn--ghost" onClick={handleRename} disabled={busy}>
              Переименовать
            </button>
            <button type="button" className="planner-btn" onClick={onExportJson} disabled={busy}>
              Скачать .json
            </button>
            <button type="button" className="planner-btn" onClick={() => importRef.current?.click()} disabled={busy}>
              Импорт
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".json,.daogreen-plan.json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f && onImportJson) onImportJson(f);
              }}
            />
          </>
        )}
        <div className="planner-pdf-menu" ref={pdfRef}>
          <button
            type="button"
            className="planner-btn"
            onClick={() => setPdfOpen((o) => !o)}
            disabled={busy}
          >
            PDF ▾
          </button>
          {pdfOpen && (
            <div className="planner-pdf-menu__pop">
              {Object.entries(PDF_MODES).map(([id, m]) => (
                <button
                  key={id}
                  type="button"
                  className="planner-pdf-menu__item"
                  onClick={() => { setPdfOpen(false); onPdf(id); }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {!standalone && (
          <button type="button" className="planner-btn planner-btn--primary" onClick={onSync} disabled={busy}>
            В спецификацию
          </button>
        )}
        {standalone ? (
          <Link className="planner-btn" to="/planner">
            К черновикам
          </Link>
        ) : (
          <Link className="planner-btn" to={`/project/${projectId}`}>
            К проекту
          </Link>
        )}
      </div>
    </header>
  );
}
