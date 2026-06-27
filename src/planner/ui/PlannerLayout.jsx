import React from "react";
import { PlannerTopBar } from "./PlannerTopBar.jsx";
import { PlannerSheetStrip } from "./PlannerSheetStrip.jsx";
import { PlannerCategoryRail } from "./PlannerCategoryRail.jsx";
import { PlannerToolDrawer } from "./PlannerToolDrawer.jsx";
import { PlannerBottomBar } from "./PlannerBottomBar.jsx";
import { PlannerZoomControl } from "./PlannerZoomControl.jsx";
import { PLAN_LEVELS, PLAN_VARIANTS } from "../plannerSheets.js";
import { SheetFiltersBar } from "./SheetFiltersBar.jsx";
import { PlannerModeBar } from "./PlannerModeBar.jsx";
import { viewModeById } from "../plannerViewModes.js";

export function PlannerLayout({
  topBarProps,
  activeSheetId,
  onSheetPick,
  planLevel,
  planVariant,
  onPlanLevel,
  onPlanVariant,
  activeCategoryId,
  onCategoryPick,
  drawerOpen,
  drawerTitle,
  onDrawerClose,
  toolDrawerContent,
  bottomBarProps,
  zoomProps,
  statusBar,
  canvas,
  propertiesPanel,
  showProperties,
  pinnedProperties,
  onTogglePinProperties,
  footerLeft,
  sheetFilters,
  activeFilterId,
  onFilterPick,
  viewMode,
  onViewModePick,
}) {
  return (
    <div className="planner-app">
      <PlannerTopBar {...topBarProps} />
      <div className="planner-header-row no-print">
        <PlannerModeBar activeMode={viewMode} onModePick={onViewModePick} />
        {viewMode !== "2d" && (
          <span className="planner-mode-hint" title="Верхние кнопки фильтруют вкладки листов">
            {viewModeById(viewMode).title}
          </span>
        )}
        <PlannerSheetStrip activeSheetId={activeSheetId} viewMode={viewMode} onPick={onSheetPick} />
        <div className="planner-header-selectors">
          <label className="planner-header-select">
            <span>Уровень</span>
            <select value={planLevel} onChange={(e) => onPlanLevel(e.target.value)}>
              {PLAN_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <label className="planner-header-select">
            <span>Вариант</span>
            <select value={planVariant} onChange={(e) => onPlanVariant(e.target.value)}>
              {PLAN_VARIANTS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        </div>
      </div>

      <SheetFiltersBar filters={sheetFilters} activeFilterId={activeFilterId} onPick={onFilterPick} />

      <div className="planner-workspace planner-workspace--cad">
        <PlannerCategoryRail
          activeCategoryId={activeCategoryId}
          onPick={onCategoryPick}
          onSearch={() => onCategoryPick({ id: "search", sheetId: "source", label: "Поиск" })}
          onHelp={() => window.open("https://daogreen.ru", "_blank")}
        />

        <PlannerToolDrawer open={drawerOpen} title={drawerTitle} onClose={onDrawerClose}>
          {toolDrawerContent}
        </PlannerToolDrawer>

        <div className="planner-canvas-area">
          <div className="planner-canvas-wrap">
            {canvas}
            {statusBar}
            <PlannerZoomControl {...zoomProps} />
          </div>
          <PlannerBottomBar {...bottomBarProps} footerLeft={footerLeft} />
        </div>

        {(showProperties || pinnedProperties) && (
          <div className={"planner-props-wrap" + (pinnedProperties ? " planner-props-wrap--pinned" : "")}>
            <button
              type="button"
              className="planner-props-pin"
              onClick={onTogglePinProperties}
              title={pinnedProperties ? "Открепить панель" : "Закрепить панель"}
            >
              {pinnedProperties ? "📌" : "📍"}
            </button>
            {propertiesPanel}
          </div>
        )}
      </div>
    </div>
  );
}
