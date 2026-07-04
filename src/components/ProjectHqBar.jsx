import React, { useMemo } from "react";
import { buildHqMetrics } from "../lib/projectHqStats.js";

function toneClass(tone) {
  if (tone === "ok") return "project-hq__kpi--ok";
  if (tone === "warn") return "project-hq__kpi--warn";
  if (tone === "bad") return "project-hq__kpi--bad";
  return "project-hq__kpi--neutral";
}

function Kpi({ title, value, sub, tone = "neutral" }) {
  return (
    <div className={`project-hq__kpi card ${toneClass(tone)}`}>
      <div className="project-hq__kpi-value num">{value}</div>
      <div className="project-hq__kpi-title">{title}</div>
      {sub ? (
        <div className="project-hq__kpi-sub muted">{sub}</div>
      ) : null}
    </div>
  );
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
  onPrepareClient,
  pdfDisabled = false,
  excelDisabled = false,
}) {
  const metrics = useMemo(
    () => buildHqMetrics({ project, items, publishCheck }),
    [project, items, publishCheck]
  );

  const publishTone =
    metrics.publishStatus === "ok"
      ? "ok"
      : metrics.publishStatus === "warnings"
        ? "warn"
        : "bad";

  const coolingTone =
    metrics.coolingSummary.status === "ok"
      ? "ok"
      : metrics.coolingSummary.status === "warning"
        ? "warn"
        : "bad";

  const linkTone =
    metrics.linkStatus.status === "active"
      ? "ok"
      : metrics.linkStatus.status === "expired"
        ? "bad"
        : "neutral";

  const readinessTone =
    metrics.readinessPercent >= 90 ? "ok" : metrics.readinessPercent >= 70 ? "warn" : "bad";

  const handlePublishCheck = () => {
    if (onOpenPrePublish) {
      if (onRefreshPublishCheck) onRefreshPublishCheck().then(() => onOpenPrePublish());
      else onOpenPrePublish();
      return;
    }
    onRefreshPublishCheck?.();
  };

  return (
    <section className="project-hq card no-print" aria-label="Штаб проекта">
      <div className="project-hq__head between wrap" style={{ gap: 10 }}>
        <div>
          <strong className="project-hq__title">Штаб проекта</strong>
          <p className="muted project-hq__subtitle">
            Центр управления клиентской выдачей
            {publishCheckLoading ? " · обновление…" : ""}
          </p>
        </div>
      </div>

      <div className="project-hq__grid">
        <Kpi
          title="клиентская выдача"
          value={publishCheckLoading && !publishCheck ? "…" : `${metrics.readinessPercent}%`}
          sub="готовность"
          tone={readinessTone}
        />
        <Kpi
          title="публикация"
          value={metrics.publishStatusLabel}
          sub={
            metrics.publishProblemsCount > 0
              ? `${metrics.criticalCount} крит. · ${metrics.warningsCount} предупр.`
              : "без замечаний"
          }
          tone={publishTone}
        />
        <Kpi
          title="охлаждение"
          value={metrics.coolingSummary.label}
          sub={
            metrics.coolingSummary.totalRooms > 0
              ? `${metrics.coolingSummary.roomsWithCooling}/${metrics.coolingSummary.totalRooms} комнат`
              : "нет комнат"
          }
          tone={coolingTone}
        />
        <Kpi
          title="замены"
          value={metrics.replacementsCount > 0 ? `${metrics.replacementsCount} на проверке` : "Нет"}
          sub="клиентские замены"
          tone={metrics.replacementsCount > 0 ? "warn" : "ok"}
        />
        <Kpi
          title="ссылка"
          value={metrics.linkStatus.label}
          sub={metrics.linkStatus.expiresAt ? `до ${new Date(metrics.linkStatus.expiresAt).toLocaleDateString("ru-RU")}` : "клиентский доступ"}
          tone={linkTone}
        />
        <Kpi title="версия" value={metrics.versionLabel} sub="опубликованный снимок" tone="neutral" />
        {metrics.purchaseProgress.show ? (
          <Kpi
            title="закупка"
            value={metrics.purchaseProgress.label}
            sub={`из ${metrics.purchaseProgress.total} поз.`}
            tone="neutral"
          />
        ) : (
          <Kpi title="закупка" value="Не начата" sub="клиент ещё не отмечал" tone="neutral" />
        )}
      </div>

      <div className="project-hq__actions row wrap">
        <button type="button" className="btn btn-sm btn-primary" onClick={handlePublishCheck}>
          Проверить публикацию
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!clientUrl}
          onClick={onOpenClientPreview}
        >
          Открыть как клиент
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!clientUrl}
          onClick={onCopyClientLink || onOpenClientLink}
        >
          Скопировать ссылку
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={pdfDisabled}
          title={pdfDisabled ? "Будет добавлено следующим шагом" : undefined}
          onClick={onExportPdf}
        >
          PDF
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={excelDisabled}
          title={excelDisabled ? "Будет добавлено следующим шагом" : undefined}
          onClick={onExportExcel}
        >
          Excel
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={onPrepareClient}
          title="Мастер подготовки клиентской выдачи будет добавлен следующим шагом"
        >
          Подготовить клиенту
        </button>
      </div>
    </section>
  );
}
