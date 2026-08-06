import React, { useEffect, useRef, useState } from "react";
import { PlannerTopBar } from "./PlannerTopBar.jsx";
import { PlannerToolRail } from "./PlannerToolRail.jsx";
import { PlannerInspector, inspectorSelectionTransition } from "./PlannerInspector.jsx";
import { PlannerViewportControls } from "./PlannerViewportControls.jsx";
import { PlannerBottomBar } from "./PlannerBottomBar.jsx";
import { SheetFiltersBar } from "./SheetFiltersBar.jsx";
import {
  getDefaultInspectorOpen,
  getPlannerInspectorBreakpoint,
  getPlannerInspectorMode,
} from "../plannerWorkspaceShell.js";

function readBreakpoint() {
  if (typeof window === "undefined") return "desktop";
  return getPlannerInspectorBreakpoint(window.innerWidth);
}

/**
 * Phase 2 redesigned Planner workspace shell.
 * ToolRail + canvas + responsive Inspector. No legacy dual drawer/properties overlay.
 * Inspector open state is local UI only — not written to plan JSON.
 */
export function PlannerLayout({
  topBarProps,
  activeSheetId,
  onSheetPick,
  planLevel,
  planVariant,
  onPlanLevel,
  onPlanVariant,
  viewMode,
  onViewModePick,
  toolRailProps,
  inspectorProps,
  zoomProps,
  statusBar,
  canvas,
  bottomBarProps,
  footerLeft,
  sheetFilters,
  activeFilterId,
  onFilterPick,
}) {
  const [breakpoint, setBreakpoint] = useState(readBreakpoint);
  const [inspectorOpen, setInspectorOpen] = useState(() => getDefaultInspectorOpen(readBreakpoint()));
  const prevBpRef = useRef(breakpoint);
  const hadSelectionRef = useRef(!!inspectorProps?.selection);
  const inspectorMode = getPlannerInspectorMode(breakpoint);

  useEffect(() => {
    const onResize = () => {
      const next = readBreakpoint();
      setBreakpoint((prev) => {
        if (prev === next) return prev;
        return next;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const prev = prevBpRef.current;
    prevBpRef.current = breakpoint;
    if (prev === breakpoint) return;
    // Entering narrow: collapse by default so canvas keeps width.
    if (breakpoint === "narrow" && prev !== "narrow") {
      setInspectorOpen(false);
      return;
    }
    // Leaving narrow into mid/desktop: restore docked open default.
    if (prev === "narrow" && breakpoint !== "narrow") {
      setInspectorOpen(true);
    }
  }, [breakpoint]);

  // Selecting something reveals the inspector even when it was closed/
  // collapsed (default on narrow screens) — matches "on selection -> half"
  // from the mobile sheet contract. Only reacts to no-selection -> selection
  // transitions; it never forces the panel closed again.
  //
  // PHASE 2D: a caller can opt out (autoOpenOnSelect === false) when merely
  // selecting must not reveal properties — walls, where selecting and opening
  // the editor are two different user intents.
  useEffect(() => {
    const move = inspectorSelectionTransition({
      had: hadSelectionRef.current,
      has: !!inspectorProps?.selection,
      autoOpenOnSelect: inspectorProps?.autoOpenOnSelect !== false,
    });
    hadSelectionRef.current = !!inspectorProps?.selection;
    if (move === "reveal") setInspectorOpen(true);
  }, [inspectorProps?.selection]);

  // PHASE 2D: explicit open/close requests (double click / Escape). Counters
  // rather than a boolean, so repeating the same intent is always observed.
  const openReq = inspectorProps?.openRequestId ?? 0;
  const closeReq = inspectorProps?.closeRequestId ?? 0;
  const prevOpenReqRef = useRef(openReq);
  const prevCloseReqRef = useRef(closeReq);
  useEffect(() => {
    if (openReq === prevOpenReqRef.current) return;
    prevOpenReqRef.current = openReq;
    setInspectorOpen(true);
  }, [openReq]);
  useEffect(() => {
    if (closeReq === prevCloseReqRef.current) return;
    prevCloseReqRef.current = closeReq;
    setInspectorOpen(false);
  }, [closeReq]);

  useEffect(() => {
    if (!inspectorOpen || inspectorMode !== "overlay") return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setInspectorOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inspectorOpen, inspectorMode]);

  const toggleInspector = () => setInspectorOpen((o) => !o);
  const closeInspector = () => setInspectorOpen(false);

  const slotClass = [
    "planner-inspector-slot",
    inspectorOpen ? "planner-inspector-slot--open" : "planner-inspector-slot--closed",
    inspectorMode === "overlay" ? "planner-inspector-slot--overlay" : "planner-inspector-slot--dock",
    `planner-inspector-slot--${breakpoint}`,
  ].join(" ");

  return (
    <div
      className={
        "planner-app planner-app--redesign planner-app--phase2" +
        (inspectorOpen ? " is-inspector-open" : " is-inspector-closed") +
        ` is-inspector-${inspectorMode}` +
        ` is-bp-${breakpoint}`
      }
      data-inspector-open={inspectorOpen ? "1" : "0"}
      data-inspector-mode={inspectorMode}
      data-planner-bp={breakpoint}
    >
      <PlannerTopBar
        {...topBarProps}
        activeSheetId={activeSheetId}
        onSheetPick={onSheetPick}
        planLevel={planLevel}
        planVariant={planVariant}
        onPlanLevel={onPlanLevel}
        onPlanVariant={onPlanVariant}
        viewMode={viewMode}
        onViewModePick={onViewModePick}
        inspectorOpen={inspectorOpen}
        onToggleInspector={toggleInspector}
      />

      {sheetFilters?.length > 0 && (
        <SheetFiltersBar filters={sheetFilters} activeFilterId={activeFilterId} onPick={onFilterPick} />
      )}

      <div className="planner-workspace planner-workspace--redesign">
        <PlannerToolRail {...toolRailProps} />

        <div className="planner-canvas-area">
          <div className="planner-canvas-wrap">
            {canvas}
            {statusBar}
            {!inspectorOpen && (
              <button
                type="button"
                className="planner-inspector-reopen no-print"
                onClick={toggleInspector}
                title="Показать свойства"
                aria-label="Показать свойства"
              >
                Свойства
              </button>
            )}
            <div className="planner-viewport-controls-wrap">
              <PlannerViewportControls {...zoomProps} />
            </div>
          </div>
          <PlannerBottomBar {...bottomBarProps} footerLeft={footerLeft} />
        </div>

        {inspectorOpen && inspectorMode === "overlay" && (
          <button
            type="button"
            className="planner-inspector-backdrop no-print"
            aria-label="Закрыть свойства"
            onClick={closeInspector}
          />
        )}

        <div className={slotClass}>
          {inspectorOpen ? <PlannerInspector {...inspectorProps} /> : null}
        </div>
      </div>
    </div>
  );
}
