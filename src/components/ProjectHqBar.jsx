import React, { useMemo } from "react";
import { buildHqMetrics, coolingSubLabel } from "../lib/projectHqStats.js";
import {
  buildProjectDashboardSummary,
  metricTone,
  shortPublishHeadline,
} from "../../shared/projectDashboardSummary.js";

function toneClass(tone) {
  if (tone === "ok") return "project-hq__kpi--ok";
  if (tone === "warn") return "project-hq__kpi--warn";
  if (tone === "bad") return "project-hq__kpi--bad";
  return "project-hq__kpi--neutral";
}

function metricClass(tone) {
  if (tone === "ok") return "project-hq__metric--ok";
  if (tone === "warn") return "project-hq__metric--warn";
  if (tone === "bad") return "project-hq__metric--bad";
  return "project-hq__metric--neutral";
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

function MetricChip({ label, value, tone, filter, activeFilter, onFilterSelect }) {
  const canReset = filter === "" && !!activeFilter;
  const canFilter = !!filter && value > 0;
  const clickable = !!onFilterSelect && (canReset || canFilter);
  const active = filter ? activeFilter === filter : !activeFilter;
  return (
    <button
      type="button"
      className={`project-hq__metric ${metricClass(tone)}${active ? " project-hq__metric--active" : ""}`}
      disabled={!clickable}
      onClick={() => clickable && onFilterSelect(filter)}
      title={clickable ? "Показать в таблице" : undefined}
    >
      <span className="project-hq__metric-value num">{value}</span>
      <span className="project-hq__metric-label">{label}</span>
    </button>
  );
}

function PreSendItem({ msg, onFilterSelect }) {
  const clickable = !!msg.filter && !!onFilterSelect;
  return (
    <li>
      <button
        type="button"
        className={`project-hq__presend-item project-hq__presend-item--${msg.severity}${clickable ? " project-hq__presend-item--clickable" : ""}`}
        onClick={() => clickable && onFilterSelect(msg.filter)}
      >
        <span>{msg.text}</span>
        {clickable ? <span className="project-hq__presend-goto">Показать →</span> : null}
      </button>
    </li>
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
  onFilterSelect,
  activeFilter = "",
  pdfDisabled = false,
  excelDisabled = false,
}) {
  const metrics = useMemo(
    () => buildHqMetrics({ project, items, publishCheck }),
    [project, items, publishCheck]
  );

  const summary = useMemo(
    () => buildProjectDashboardSummary(items, { publishCheck }),
    [items, publishCheck]
  );

  const publishTone =
    metrics.publishStatus === "ok"
      ? "ok"
      : metrics.publishStatus === "warnings"
        ? "warn"
        : "bad";

  const coolingTone = metrics.coolingSummary.status === "ok" ? "ok" : "warn";

  const linkTone =
    metrics.linkStatus.status === "active"
      ? "ok"
      : metrics.linkStatus.status === "expired"
        ? "bad"
        : "neutral";

  const readinessTone =
    summary.readiness.score >= 90 ? "ok" : summary.readiness.score >= 70 ? "warn" : "bad";

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

  const handlePublishCheck = () => {
    if (onOpenPrePublish) {
      if (onRefreshPublishCheck) onRefreshPublishCheck().then(() => onOpenPrePublish());
      else onOpenPrePublish();
      return;
    }
    onRefreshPublishCheck?.();
  };

  const dashboardMetrics = [
    { label: "Всего", value: summary.totalItems, tone: "neutral", filter: "" },
    { label: "Клиенту", value: summary.clientVisibleItems, tone: "ok", filter: "client_visible" },
    { label: "Без цены", value: summary.noPrice, tone: metricTone(summary.noPrice), filter: "no_price" },
    { label: "Без фото", value: summary.noPhoto, tone: metricTone(summary.noPhoto), filter: "no_photo" },
    { label: "Без ссылки", value: summary.noLink, tone: metricTone(summary.noLink), filter: "no_link" },
    { label: "Без поставщика", value: summary.noSupplier, tone: metricTone(summary.noSupplier), filter: "no_supplier" },
    { label: "Нужна помощь", value: summary.needHelp, tone: metricTone(summary.needHelp), filter: "need_help" },
    {
      label: "Замена на проверке",
      value: summary.replacementCheck,
      tone: metricTone(summary.replacementCheck),
      filter: "replacement_check",
    },
    { label: "Не подходит", value: summary.notFit, tone: metricTone(summary.notFit, { badFrom: 1 }), filter: "not_fit" },
    { label: "Из схемы стеллажа", value: summary.bomItems, tone: "neutral", filter: "frame_bom" },
  ];

  return (
    <section className="project-hq card no-print" aria-label="Штаб проекта">
      <div className="project-hq__head between wrap" style={{ gap: 10 }}>
        <div>
          <strong className="project-hq__title">Штаб проекта</strong>
          <p className="muted project-hq__subtitle">
            Готовность к отправке клиенту
            {publishCheckLoading ? " · обновление…" : ""}
          </p>
        </div>
        <div className={`chip chip--${preSendTone === "ok" ? "ok" : preSendTone === "warn" ? "amber" : "danger"}`}>
          {headBadge}
        </div>
      </div>

      <div className="project-hq__section">
        <div className="project-hq__section-title">Готовность проекта</div>
        <div className="project-hq__metrics">
          {dashboardMetrics.map((m) => (
            <MetricChip
              key={m.label}
              label={m.label}
              value={m.value}
              tone={m.tone}
              filter={m.filter}
              activeFilter={activeFilter}
              onFilterSelect={onFilterSelect}
            />
          ))}
        </div>
      </div>

      <div className={`project-hq__presend project-hq__presend--${preSendTone}`}>
        <div className="project-hq__section-title">Перед отправкой клиенту</div>
        {summary.readiness.ready ? (
          <p className="project-hq__presend-ok muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
            Готово — можно отправить ссылку, PDF или Excel.
          </p>
        ) : (
          <ul className="project-hq__presend-list">
            {summary.preSendMessages.map((msg) => (
              <PreSendItem key={msg.key} msg={msg} onFilterSelect={onFilterSelect} />
            ))}
          </ul>
        )}
        {summary.readiness.blockers > 0 && (
          <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
            Блокеров: <span className="num">{summary.readiness.blockers}</span>
            {summary.readiness.warnings > 0 ? (
              <>
                {" "}
                · предупреждений: <span className="num">{summary.readiness.warnings}</span>
              </>
            ) : null}
          </p>
        )}
      </div>

      <div className="project-hq__grid">
        <Kpi
          title="готовность"
          value={publishCheckLoading && !publishCheck ? "…" : `${summary.readiness.score}%`}
          sub="клиентская выдача"
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
          sub={coolingSubLabel(metrics.coolingSummary)}
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
            title={metrics.purchaseProgress.title}
            value={metrics.purchaseProgress.headline}
            sub={metrics.purchaseProgress.detail}
            tone="neutral"
          />
        ) : (
          <Kpi title="закупка" value="Не начата" sub="клиент ещё не отмечал" tone="neutral" />
        )}
      </div>

      <div className="project-hq__actions row wrap">
        <button type="button" className="btn btn-sm btn-primary" onClick={handlePublishCheck}>
          Проверить готовность
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!clientUrl}
          onClick={onOpenClientPreview}
        >
          Открыть клиентскую ссылку
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
          onClick={onExportPdf}
        >
          Скачать PDF
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={excelDisabled}
          onClick={onExportExcel}
        >
          Скачать Excel
        </button>
        {summary.preSendMessages.length > 0 && onFilterSelect ? (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => onFilterSelect("problems")}
          >
            Показать проблемные позиции
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={onPrepareClient}
            title="Дополнительный мастер подготовки — позже"
          >
            Подготовить клиенту
          </button>
        )}
      </div>
    </section>
  );
}
