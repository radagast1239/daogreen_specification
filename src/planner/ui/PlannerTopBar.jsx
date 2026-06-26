import React, { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { PDF_MODES } from "../exportPdf.js";

export function PlannerTopBar({
  projectName,
  saved,
  busy,
  onPdf,
  onSync,
  projectId,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);

  return (
    <header className="planner-topbar no-print">
      <div className="planner-topbar__brand">
        <span className="planner-topbar__logo">Daogreen Planner</span>
        <span className="planner-topbar__project">
          Проект: <b>{projectName}</b>
        </span>
      </div>
      <div className="planner-topbar__actions">
        <span className={"planner-status" + (saved ? " planner-status--ok" : "")}>
          {saved ? "Сохранено" : "Сохранение…"}
        </span>
        <div className="planner-pdf-menu" ref={ref}>
          <button
            type="button"
            className="planner-btn"
            onClick={() => setOpen((o) => !o)}
            disabled={busy}
          >
            PDF ▾
          </button>
          {open && (
            <div className="planner-pdf-menu__pop">
              {Object.entries(PDF_MODES).map(([id, m]) => (
                <button
                  key={id}
                  type="button"
                  className="planner-pdf-menu__item"
                  onClick={() => { setOpen(false); onPdf(id); }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="planner-btn planner-btn--primary" onClick={onSync} disabled={busy}>
          В спецификацию
        </button>
        <Link className="planner-btn" to={`/project/${projectId}`}>
          К проекту
        </Link>
      </div>
    </header>
  );
}
