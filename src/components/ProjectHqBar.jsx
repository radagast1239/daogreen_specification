import React, { useMemo, useState } from "react";
import { money } from "../store/helpers.js";
import { buildHqMetrics } from "../lib/projectHqStats.js";
import {
  buildProjectDashboardSummary,
  shortPublishHeadline,
} from "../../shared/projectDashboardSummary.js";
import { buildClientPurchaseSummary } from "../../shared/clientPurchaseSummary.js";
import {
  PROJECT_HEADER_MORE_ACTIONS,
  PROJECT_HEADER_PRIMARY_ACTIONS,
} from "../../shared/projectWorkspaceUi.js";

function formatUpdatedAt(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export default function ProjectHqBar({
  project,
  items,
  publishCheck,
  publishCheckLoading,
  clientUrl,
  onRefreshPublishCheck,
  onOpenPrePublish,
  onOpenClientLink,
  onOpenClientPreview,
  onCopyClientLink,
  onExportPdf,
  onExportExcel,
  onFilterSelect,
  onOpenPlan,
  onImportFromPast,
  onCompare,
  onDuplicate,
  onApproveAll,
  onResetLink,
  onInternalExcel,
  pdfDisabled = false,
  excelDisabled = false,
}) {
  const [moreOpen, setMoreOpen] = useState(false);

  const metrics = useMemo(
    () => buildHqMetrics({ project, items, publishCheck }),
    [project, items, publishCheck]
  );

  const summary = useMemo(
    () => buildProjectDashboardSummary(items, { publishCheck }),
    [items, publishCheck]
  );

  const purchaseSummary = useMemo(
    () => buildClientPurchaseSummary(items),
    [items]
  );

  const preSendTone =
    summary.readiness.status === "ok"
      ? "ok"
      : summary.readiness.status === "warnings"
        ? "warn"
        : "bad";

  const headBadge = shortPublishHeadline(summary.readiness.status, {
    blockers: summary.readiness.blockers,
    warnings: summary.readiness.warnings,
  });

  const purchase = metrics.purchaseProgress;
  const purchaseValue = purchase?.show
    ? purchase.headline
    : "Не начата";
  const purchaseDetail = purchase?.show ? purchase.detail : "клиент ещё не отмечал";

  const handlePublishCheck = () => {
    if (onOpenPrePublish) {
      if (onRefreshPublishCheck) onRefreshPublishCheck().then(() => onOpenPrePublish());
      else onOpenPrePublish();
      return;
    }
    onRefreshPublishCheck?.();
  };

  const moreHandlers = {
    plan: onOpenPlan,
    import: onImportFromPast,
    compare: onCompare,
    readiness: handlePublishCheck,
    problems: () => onFilterSelect?.("problems"),
    duplicate: onDuplicate,
    approve_all: onApproveAll,
    qr_link: onOpenClientLink,
    reset_link: onResetLink,
    internal_excel: onInternalExcel,
  };

  return (
    <section className="project-hq project-hq--compact card no-print" aria-label="Проект">
      <div className="project-hq__compact-row">
        <div className="project-hq__compact-meta">
          <div className="project-hq__compact-title-row">
            <strong className="project-hq__title">{project?.name || "Проект"}</strong>
            <span className={`chip chip--${preSendTone === "ok" ? "ok" : preSendTone === "warn" ? "amber" : "danger"}`}>
              {headBadge}
            </span>
            {publishCheckLoading ? <span className="muted" style={{ fontSize: 11 }}>обновление…</span> : null}
          </div>
          <div className="project-hq__compact-facts muted">
            <span>Клиент: <b>{project?.client || "—"}</b></span>
            <span>Тип: <b>{project?.type || "—"}</b></span>
            <span>Статус: <b>{headBadge}</b></span>
            <span>Версия: <b>{metrics.versionLabel}</b></span>
            <span>
              Итог закупки:{" "}
              <b className="num">
                {money(purchaseSummary.purchaseTotal || 0, project?.currency || "₽")}
              </b>
            </span>
            <span>
              Прогресс закупки: <b>{purchaseValue}</b>
              {purchaseDetail ? <span className="project-hq__compact-sub"> · {purchaseDetail}</span> : null}
            </span>
            <span>Обновлено: <b>{formatUpdatedAt(project?.updatedAt || project?.updated_at)}</b></span>
          </div>
        </div>

        <div className="project-hq__compact-actions">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!clientUrl}
            onClick={onOpenClientPreview}
          >
            {PROJECT_HEADER_PRIMARY_ACTIONS[0].label}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!clientUrl}
            onClick={onCopyClientLink || onOpenClientLink}
          >
            {PROJECT_HEADER_PRIMARY_ACTIONS[1].label}
          </button>
          <button type="button" className="btn btn-sm" disabled={pdfDisabled} onClick={onExportPdf}>
            {PROJECT_HEADER_PRIMARY_ACTIONS[2].label}
          </button>
          <button type="button" className="btn btn-sm" disabled={excelDisabled} onClick={onExportExcel}>
            {PROJECT_HEADER_PRIMARY_ACTIONS[3].label}
          </button>
          <details
            className="project-hq__more"
            open={moreOpen}
            onToggle={(e) => setMoreOpen(e.target.open)}
          >
            <summary className="btn btn-sm btn-ghost">Ещё ▾</summary>
            <div className="project-hq__more-menu card">
              {PROJECT_HEADER_MORE_ACTIONS.map((action) => {
                const handler = moreHandlers[action.key];
                return (
                  <button
                    key={action.key}
                    type="button"
                    className="btn btn-sm btn-ghost project-hq__more-item"
                    disabled={!handler || (action.key === "qr_link" && !clientUrl)}
                    onClick={() => {
                      setMoreOpen(false);
                      handler?.();
                    }}
                  >
                    {action.label}
                  </button>
                );
              })}
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}
