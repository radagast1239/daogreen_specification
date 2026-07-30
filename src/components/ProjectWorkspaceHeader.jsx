import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ProjectWorkspaceTabs from "./ProjectWorkspaceTabs.jsx";
import "../styles/project-workspace.css";

export default function ProjectWorkspaceHeader({
  project,
  breadcrumbs,
  workspaceView,
  onWorkspaceViewChange,
  statusLabel,
  workingTotal,
  publishedTotal,
  readinessLabel,
  formatMoney,
  publishActions = {},
}) {
  const sentinelRef = useRef(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return undefined;

    let compactNow = false;
    const apply = (next) => {
      if (next === compactNow) return;
      compactNow = next;
      setCompact(next);
    };

    // Collapse as soon as the sentinel leaves the top of the viewport.
    const collapseObserver = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) apply(true);
      },
      { threshold: 0, rootMargin: "0px" },
    );

    // Expand only after scrolling back far enough that the sentinel sits well
    // below the top. Without this gap, shrinking the sticky header brings the
    // sentinel back into view and the compact state flickers (~3 Hz).
    const expandObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) apply(false);
      },
      { threshold: 0, rootMargin: "-96px 0px 0px 0px" },
    );

    collapseObserver.observe(node);
    expandObserver.observe(node);
    return () => {
      collapseObserver.disconnect();
      expandObserver.disconnect();
    };
  }, []);

  const hasPublishedTotal = Number.isFinite(Number(publishedTotal));
  const hasWorkingTotal = Number.isFinite(Number(workingTotal));
  const showPublishActions = workspaceView === "publish";

  return (
    <>
      <div ref={sentinelRef} className="pw-header-sentinel" aria-hidden="true" />
      <header className={`pw-header${compact ? " is-compact" : ""}`} data-workspace-sticky="true">
        <div className="pw-header__identity">
          <div className="pw-header__full-meta">
            <Link to="/" className="back-link">← Проекты</Link>
            {breadcrumbs}
          </div>
          <div className="pw-header__title-row">
            <h1>{project?.name || "Проект"}</h1>
            {statusLabel && <span className="chip chip--neutral pw-header__status">{statusLabel}</span>}
            {project?.hasUnpublishedChanges && (
              <span className="chip chip--amber pw-header__changes">Есть неопубликованные изменения</span>
            )}
          </div>
          <p className="pw-header__details muted">
            {[project?.client, project?.city, project?.type].filter(Boolean).join(" · ")}
            {project?.publishedRelease?.versionNumber
              ? ` · опубликована v${project.publishedRelease.versionNumber}`
              : ""}
          </p>
          <div className="pw-header__summary" aria-label="Краткая сводка проекта">
            {hasWorkingTotal && <span>Рабочая сумма: <b>{formatMoney(workingTotal)}</b></span>}
            {hasPublishedTotal && <span>Опубликовано: <b>{formatMoney(publishedTotal)}</b></span>}
            {readinessLabel && <span>Готовность: <b>{readinessLabel}</b></span>}
          </div>
        </div>

        <div className="pw-header__nav-row">
          <ProjectWorkspaceTabs value={workspaceView} onChange={onWorkspaceViewChange} />
          {showPublishActions && (
            <div className="pw-header__actions no-print" aria-label="Действия клиентской выдачи">
              <button type="button" className="btn btn-sm btn-primary" disabled={!publishActions.clientUrl} onClick={publishActions.onOpenClientLink}>Клиентская ссылка</button>
              <button type="button" className="btn btn-sm" disabled={!publishActions.clientUrl} onClick={publishActions.onCopyClientLink}>Скопировать ссылку</button>
              <button type="button" className="btn btn-sm" onClick={publishActions.onExportPdf}>PDF</button>
              <button type="button" className="btn btn-sm" onClick={publishActions.onExportExcel}>Excel</button>
              <button type="button" className="btn btn-sm" onClick={publishActions.onPublish}>Опубликовать версию</button>
            </div>
          )}
        </div>
      </header>
    </>
  );
}
