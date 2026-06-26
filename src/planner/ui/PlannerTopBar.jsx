import React from "react";
import { Link } from "react-router-dom";

export function PlannerTopBar({
  projectName,
  saved,
  busy,
  onPdf,
  onSync,
  projectId,
}) {
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
        <button type="button" className="planner-btn planner-btn--ghost" disabled title="Скоро">
          Отменить
        </button>
        <button type="button" className="planner-btn planner-btn--ghost" disabled title="Скоро">
          Повторить
        </button>
        <button type="button" className="planner-btn" onClick={onPdf} disabled={busy}>
          PDF
        </button>
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
