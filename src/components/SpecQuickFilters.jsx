import React, { useMemo, useState } from "react";
import { resolveDashboardFilterLabel } from "../../shared/projectDashboardSummary.js";
import {
  MASS_SELECT_ACTIONS,
  SPEC_ADVANCED_FILTERS,
  SPEC_PRIMARY_FILTERS,
  shouldShowSelectedActionBar,
} from "../../shared/projectWorkspaceUi.js";
import {
  buildProjectPreSendChecklist,
  selectAllPreSendProblemIds,
  selectPreSendGroupIds,
} from "../../shared/projectPreSendChecklist.js";
import ProjectSelectedActionBar from "./ProjectSelectedActionBar.jsx";

export default function SpecQuickFilters({
  items = [],
  materials = [],
  publishCheck,
  quickFilters = [],
  onQuickFilterChange,
  selectedItemIds = [],
  onSelectItems,
  onBulkShowClient,
  onBulkHideClient,
  onBulkRefreshPrice,
  onClearSelection,
  syncClientSections,
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [massOpen, setMassOpen] = useState(false);

  const checklist = useMemo(
    () => buildProjectPreSendChecklist(items, materials, { publishCheck }),
    [items, materials, publishCheck]
  );

  const groupCount = (key) => checklist.groups.find((g) => g.key === key)?.count || 0;

  const handleMassSelect = (key) => {
    if (key === "all_problems") {
      onSelectItems?.(selectAllPreSendProblemIds(checklist));
      return;
    }
    onSelectItems?.(selectPreSendGroupIds(checklist, key));
  };

  const selected = shouldShowSelectedActionBar(selectedItemIds.length);
  const activeFilters = Array.isArray(quickFilters) ? quickFilters : quickFilters ? [quickFilters] : [];
  const activeSet = new Set(activeFilters);
  const toggleFilter = (id) => {
    if (!id) return onQuickFilterChange?.([]);
    onQuickFilterChange?.(activeSet.has(id) ? activeFilters.filter((entry) => entry !== id) : [...activeFilters, id]);
  };

  return (
    <div className="spec-quick-filters no-print">
      {activeFilters.length ? (
        <div className="spec-active-filter" aria-label="Активные фильтры">
          {activeFilters.map((filterId) => <button key={filterId} type="button" className="chip chip--brand spec-active-filter__chip" onClick={() => toggleFilter(filterId)} aria-label={`Удалить фильтр: ${resolveDashboardFilterLabel(filterId)}`}>
            {resolveDashboardFilterLabel(filterId)} <span aria-hidden="true">×</span>
          </button>)}
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => onQuickFilterChange?.([])}
          >
            Сбросить всё
          </button>
        </div>
      ) : null}

      <div className="spec-quick-filters__row row wrap" style={{ gap: 6 }}>
        {SPEC_PRIMARY_FILTERS.map(({ id, label }) => (
          <button
            key={id || "all"}
            type="button"
            className={`btn btn-sm${(!id ? !activeFilters.length : activeSet.has(id)) ? " btn-primary" : ""}`}
            aria-pressed={!id ? !activeFilters.length : activeSet.has(id)}
            onClick={() => toggleFilter(id)}
          >
            {label}
          </button>
        ))}

        <details
          className="spec-more-filters"
          open={moreOpen}
          onToggle={(e) => setMoreOpen(e.target.open)}
        >
          <summary className="btn btn-sm btn-ghost">Ещё фильтры ▾</summary>
          <div className="spec-more-filters__menu card">
            {SPEC_ADVANCED_FILTERS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={`btn btn-sm btn-ghost${activeSet.has(id) ? " btn-primary" : ""}`}
                aria-pressed={activeSet.has(id)}
                onClick={() => {
                  setMoreOpen(false);
                  toggleFilter(id);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </details>

        {!selected ? (
          <details
            className="spec-mass-select"
            open={massOpen}
            onToggle={(e) => setMassOpen(e.target.open)}
          >
            <summary className="btn btn-sm">Массовый выбор ▾</summary>
            <div className="spec-mass-select__menu card">
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
                      setMassOpen(false);
                      handleMassSelect(action.key);
                    }}
                  >
                    {action.label}
                  </button>
                );
              })}
            </div>
          </details>
        ) : null}

        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => syncClientSections?.(selectedItemIds)}
          title="Раздел и подраздел для клиентской закупки из справочника материалов"
        >
          Клиент. разделы из базы
          {selectedItemIds.length > 0 ? ` (${selectedItemIds.length})` : ""}
        </button>
      </div>

      {selected ? (
        <ProjectSelectedActionBar
          selectedCount={selectedItemIds.length}
          onShowClient={onBulkShowClient}
          onHideClient={onBulkHideClient}
          onRefreshPrices={onBulkRefreshPrice}
          onClearSelection={onClearSelection}
        />
      ) : null}
    </div>
  );
}
