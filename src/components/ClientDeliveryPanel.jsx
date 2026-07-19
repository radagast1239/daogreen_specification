import React, { useMemo, useState } from "react";
import { money, formatQty } from "../store/helpers.js";
import {
  buildClientPurchaseSummary,
  buildClientDeliveryPreviewRows,
} from "../../shared/clientPurchaseSummary.js";
import {
  CLIENT_DELIVERY_FILTERS,
  resolveDashboardFilterLabel,
  metricTone,
} from "../../shared/projectDashboardSummary.js";
import { CLIENT_PRICE_MISSING, CLIENT_PRICE_TBD } from "../../shared/clientPurchaseRows.js";

const PREVIEW_LIMIT = 20;

function MetricCard({ label, value, tone = "neutral", filter, activeFilter, onFilterSelect, sub }) {
  const clickable = !!filter && !!onFilterSelect && (filter === "" ? !!activeFilter : value > 0 || activeFilter === filter);
  const active = filter ? activeFilter === filter : !activeFilter;
  return (
    <button
      type="button"
      className={`client-delivery__metric client-delivery__metric--${tone}${active ? " client-delivery__metric--active" : ""}`}
      disabled={!clickable}
      onClick={() => clickable && onFilterSelect(filter)}
      title={clickable ? "Показать в таблице" : undefined}
    >
      <span className="client-delivery__metric-value num">{value}</span>
      <span className="client-delivery__metric-label">{label}</span>
      {sub ? <span className="client-delivery__metric-sub muted">{sub}</span> : null}
    </button>
  );
}

function formatPreviewTotal(total, currency) {
  if (total === CLIENT_PRICE_TBD || total === CLIENT_PRICE_MISSING) return total;
  if (total === "" || total == null) return "—";
  if (typeof total === "number") return money(total, currency);
  return String(total);
}

export default function ClientDeliveryPanel({
  items = [],
  materials = [],
  currency = "₽",
  stellageConfigs = [],
  activeFilter = "",
  onFilterSelect,
  selectedItemIds = [],
  onBulkShowClient,
  onBulkHideClient,
  onBulkRefreshPrice,
  onClearSelection,
  onExportPdf,
  onExportExcel,
  onOpenClientLink,
  onCopyClientLink,
  preSendMessages = [],
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [showAllPreview, setShowAllPreview] = useState(false);

  const summary = useMemo(
    () => buildClientPurchaseSummary(items, materials, { stellageConfigs }),
    [items, materials, stellageConfigs]
  );

  const previewRows = useMemo(
    () => buildClientDeliveryPreviewRows(items, materials, { stellageConfigs }),
    [items, materials, stellageConfigs]
  );

  const visiblePreview = showAllPreview ? previewRows : previewRows.slice(0, PREVIEW_LIMIT);
  const purchaseSub = `${summary.purchaseClosed} из ${summary.purchaseTotalItems} закрыто`;

  const metrics = [
    { label: "Позиций клиенту", value: summary.totalClientItems, tone: "ok", filter: "client_visible" },
    { label: "Скрыто", value: summary.hiddenItems, tone: metricTone(summary.hiddenItems), filter: "client_hidden" },
    { label: "Без цены", value: summary.noPrice, tone: metricTone(summary.noPrice), filter: "no_price" },
    { label: "Без ссылки", value: summary.noLink, tone: metricTone(summary.noLink), filter: "no_link" },
    { label: "Без поставщика", value: summary.noSupplier, tone: metricTone(summary.noSupplier), filter: "no_supplier" },
    { label: "Из схемы каркаса", value: summary.frameBomItems, tone: "neutral", filter: "frame_bom" },
  ];

  return (
    <section className="client-delivery card no-print" aria-label="Клиентская выдача">
      <div className="client-delivery__head between wrap" style={{ gap: 10 }}>
        <div>
          <strong className="client-delivery__title">Клиентская выдача</strong>
          <p className="muted client-delivery__subtitle">
            То же, что увидит клиент в ссылке, PDF и Excel
          </p>
        </div>
        <div className="client-delivery__total">
          <span className="muted" style={{ fontSize: 12 }}>Итого закупка</span>
          <strong className="num client-delivery__total-value">
            {money(summary.purchaseTotal, currency)}
          </strong>
          <span className="muted" style={{ fontSize: 12 }}>{purchaseSub}</span>
        </div>
      </div>

      <div className="client-delivery__metrics">
        {metrics.map((m) => (
          <MetricCard
            key={m.label}
            {...m}
            activeFilter={activeFilter}
            onFilterSelect={onFilterSelect}
          />
        ))}
      </div>

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

      <div className="client-delivery__filters row wrap" style={{ gap: 6, marginTop: 10 }}>
        {CLIENT_DELIVERY_FILTERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`btn btn-sm${activeFilter === id ? " btn-primary" : ""}`}
            onClick={() => onFilterSelect?.(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {selectedItemIds.length > 0 ? (
        <div className="client-delivery__quick row wrap" style={{ gap: 8, marginTop: 12 }}>
          <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
            Выбрано: <strong className="num">{selectedItemIds.length}</strong>
          </span>
          <button type="button" className="btn btn-sm" onClick={onBulkShowClient}>
            Показать клиенту
          </button>
          <button type="button" className="btn btn-sm" onClick={onBulkHideClient}>
            Скрыть от клиента
          </button>
          <button type="button" className="btn btn-sm" onClick={onBulkRefreshPrice}>
            Обновить цену из базы
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClearSelection}>
            Снять выбор
          </button>
        </div>
      ) : null}

      {preSendMessages.length > 0 ? (
        <ul className="client-delivery__warnings">
          {preSendMessages.slice(0, 5).map((msg) => (
            <li key={msg.key}>
              <button
                type="button"
                className="client-delivery__warning-btn"
                onClick={() => msg.filter && onFilterSelect?.(msg.filter)}
              >
                {msg.text}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="client-delivery__actions row wrap" style={{ gap: 8, marginTop: 12 }}>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => setPreviewOpen((v) => !v)}>
          {previewOpen ? "Скрыть клиентскую выдачу" : "Показать клиентскую выдачу"}
        </button>
        <button type="button" className="btn btn-sm" onClick={onOpenClientLink}>
          Клиентская ссылка
        </button>
        <button type="button" className="btn btn-sm" onClick={onCopyClientLink}>
          Скопировать ссылку
        </button>
        <button type="button" className="btn btn-sm" onClick={onExportPdf}>
          PDF
        </button>
        <button type="button" className="btn btn-sm" onClick={onExportExcel}>
          Excel
        </button>
        {preSendMessages.length > 0 ? (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onFilterSelect?.("problems")}>
            Проблемные позиции
          </button>
        ) : null}
      </div>

      {previewOpen ? (
        <div className="client-delivery__preview" style={{ marginTop: 14 }}>
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
                        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                          {row.note}
                        </div>
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
