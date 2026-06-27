import React, { useEffect, useMemo, useRef, useState } from "react";
import { SHEETS } from "../plannerSheets.js";
import { sheetsForViewMode } from "../plannerViewModes.js";

const SHEET_MARKERS = {
  client: "client",
  install: "install",
  spec: "spec",
};

export function PlannerSheetStrip({ activeSheetId, viewMode = "2d", onPick }) {
  const scrollRef = useRef(null);
  const activeRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const visibleSheets = useMemo(
    () => sheetsForViewMode(viewMode, SHEETS),
    [viewMode],
  );

  const updateScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  useEffect(() => {
    updateScroll();
    const el = scrollRef.current;
    if (!el) return undefined;
    el.addEventListener("scroll", updateScroll);
    const ro = new ResizeObserver(updateScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScroll);
      ro.disconnect();
    };
  }, [visibleSheets.length]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    updateScroll();
  }, [activeSheetId, viewMode]);

  const scrollBy = (dir) => {
    scrollRef.current?.scrollBy({ left: dir * 200, behavior: "smooth" });
  };

  return (
    <div className="planner-sheet-strip no-print">
      {canScrollLeft && (
        <button type="button" className="planner-sheet-strip__arrow" onClick={() => scrollBy(-1)} aria-label="Прокрутить влево">
          ‹
        </button>
      )}
      <div className="planner-sheet-strip__scroll" ref={scrollRef}>
        {visibleSheets.map((sheet) => {
          const isActive = activeSheetId === sheet.id;
          return (
            <button
              key={sheet.id}
              ref={isActive ? activeRef : null}
              type="button"
              className={"planner-sheet-tab" + (isActive ? " planner-sheet-tab--active" : "")}
              onClick={() => onPick(sheet)}
              title={sheet.name}
            >
              {SHEET_MARKERS[sheet.id] && (
                <span className={`planner-sheet-tab__dot planner-sheet-tab__dot--${SHEET_MARKERS[sheet.id]}`} />
              )}
              {sheet.name}
            </button>
          );
        })}
      </div>
      {canScrollRight && (
        <button type="button" className="planner-sheet-strip__arrow" onClick={() => scrollBy(1)} aria-label="Прокрутить вправо">
          ›
        </button>
      )}
    </div>
  );
}
