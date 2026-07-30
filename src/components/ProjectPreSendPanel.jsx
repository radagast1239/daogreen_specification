import React, { useMemo } from "react";
import {
  buildProjectPreSendChecklist,
  selectAllPreSendProblemIds,
  selectPreSendGroupIds,
} from "../../shared/projectPreSendChecklist.js";
import { resolveDashboardFilterLabel, metricTone } from "../../shared/projectDashboardSummary.js";

function GroupRow({ group, activeFilter, onFilterSelect, onSelectGroup }) {
  const clickable = group.count > 0 || (group.filterKey && activeFilter === group.filterKey);
  const active = group.filterKey && activeFilter === group.filterKey;
  const tone =
    group.severity === "blocker"
      ? metricTone(group.count, { badFrom: 1 })
      : group.severity === "warning"
        ? metricTone(group.count, { warnFrom: 1 })
        : group.severity === "ok"
          ? "ok"
          : "neutral";

  return (
    <div className="pre-send__row">
      <button
        type="button"
        className={`pre-send__metric pre-send__metric--${tone}${active ? " pre-send__metric--active" : ""}`}
        disabled={!clickable && group.key !== "client_total"}
        onClick={() => clickable && group.filterKey && onFilterSelect?.(group.filterKey)}
        title={clickable ? "Показать в таблице" : undefined}
      >
        <span className="pre-send__metric-value num">{group.count}</span>
        <span className="pre-send__metric-label">{group.label}</span>
      </button>
      {group.selectable ? (
        <button
          type="button"
          className="btn btn-sm btn-ghost pre-send__select-btn"
          disabled={!group.count}
          onClick={() => onSelectGroup?.(group.key)}
        >
          Выбрать
        </button>
      ) : null}
    </div>
  );
}

export default function ProjectPreSendPanel({
  items = [],
  materials = [],
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
  const checklist = useMemo(
    () => buildProjectPreSendChecklist(items, materials, { publishCheck }),
    [items, materials, publishCheck]
  );

  const handleSelectGroup = (groupKey) => {
    const ids = selectPreSendGroupIds(checklist, groupKey);
    onSelectItems?.(ids);
  };

  const handleSelectAllProblematic = () => {
    onSelectItems?.(selectAllPreSendProblemIds(checklist));
  };

  const selectButtons = [
    { key: "no_price", label: "Выбрать без цены" },
    { key: "no_link", label: "Выбрать без ссылки" },
    { key: "no_supplier", label: "Выбрать без поставщика" },
    { key: "hidden_from_client", label: "Выбрать скрытые" },
    { key: "frame_bom", label: "Выбрать BOM" },
  ];

  return (
    <section className="pre-send card no-print" aria-label="Подготовка к отправке">
      <div className="pre-send__head between wrap" style={{ gap: 10 }}>
        <div>
          <strong className="pre-send__title">Подготовка к отправке</strong>
          <p className="muted pre-send__subtitle">
            Быстрая проверка проблемных позиций перед PDF, Excel и клиентской ссылкой
          </p>
        </div>
        <div className={`pre-send__status pre-send__status--${checklist.tone}`}>
          <strong>{checklist.statusTitle}</strong>
          {checklist.statusDetail ? (
            <span className="muted" style={{ fontSize: 12 }}>
              {checklist.statusDetail}
            </span>
          ) : null}
        </div>
      </div>

      <div className="pre-send__groups">
        {checklist.groups.map((group) => (
          <GroupRow
            key={group.key}
            group={group}
            activeFilter={activeFilter}
            onFilterSelect={onFilterSelect}
            onSelectGroup={handleSelectGroup}
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

      <div className="pre-send__select-actions row wrap" style={{ gap: 6, marginTop: 12 }}>
        {selectButtons.map((btn) => {
          const group = checklist.groups.find((g) => g.key === btn.key);
          return (
            <button
              key={btn.key}
              type="button"
              className="btn btn-sm"
              disabled={!group?.count}
              onClick={() => handleSelectGroup(btn.key)}
            >
              {btn.label}
            </button>
          );
        })}
        <button
          type="button"
          className="btn btn-sm"
          disabled={!checklist.allProblemIds.length}
          onClick={handleSelectAllProblematic}
        >
          Выбрать всё проблемное
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClearSelection}>
          Снять выбор
        </button>
      </div>

      {selectedItemIds.length > 0 ? (
        <div className="pre-send__quick row wrap" style={{ gap: 8, marginTop: 12 }}>
          <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
            Выбрано: <strong className="num">{selectedItemIds.length}</strong>
          </span>
          <button type="button" className="btn btn-sm btn-primary" onClick={onBulkShowClient}>
            Показать выбранные клиенту
          </button>
          <button type="button" className="btn btn-sm" onClick={onBulkHideClient}>
            Скрыть выбранные
          </button>
          <button type="button" className="btn btn-sm" onClick={onBulkRefreshPrice}>
            Обновить цены выбранных из базы
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClearSelection}>
            Снять выбор
          </button>
        </div>
      ) : null}
    </section>
  );
}
