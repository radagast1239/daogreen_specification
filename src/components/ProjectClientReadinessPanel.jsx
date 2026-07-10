import React, { useMemo, useState } from "react";
import { money, formatQty } from "../store/helpers.js";
import {
  buildClientPurchaseSummary,
  buildClientDeliveryPreviewRows,
} from "../../shared/clientPurchaseSummary.js";
import {
  buildProjectPreSendChecklist,
  selectAllPreSendProblemIds,
  selectPreSendGroupIds,
} from "../../shared/projectPreSendChecklist.js";
import { resolveDashboardFilterLabel, metricTone } from "../../shared/projectDashboardSummary.js";
import { CLIENT_PRICE_MISSING, CLIENT_PRICE_TBD } from "../../shared/clientPurchaseRows.js";
import {
  CLIENT_READINESS_DEFAULT_TAB,
  CLIENT_READINESS_TABS,
  MASS_SELECT_ACTIONS,
  buildClientReadinessSummaryMetrics,
  shouldShowSelectedActionBar,
} from "../../shared/projectWorkspaceUi.js";
import ProjectSelectedActionBar from "./ProjectSelectedActionBar.jsx";

const PREVIEW_LIMIT = 20;

function MetricChip({ label, value, tone = "neutral", filter, activeFilter, onFilterSelect, sub, kind, currency = "₽" }) {
  const clickable =
    !!filter &&
    !!onFilterSelect &&
    (filter === "" ? !!activeFilter : value > 0 || activeFilter === filter);
  const active = filter ? activeFilter === filter : !activeFilter;
  const display =
    kind === "money"
      ? money(value, currency)
      : kind === "text"
        ? value
        : value;

  return (
    <button
      type="button"
      className={`client-readiness__metric client-readiness__metric--${tone}${active ? " client-readiness__metric--active" : ""}`}
      disabled={!clickable}
      onClick={() => clickable && onFilterSelect(filter)}
      title={clickable ? "Показать в таблице" : undefined}
    >
      <span className={`client-readiness__metric-value${kind === "text" ? "" : " num"}`}>{display}</span>
      <span className="client-readiness__metric-label">{label}</span>
      {sub ? <span className="client-readiness__metric-sub muted">{sub}</span> : null}
    </button>
  );
}

function formatPreviewTotal(total, currency) {
  if (total === CLIENT_PRICE_TBD || total === CLIENT_PRICE_MISSING) return total;
  if (total === "" || total == null) return "—";
  if (typeof total === "number") return money(total, currency);
  return String(total);
}

export default function ProjectClientReadinessPanel({
  items = [],
  materials = [],
  currency = "₽",
  publishCheck,
  activeFilter = "",
  onFilterSelect,
  selectedItemIds = [],
  onSelectItems,
  onBulkShowClient,
  onBulkHideClient,
  onBulkRefreshPrice,
  onClearSelection,
}) {
  const [tab, setTab] = useState(CLIENT_READINESS_DEFAULT_TAB);
  const [showAllPreview, setShowAllPreview] = useState(false);
  const [massMenuOpen, setMassMenuOpen] = useState(false);

  const clientSummary = useMemo(
    () => buildClientPurchaseSummary(items, materials),
    [items, materials]
  );

  const checklist = useMemo(
    () => buildProjectPreSendChecklist(items, materials, { publishCheck }),
    [items, materials, publishCheck]
  );

  const { metrics, noLinkInfo } = useMemo(
    () => buildClientReadinessSummaryMetrics(checklist, clientSummary),
    [checklist, clientSummary]
  );

  const previewRows = useMemo(
    () => buildClientDeliveryPreviewRows(items, materials),
    [items, materials]
  );

  const visiblePreview = showAllPreview ? previewRows : previewRows.slice(0, PREVIEW_LIMIT);
  const problemGroups = checklist.groups.filter(
    (g) => g.severity === "blocker" || g.severity === "warning"
  );

  const handleSelectGroup = (groupKey) => {
    if (groupKey === "all_problems") {
      onSelectItems?.(selectAllPreSendProblemIds(checklist));
      return;
    }
    onSelectItems?.(selectPreSendGroupIds(checklist, groupKey));
  };

  const groupCount = (key) => checklist.groups.find((g) => g.key === key)?.count || 0;

  return (
    <section className="client-readiness card no-print" aria-label="Перед отправкой клиенту">
      <div className="client-readiness__head between wrap" style={{ gap: 10 }}>
        <div>
          <strong className="client-readiness__title">Перед отправкой клиенту</strong>
          <p className="muted client-readiness__subtitle">
            Сводка выдачи и проверка перед PDF, Excel и клиентской ссылкой
          </p>
        </div>
        <div className={`client-readiness__status client-readiness__status--${checklist.tone}`}>
          <strong>{checklist.statusTitle}</strong>
          {checklist.statusDetail ? (
            <span className="muted" style={{ fontSize: 12 }}>{checklist.statusDetail}</span>
          ) : null}
        </div>
      </div>

      <div className="client-readiness__metrics">
        {metrics.map((m) => (
          <MetricChip
            key={m.key}
            {...m}
            currency={currency}
            tone={
              m.key === "send_status"
                ? checklist.tone
                : m.tone === "warn"
                  ? metricTone(m.value)
                  : m.tone === "bad"
                    ? metricTone(m.value, { badFrom: 1 })
                    : m.tone
            }
            activeFilter={activeFilter}
            onFilterSelect={onFilterSelect}
          />
        ))}
      </div>

      {noLinkInfo.count > 0 ? (
        <div className="client-readiness__info">
          <button
            type="button"
            className="client-readiness__info-btn"
            onClick={() => onFilterSelect?.(noLinkInfo.filter)}
          >
            {noLinkInfo.text}
          </button>
        </div>
      ) : null}

      {activeFilter ? (
        <div className="spec-active-filter" style={{ marginTop: 10 }}>
          <span className="chip chip--brand spec-active-filter__chip">
            Показаны: <strong>{resolveDashboardFilterLabel(activeFilter)}</strong>
          </span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onFilterSelect?.("")}>
            Сбросить фильтр
          </button>
        </div>
      ) : null}

      <div className="client-readiness__tabs" role="tablist">
        {CLIENT_READINESS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`btn btn-sm${tab === t.id ? " btn-primary" : " btn-ghost"}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="client-readiness__panel muted" style={{ fontSize: 13, marginTop: 10 }}>
          Клиенту: <b className="num">{checklist.clientTotalCount}</b>
          {" · "}
          готово без проблем: <b className="num">{checklist.readyWithoutIssuesCount}</b>
          {" · "}
          блокеры: <b className="num">{checklist.blockers}</b>
          {" · "}
          предупреждения: <b className="num">{checklist.warnings}</b>
        </div>
      ) : null}

      {tab === "problems" ? (
        <div className="client-readiness__problems" style={{ marginTop: 10 }}>
          {!problemGroups.some((g) => g.count > 0) ? (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>Реальных проблем нет.</p>
          ) : (
            <ul className="client-readiness__problem-list">
              {problemGroups.filter((g) => g.count > 0).map((g) => (
                <li key={g.key}>
                  <button
                    type="button"
                    className={`client-readiness__problem-btn client-readiness__problem-btn--${g.severity}`}
                    onClick={() => g.filterKey && onFilterSelect?.(g.filterKey)}
                  >
                    {g.label}: <strong className="num">{g.count}</strong>
                    {g.actionHint ? <span className="muted"> — {g.actionHint}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {tab === "mass" ? (
        <div className="client-readiness__mass" style={{ marginTop: 10 }}>
          {!shouldShowSelectedActionBar(selectedItemIds.length) ? (
            <div className="row wrap" style={{ gap: 8 }}>
              <details
                open={massMenuOpen}
                onToggle={(e) => setMassMenuOpen(e.target.open)}
              >
                <summary className="btn btn-sm">Массовый выбор ▾</summary>
                <div className="client-readiness__mass-menu card">
                  {MASS_SELECT_ACTIONS.map((action) => {
                    const disabled =
                      action.key === "all_problems"
                        ? !checklist.allProblemIds.length
                        : !groupCount(action.key);
                    return (
                      <button
                        key={action.key}
                        type="button"
                        className="btn btn-sm btn-ghost"
                        disabled={disabled}
                        onClick={() => {
                          setMassMenuOpen(false);
                          handleSelectGroup(action.key);
                        }}
                      >
                        {action.label}
                      </button>
                    );
                  })}
                </div>
              </details>
              {activeFilter ? (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => onFilterSelect?.("")}>
                  Сбросить фильтр
                </button>
              ) : null}
            </div>
          ) : (
            <ProjectSelectedActionBar
              selectedCount={selectedItemIds.length}
              onShowClient={onBulkShowClient}
              onHideClient={onBulkHideClient}
              onRefreshPrices={onBulkRefreshPrice}
              onClearSelection={onClearSelection}
            />
          )}
        </div>
      ) : null}

      {tab === "preview" ? (
        <div className="client-readiness__preview" style={{ marginTop: 10 }}>
          <div className="between wrap" style={{ gap: 8, marginBottom: 8 }}>
            <strong>Что увидит клиент</strong>
            <span className="muted" style={{ fontSize: 12 }}>
              {showAllPreview
                ? `${previewRows.length} строк`
                : `Показано ${Math.min(PREVIEW_LIMIT, previewRows.length)} из ${previewRows.length}`}
            </span>
          </div>
          <div className="client-delivery__table-wrap card" style={{ padding: 0, overflowX: "auto" }}>
            <table className="client-delivery__table">
              <thead>
                <tr>
                  <th>Раздел</th>
                  <th>Подраздел</th>
                  <th>Наименование</th>
                  <th>Кол-во</th>
                  <th>Ед.</th>
                  <th>Цена</th>
                  <th>Сумма</th>
                  <th>Поставщик</th>
                  <th>Статус</th>
                  <th>Источник</th>
                </tr>
              </thead>
              <tbody>
                {visiblePreview.map((row) => (
                  <tr key={row.mergeKey}>
                    <td>{row.section}</td>
                    <td>{row.subsection}</td>
                    <td>
                      <div>{row.name}</div>
                      {row.note ? (
                        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{row.note}</div>
                      ) : null}
                    </td>
                    <td className="num">{formatQty(row.qty, row.unit)}</td>
                    <td>{row.unit}</td>
                    <td className="num">
                      {typeof row.priceLabel === "number" ? money(row.priceLabel, currency) : row.priceLabel}
                    </td>
                    <td className="num">{formatPreviewTotal(row.total, currency)}</td>
                    <td>{row.supplier}</td>
                    <td>{row.statusLabel}</td>
                    <td>{row.sourceLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {previewRows.length > PREVIEW_LIMIT ? (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              style={{ marginTop: 8 }}
              onClick={() => setShowAllPreview((v) => !v)}
            >
              {showAllPreview ? "Свернуть" : `Показать все (${previewRows.length})`}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
